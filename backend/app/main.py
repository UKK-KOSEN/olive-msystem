"""olive-msystem FastAPI application."""
from __future__ import annotations

import logging
import shutil
import traceback
import uvicorn
import yaml
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, File, UploadFile, HTTPException, Query, Depends, Form, Header
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from .analyzer import OliveAnalyzer, parse_time
from .captured import extract_captured_at, parse_captured_candidate
from .translate_report import explain_detection_ja
from .auth import get_current_user, require_admin
from .config import (CORS_ORIGINS, DB_PATH, MAX_UPLOAD_MB, PORT,
                     SETTINGS_PATH, SOIL_MOISTURE_CONFIG_PATH,
                     STORAGE_DIR, UPLOAD_DIR, ensure_dirs,
                     load_settings, save_settings)
from .health import HEALTH_LABELS, health_state, aggregate_health_state
from .models import (AnalyseImageRequest, AnalyseTimesRequest,
                     AnalyseTimesTextRequest, SoilMoistureInput,
                     RegisterRequest, LoginRequest, FarmerUpdateRequest,
                     PasswordResetRequest)
from .runner import Runner
from .soil_moisture import build_soil_data, integrate as integrate_soil, parse_observed_at_iso
from .storage import Store, verify_password

ensure_dirs()

app = FastAPI(title="olive-msystem", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = Store(DB_PATH)
runner = Runner(store, workers=1)
grader = OliveAnalyzer()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("olive-msystem")


# ---- Sensor offline monitor (background thread) ---------------------------
import threading, time as _time
from datetime import datetime as _dt

_sensor_last_notified: Optional[_dt] = None
_SENSOR_CHECK_INTERVAL = 3600  # check every 1 hour
_SENSOR_STALE_HOURS = 6        # consider offline after 6h without data
_SENSOR_NOTIFY_COOLDOWN = 86400  # notify at most once per 24h


def _sensor_monitor_loop():
    """Background thread: checks sensor freshness and sends daily notifications."""
    global _sensor_last_notified
    while True:
        _time.sleep(_SENSOR_CHECK_INTERVAL)
        try:
            from .soil_moisture import build_soil_data, _parse_api_ts
            data = build_soil_data(None)
            sm = data.get("soil_moisture", {})
            measured = sm.get("measured_at")
            if not measured:
                continue
            ts = _parse_api_ts(measured)
            if ts is None:
                continue
            now = _dt.utcnow().replace(tzinfo=ts.tzinfo) if ts.tzinfo else _dt.utcnow()
            age_hours = (now - ts).total_seconds() / 3600
            if age_hours < _SENSOR_STALE_HOURS:
                continue  # sensor is online, no action needed

            # Sensor is offline — send notification once per day
            now_naive = _dt.utcnow()
            if _sensor_last_notified is not None:
                since_last = (now_naive - _sensor_last_notified).total_seconds()
                if since_last < _SENSOR_NOTIFY_COOLDOWN:
                    continue  # already notified recently

            kit_id = sm.get("kit_id", "unknown")
            age_int = int(age_hours)
            title = "土壌水分センサー停止通知"
            body = (
                f"センサー（{kit_id}）のデータが {age_int} 時間以上更新されていません。"
                f"最終更新: {measured}。物理的な確認をお勧めします。"
            )
            store.add_notification(title, body, created_by=0, target_role="all")
            _sensor_last_notified = now_naive
            logger.warning("sensor offline notification sent: %s (age %dh)", kit_id, age_int)
        except Exception:
            logger.exception("sensor monitor error")


_sensor_thread = threading.Thread(target=_sensor_monitor_loop, daemon=True)
_sensor_thread.start()


def _seed_admin() -> None:
    """Ensure an admin account exists with a safe password.

    * First startup: creates "admin" with a random 10-digit numeric password
      (override via ADMIN_USERNAME / ADMIN_PASSWORD env).
    * If the admin account still uses the documented default "admin123",
      it is rotated once to a random numeric password.
    * If ADMIN_PASSWORD is set, the admin password is left untouched.

    A generated password is logged once at startup so it can be retrieved.
    """
    import os
    import secrets
    if os.environ.get("ADMIN_PASSWORD"):
        logger.info("admin password managed via ADMIN_PASSWORD env (not randomized)")
        return
    username = os.environ.get("ADMIN_USERNAME", "admin")
    existing = store.get_user_by_username(username)
    if existing is not None and existing["role"] != "admin":
        return
    password = "".join(secrets.choice("0123456789") for _ in range(10))
    if existing is None:
        store.create_user(username, password, role="admin", display_name="管理者")
    else:
        if not verify_password("admin123", existing["password_hash"]):
            return
        store.set_user_password(existing["id"], password)
        logger.info("Rotated admin '%s' away from the default password admin123", username)
    logger.info("Created default admin account: username=%s password=%s", username, password)


_seed_admin()


# --------------------------------------------------------------------------
# Health / metadata
# --------------------------------------------------------------------------
@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception):
    logger.error("unhandled error on %s: %s", request.url.path, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "サーバー内部でエラーが発生しました"},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    errors = exc.errors()
    lines = []
    for e in errors:
        loc = ".".join(str(x) for x in e.get("loc", []) if x != "body")
        lines.append(f"{loc}: {e.get('msg')}" if loc else str(e.get("msg")))
    logger.warning("validation error on %s: %s", request.url.path, "; ".join(lines) or exc)
    msg = lines[0] if lines else "入力値が正しくありません"
    return JSONResponse(status_code=422, content={"detail": msg})


@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request, exc: StarletteHTTPException):
    if exc.status_code >= 500:
        logger.error("http %s error on %s: %s", exc.status_code, request.url.path, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/api/health")
def api_health():
    counts = store.count()
    return {"status": "ok", **counts}


@app.get("/api/versions")
def api_versions():
    """Report the versions of the software stack used by this dashboard."""
    import sys
    import platform

    import cv2
    import numpy
    import fastapi
    import uvicorn
    import pydantic

    def pkg(name: str):
        try:
            import importlib.metadata as md
            return md.version(name)
        except Exception:
            return None

    olive_p_version = None
    for p in [Path(r"../olive-p/VERSION"),
              Path(r"C:\Users\yakit\Downloads\olive-p\VERSION")]:
        try:
            if p.exists():
                olive_p_version = p.read_text(encoding="utf-8").strip()
                break
        except Exception:
            pass

    # Soil moisture config info
    soil_cfg = {}
    if SOIL_MOISTURE_CONFIG_PATH.exists():
        try:
            import yaml as _yaml
            raw = _yaml.safe_load(SOIL_MOISTURE_CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                soil_cfg = {
                    "kit_id": raw.get("default_kit_id", "unknown"),
                    "configured": True,
                }
        except Exception:
            soil_cfg = {"configured": True}

    architecture = {
        "components": [
            {"name": "フロントエンド", "tech": "Next.js 15 (React)", "description": "ダッシュボード・動画・画像・カレンダー・推移・通知などのUI", "port": "3001"},
            {"name": "バックエンド", "tech": "FastAPI (Python)", "description": "REST API・認証・動画解析キュー・土壌水分統合・ユーザー管理", "port": "8000"},
            {"name": "解析エンジン (olive-p)", "tech": "Python + OpenCV", "description": "動画フレーム抽出・オリーブ検出・健康状態判定・土壌水分評価統合"},
            {"name": "土壌水分センサー", "tech": "UKK-KOSEN D1 API", "description": "小豆島フィールドの土壌水分・温度・湿度をCloudflare経由で取得",
             **({"kit_id": soil_cfg.get("kit_id")} if soil_cfg.get("kit_id") else {})},
            {"name": "データベース", "tech": "SQLite", "description": "観測・動画・画像・ユーザー・通知データを永続化"},
        ],
        "dataFlows": [
            {"from": "ユーザー", "to": "フロントエンド", "description": "動画/画像をアップロードし、解析を依頼"},
            {"from": "フロントエンド", "to": "バックエンド", "description": "REST API経由で動画解析・データ取得・設定変更"},
            {"from": "バックエンド", "to": "olive-p", "description": "動画フレームの解析をオフロード"},
            {"from": "olive-p", "to": "バックエンド", "description": "検出結果（検出数・健康スコア・土壌水分）を返す"},
            {"from": "バックエンド", "to": "UKK-KOSEN API", "description": "土壌水分センサーデータをBearer認証で取得"},
            {"from": "バックエンド", "to": "SQLite", "description": "観測・動画・画像・ユーザー情報を保存"},
            {"from": "バックエンド", "to": "ユーザー", "description": "体調スコア・アドバイス・通知を返す"},
        ],
        "apiEndpoints": [
            {"group": "認証", "endpoints": [
                {"path": "/api/auth/login", "method": "POST", "description": "JWTトークン取得"},
                {"path": "/api/auth/register", "method": "POST", "description": "新規ユーザー登録（農家）"},
                {"path": "/api/auth/me", "method": "GET", "description": "ログイン中ユーザー情報"},
                {"path": "/api/auth/profile", "method": "PUT", "description": "プロフィール更新"},
                {"path": "/api/auth/preferences", "method": "GET/PUT", "description": "表示設定の取得/更新"},
            ]},
            {"group": "動画", "endpoints": [
                {"path": "/api/videos", "method": "POST", "description": "動画アップロード"},
                {"path": "/api/videos", "method": "GET", "description": "動画一覧"},
                {"path": "/api/videos/{id}/analyse", "method": "POST", "description": "指定タイムスタンプで解析"},
                {"path": "/api/videos/{id}/analyse-times", "method": "POST", "description": "時間文字列で解析"},
                {"path": "/api/videos/{id}/observations", "method": "GET", "description": "動画の観測結果一覧"},
                {"path": "/api/videos/jobs", "method": "GET", "description": "解析キューの状態"},
                {"path": "/api/videos/{id}", "method": "DELETE", "description": "動画削除"},
            ]},
            {"group": "画像", "endpoints": [
                {"path": "/api/images", "method": "POST", "description": "画像アップロード"},
                {"path": "/api/images", "method": "GET", "description": "画像一覧"},
                {"path": "/api/images/{id}/analyse", "method": "POST", "description": "画像解析実行"},
                {"path": "/api/images/{id}/observations", "method": "GET", "description": "画像の観測結果"},
                {"path": "/api/images/{id}", "method": "DELETE", "description": "画像削除"},
            ]},
            {"group": "観測・判定", "endpoints": [
                {"path": "/api/observations", "method": "GET", "description": "観測一覧（農家は自分のみ）"},
                {"path": "/api/observations", "method": "DELETE", "description": "観測一括削除"},
                {"path": "/api/observations/export", "method": "GET", "description": "CSV/JSONエクスポート"},
                {"path": "/api/olive/status", "method": "GET", "description": "オリーブ体調ステータス（最新判定・推移）"},
                {"path": "/api/calendar/observations", "method": "GET", "description": "カレンダー用観測データ"},
            ]},
            {"group": "土壌水分", "endpoints": [
                {"path": "/api/soil-moisture/status", "method": "GET", "description": "センサー最新値・鮮度・API監視情報"},
            ]},
            {"group": "通知", "endpoints": [
                {"path": "/api/notifications", "method": "GET", "description": "通知一覧"},
                {"path": "/api/notifications/unread-count", "method": "GET", "description": "未読数"},
                {"path": "/api/notifications/{id}/read", "method": "POST", "description": "既読化"},
                {"path": "/api/notifications/{id}", "method": "DELETE", "description": "通知削除"},
            ]},
            {"group": "管理者", "endpoints": [
                {"path": "/api/admin/stats", "method": "GET", "description": "ダッシュボード統計"},
                {"path": "/api/admin/farmers", "method": "GET", "description": "農家一覧"},
                {"path": "/api/admin/farmers/{id}", "method": "PUT", "description": "農家情報更新"},
                {"path": "/api/admin/farmers/{id}/password", "method": "PUT", "description": "農家パスワード変更"},
                {"path": "/api/admin/settings", "method": "GET/PUT", "description": "判定しきい値・サイト設定"},
                {"path": "/api/admin/soil-config/test", "method": "POST", "description": "土壌水分API接続テスト"},
                {"path": "/api/admin/soil-config", "method": "PUT", "description": "土壌水分設定更新"},
                {"path": "/api/admin/videos/{id}", "method": "DELETE", "description": "動画削除（管理者権限）"},
                {"path": "/api/admin/images/{id}", "method": "DELETE", "description": "画像削除（管理者権限）"},
                {"path": "/api/admin/observations/{id}", "method": "DELETE", "description": "観測削除（管理者権限）"},
                {"path": "/api/admin/observations/clear", "method": "POST", "description": "観測全削除（管理者権限）"},
            ]},
        ],
    }

    return {
        "olive_msystem": {
            "frontend": "1.0.0",
            "backend": "1.0.0",
        },
        "olive_p": olive_p_version,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "dependencies": {
            "fastapi": fastapi.__version__,
            "uvicorn": uvicorn.__version__,
            "pydantic": pydantic.__version__,
            "opencv": cv2.__version__,
            "numpy": numpy.__version__,
            "yaml": pkg("PyYAML"),
        },
        "architecture": architecture,
    }


# --------------------------------------------------------------------------
# Auth & registration
# --------------------------------------------------------------------------
@app.post("/api/auth/register")
def register(req: RegisterRequest):
    """Self-registration for farmers. Creates a farmer account."""
    username = req.username.strip()
    user = store.create_user(
        username,
        req.password,
        role="farmer",
        display_name=(req.display_name or "").strip() or None,
        farm_name=(req.farm_name or "").strip() or None,
    )
    if user is None:
        raise HTTPException(409, "このユーザー名は既に使われています")
    token = store.create_session(user["id"])
    return {"token": token, "user": user}


@app.post("/api/auth/login")
def login(req: LoginRequest):
    user = store.get_user_by_username(req.username.strip())
    if user is None or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "ユーザー名またはパスワードが正しくありません")
    if not user.get("is_active"):
        raise HTTPException(403, "このアカウントは無効です")
    token = store.create_session(user["id"])
    public_user = {k: user.get(k) for k in (
        "id", "username", "role", "display_name", "farm_name",
        "farm_area", "farm_trees", "farm_variety", "farm_location", "farm_contact",
    )}
    return {"token": token, "user": public_user}


@app.post("/api/auth/logout")
def logout(authorization: str = Header(default="")):
    token = ""
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if token:
        store.delete_session(token)
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    return user


@app.put("/api/auth/profile")
def update_profile(req: dict, user: dict = Depends(get_current_user)):
    """Update the current user's profile (account, farm info, password, preferences)."""
    fields = {}
    if "display_name" in req:
        fields["display_name"] = str(req["display_name"]).strip() or None
    if "farm_name" in req:
        fields["farm_name"] = str(req["farm_name"]).strip() or None
    for key in ("farm_area", "farm_variety", "farm_location", "farm_contact"):
        if key in req:
            fields[key] = str(req[key] or "").strip() or None
    if "farm_trees" in req:
        v = req["farm_trees"]
        if v in (None, "", 0):
            fields["farm_trees"] = None
        else:
            try:
                fields["farm_trees"] = int(v)
                if fields["farm_trees"] < 0:
                    raise ValueError
            except (TypeError, ValueError):
                raise HTTPException(400, "farm_trees must be a non-negative integer")
    if fields:
        store.update_user(user["id"], **fields)
    if req.get("password"):
        if len(str(req["password"])) < 6:
            raise HTTPException(400, "password must be at least 6 characters")
        store.set_user_password(user["id"], str(req["password"]))
    # Handle preferences
    if "preferences" in req and isinstance(req["preferences"], dict):
        store.update_preferences(user["id"], req["preferences"])
    updated = store.get_user(user["id"])
    if updated:
        updated.pop("password_hash", None)
        updated["preferences"] = store.get_preferences(user["id"])
    return updated or user


@app.get("/api/auth/preferences")
def get_preferences(user: dict = Depends(get_current_user)):
    """Get the current user's preferences."""
    return store.get_preferences(user["id"])


@app.put("/api/auth/preferences")
def update_preferences(req: dict, user: dict = Depends(get_current_user)):
    """Update the current user's preferences."""
    result = store.update_preferences(user["id"], req)
    return result


@app.get("/api/calendar/observations")
def calendar_observations(
    year: int = None,
    month: int = None,
    farmer_id: Optional[int] = None,
    user: dict = Depends(get_current_user),
):
    """Get observations grouped by date for calendar view.

    If year/month not specified, returns all observations.
    Admin sees all (or a specific farmer); farmers see only their own
    (or all if can_see_others is set).
    """
    from datetime import datetime
    now = datetime.now()
    y = year or now.year
    m = month or now.month

    # Get observations for the month
    start = f"{y:04d}-{m:02d}-01"
    if m == 12:
        end = f"{y+1:04d}-01-01"
    else:
        end = f"{y:04d}-{m+1:02d}-01"

    con = store._connect()
    try:
        if user["role"] == "admin":
            rows = con.execute(
                "SELECT id, user_id, observed_at, result_json, leaf_count, fruit_count, "
                "overall_health_score, source, label "
                "FROM observations WHERE observed_at >= ? AND observed_at < ? "
                "AND ( ? IS NULL OR user_id = ? ) "
                "ORDER BY observed_at ASC",
                (start, end, farmer_id, farmer_id),
            ).fetchall()
        else:
            # Farmers are strictly confined to their own data. Ignore any
            # farmer_id they pass and never let can_see_others cross the
            # ownership boundary for other farmers' rows.
            rows = con.execute(
                "SELECT id, user_id, observed_at, result_json, leaf_count, fruit_count, "
                "overall_health_score, source, label "
                "FROM observations WHERE observed_at >= ? AND observed_at < ? AND user_id = ? "
                "ORDER BY observed_at ASC",
                (start, end, user["id"]),
            ).fetchall()

        # Group by date
        by_date = {}
        import json
        users_map = {u["id"]: u for u in store.list_users()}
        for r in rows:
            d = r["observed_at"][:10]  # YYYY-MM-DD
            result = {}
            if r["result_json"]:
                try:
                    result = json.loads(r["result_json"])
                except Exception:
                    result = {}
            hs = health_state(result)
            u = users_map.get(r["user_id"]) or {}
            entry = {
                "id": r["id"],
                "user_id": r["user_id"],
                "observed_at": r["observed_at"],
                "health_state": hs,
                "leaf_count": r["leaf_count"],
                "fruit_count": r["fruit_count"],
                "overall_health_score": r["overall_health_score"],
                "source": r["source"],
                "label": r["label"],
                "farm_name": u.get("farm_name") or u.get("display_name") or u.get("username") or "",
            }
            by_date.setdefault(d, []).append(entry)

        return {"year": y, "month": m, "observations": by_date}
    finally:
        con.close()


# --------------------------------------------------------------------------
# Video upload (continuous upload support)
# --------------------------------------------------------------------------
@app.post("/api/videos")
async def upload_video(file: UploadFile = File(...),
                       captured_at: Optional[str] = Form(None),
                       user: dict = Depends(get_current_user)):
    """Upload a video file. Returns the video id and duration (if parseable).

    ``captured_at`` (ISO or epoch-ms) is the time the video was recorded, sent
    by the frontend from the file's metadata; it is used as the observation
    timestamp instead of the analysis time.
    """
    if not file.filename:
        raise HTTPException(400, "no filename")
    if file.filename.lower().split(".")[-1] not in {"mp4", "avi", "mov", "mkv", "webm", "m4v"}:
        raise HTTPException(400, "unsupported video format")

    content = await file.read()
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, "file too large")

    safe_name = Path(file.filename).name
    dest = UPLOAD_DIR / safe_name
    counter = 1
    while dest.exists():
        dest = UPLOAD_DIR / f"{Path(file.filename).stem}_{counter}{dest.suffix}"
        counter += 1
    dest.write_bytes(content)

    recorded_at = parse_captured_candidate(captured_at) or extract_captured_at(dest)
    video_id = store.add_video(safe_name, str(dest), len(content), user_id=user["id"],
                               recorded_at=recorded_at)
    # Try to read metadata (duration etc.).
    try:
        info = grader.video_info(str(dest))
        store.update_video(video_id, duration_sec=info["duration_seconds"],
                           fps=info["fps"], width=info["width"], height=info["height"])
    except Exception:
        info = {}

    return {"id": video_id, "filename": safe_name, "storage_path": str(dest),
            "recorded_at": recorded_at, "info": info}


@app.get("/api/videos")
def list_videos(status: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    uid = None if user["role"] == "admin" else user["id"]
    videos = store.list_videos(status=status, user_id=uid)
    for v in videos:
        v["storage_path"] = "/" + str(Path(v["storage_path"]).as_posix())
    return videos


@app.get("/api/videos/jobs")
def video_jobs(user: dict = Depends(get_current_user)):
    """Return the current processing queue with progress for the running user."""
    jobs = runner.jobs()
    out = []
    for j in jobs:
        if user["role"] != "admin":
            vid = store.get_video(j["video_id"])
            if vid is None or vid.get("user_id") != user["id"]:
                continue
        out.append({
            "job_id": j["job_id"],
            "video_id": j["video_id"],
            "status": j["status"],
            "progress": j.get("progress", 0.0),
            "requested": len(j.get("times") or []),
            "error": j.get("error"),
            "saved": (j.get("result") or {}) and (j.get("result") or {}).get("saved"),
            "stage": j.get("stage"),
            "current": j.get("current", 0),
            "total": j.get("total", len(j.get("times") or [])),
            "current_label": j.get("current_label"),
            "started_at": j.get("started_at"),
            "enqueued_at": j.get("enqueued_at"),
            "finished_at": j.get("finished_at"),
            "drone_mode": bool(j.get("drone_mode")),
            "upscale": j.get("upscale"),
            "tree_id": j.get("tree_id"),
        })
    return out


# --------------------------------------------------------------------------
# Image upload + single-image analysis
# --------------------------------------------------------------------------
@app.post("/api/images")
async def upload_image(file: UploadFile = File(...),
                       captured_at: Optional[str] = Form(None),
                       user: dict = Depends(get_current_user)):
    """Upload a still image for single-image analysis.

    ``captured_at`` (ISO or epoch-ms) is the time the photo was taken; used as
    the observation timestamp.
    """
    if not file.filename:
        raise HTTPException(400, "no filename")
    ext = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if ext not in {"jpg", "jpeg", "png", "bmp", "tif", "tiff", "webp"}:
        raise HTTPException(400, "unsupported image format")

    content = await file.read()
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, "file too large")

    safe_name = Path(file.filename).name
    dest = UPLOAD_DIR / safe_name
    counter = 1
    while dest.exists():
        dest = UPLOAD_DIR / f"{Path(file.filename).stem}_{counter}{dest.suffix}"
        counter += 1
    dest.write_bytes(content)

    recorded_at = parse_captured_candidate(captured_at) or extract_captured_at(dest)
    image_id = store.add_image(safe_name, str(dest), len(content), user_id=user["id"],
                               recorded_at=recorded_at)
    return {"id": image_id, "filename": safe_name, "storage_path": str(dest),
            "recorded_at": recorded_at}


@app.get("/api/images")
def list_images(user: dict = Depends(get_current_user)):
    uid = None if user["role"] == "admin" else user["id"]
    return store.list_images(user_id=uid)


def _owned_image(image_id: int, user: dict) -> dict:
    """Return the image if the current user may access it."""
    image = store.get_image(image_id)
    if image is None:
        raise HTTPException(404, "image not found")
    if user["role"] != "admin" and image.get("user_id") != user["id"]:
        raise HTTPException(403, "この画像にはアクセスできません")
    return image


def _owned_video(video_id: int, user: dict) -> dict:
    """Return the video if the current user may access it."""
    video = store.get_video(video_id)
    if video is None:
        raise HTTPException(404, "video not found")
    if user["role"] != "admin" and video.get("user_id") != user["id"]:
        raise HTTPException(403, "この動画にはアクセスできません")
    return video


@app.post("/api/images/{image_id}/analyse")
def analyse_image(image_id: int, req: AnalyseImageRequest, user: dict = Depends(get_current_user)):
    """Analyse a single uploaded image (synchronous, single image)."""
    image = _owned_image(image_id, user)
    image_path = Path(image["storage_path"])
    if not image_path.exists():
        raise HTTPException(404, "image file missing")

    store.update_image(image_id, status="processing")
    out_dir = STORAGE_DIR / f"img_{image_id}"
    out_dir.mkdir(parents=True, exist_ok=True)
    source = f"image#{image_id}" + (f":{req.tree_id}" if req.tree_id else "")
    try:
        rec = grader.analyze_image_file(str(image_path), str(out_dir), source,
                                        drone_mode=req.drone_mode,
                                        upscale=req.upscale,
                                        compare=req.compare)
    except Exception as exc:
        store.update_image(image_id, status="error")
        raise HTTPException(500, f"analysis failed: {exc}")

    # Manually-specified tree id wins; otherwise keep the tree id that
    # olive-p recognised from a QR code in the image.
    if req.tree_id:
        rec["tree_id"] = req.tree_id
    elif not rec.get("tree_id"):
        rec["tree_id"] = None
    # Timestamp the observation at the capture time, not the analysis time.
    rec["observed_at"] = image.get("recorded_at") or image.get("created_at") or rec.get("observed_at")
    target_dt = parse_observed_at_iso(rec.get("observed_at"))
    soil_data = build_soil_data(req.soil_moisture.dict() if req.soil_moisture else None,
                                target_time=target_dt)
    integrate_soil(rec, soil_data)
    rec["soil_source"] = soil_data.get("source", "none")
    rec["health_state"] = health_state(rec)
    try:
        rec["explain_text"] = explain_detection_ja(rec)
    except Exception:
        rec["explain_text"] = None
    for key in ("_frame_raw", "_frame_annotated"):
        if rec.get(key):
            p = Path(rec[key]).resolve()
            try:
                rel = p.relative_to(STORAGE_DIR.resolve())
            except ValueError:
                rel = Path(p.name)
            rec[key + "_url"] = f"/storage/{rel.as_posix()}"

    store.add_observation("image", rec, image_id=image_id, user_id=user["id"])

    # Handle comparison result (non-upscaled pass)
    comp_rec = rec.pop("_comparison", None)
    comparison_obs = None
    if comp_rec and isinstance(comp_rec, dict):
        if req.tree_id:
            comp_rec["tree_id"] = req.tree_id
        elif not comp_rec.get("tree_id"):
            comp_rec["tree_id"] = None
        comp_rec["observed_at"] = rec["observed_at"]
        target_dt2 = parse_observed_at_iso(comp_rec.get("observed_at"))
        soil_data2 = build_soil_data(req.soil_moisture.dict() if req.soil_moisture else None,
                                     target_time=target_dt2)
        integrate_soil(comp_rec, soil_data2)
        comp_rec["soil_source"] = soil_data2.get("source", "none")
        comp_rec["health_state"] = health_state(comp_rec)
        try:
            comp_rec["explain_text"] = explain_detection_ja(comp_rec)
        except Exception:
            comp_rec["explain_text"] = None
        # Convert comparison annotated image path to URL
        for key in ("_frame_raw", "_frame_annotated"):
            if comp_rec.get(key):
                p = Path(comp_rec[key]).resolve()
                try:
                    rel = p.relative_to(STORAGE_DIR.resolve())
                except ValueError:
                    rel = Path(p.name)
                comp_rec[key + "_url"] = f"/storage/{rel.as_posix()}"
        store.add_observation("image", comp_rec, image_id=image_id, user_id=user["id"])
        comparison_obs = comp_rec

    store.update_image(image_id, status="done")
    result = {"observation": rec}
    if comparison_obs:
        result["observations"] = [rec, comparison_obs]
    return result


# --------------------------------------------------------------------------
# Soil moisture
# --------------------------------------------------------------------------
@app.get("/api/soil-moisture/status")
def soil_moisture_status():
    """Report whether automatic soil moisture is available, the latest value,
    sensor staleness and API access monitoring stats."""
    from .soil_moisture import get_fetcher_stats, _parse_api_ts
    try:
        data = build_soil_data(None)
    except Exception as exc:
        return {
            "source": "error",
            "configured": bool(SOIL_MOISTURE_CONFIG_PATH.exists()),
            "soil_moisture": {},
            "health": {},
            "error": str(exc),
            "sensor_online": False,
            "data_age_hours": None,
            "api": get_fetcher_stats(),
        }
    # Compute data freshness
    sm = data.get("soil_moisture", {})
    measured = sm.get("measured_at")
    age_hours = None
    sensor_online = False
    if measured:
        ts = _parse_api_ts(measured)
        if ts:
            from datetime import datetime as _dt
            now = _dt.utcnow().replace(tzinfo=ts.tzinfo) if ts.tzinfo else _dt.utcnow()
            age_hours = round((now - ts).total_seconds() / 3600, 1)
            sensor_online = age_hours < 6  # sensor is "online" if data < 6h old
    return {
        "source": data.get("source", "none"),
        "configured": bool(SOIL_MOISTURE_CONFIG_PATH.exists()),
        "soil_moisture": sm,
        "health": data.get("health", {}),
        "sensor_online": sensor_online,
        "data_age_hours": age_hours,
        "api": get_fetcher_stats(),
    }


# --------------------------------------------------------------------------
# Time-specified analysis
# --------------------------------------------------------------------------
@app.post("/api/videos/{video_id}/analyse")
def analyse_video(video_id: int, req: AnalyseTimesRequest, user: dict = Depends(get_current_user)):
    """Analyse an uploaded video at the given timestamps (seconds)."""
    return _enqueue(video_id, req.times, req.tree_id, req.soil_moisture, user,
                    drone_mode=req.drone_mode, upscale=req.upscale, compare=req.compare)


@app.post("/api/videos/{video_id}/analyse-times")
def analyse_video_text(video_id: int, req: AnalyseTimesTextRequest, user: dict = Depends(get_current_user)):
    """Analyse an uploaded video at the given human time strings."""
    try:
        times = [parse_time(t) for t in req.times]
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return _enqueue(video_id, times, req.tree_id, req.soil_moisture, user,
                    drone_mode=req.drone_mode, upscale=req.upscale, compare=req.compare)


def _enqueue(video_id: int, times: list[float], tree_id: Optional[str],
             soil_moisture: Optional[SoilMoistureInput] = None,
             user: dict = None,
             drone_mode: bool = False,
             upscale: Optional[bool] = None,
             compare: bool = False):
    _owned_video(video_id, user)
    video = store.get_video(video_id)
    if video["status"] == "processing":
        raise HTTPException(409, "video is already being analysed")
    if not times:
        raise HTTPException(400, "no times given")
    job = runner.enqueue(video_id, sorted(set(round(t, 3) for t in times)), tree_id,
                         soil_manual=soil_moisture.dict() if soil_moisture else None,
                         drone_mode=drone_mode, upscale=upscale, compare=compare)
    return {"job": job}


# --------------------------------------------------------------------------
# Results
# --------------------------------------------------------------------------
def _finalize(rows: list[dict]) -> list[dict]:
    """Attach computed health_state, owner (farmer) info, and explain text."""
    owners = {u["id"]: u for u in store.list_users()}
    for o in rows:
        result = o.get("result") or {}
        o["health_state"] = health_state(result)
        uid = o.get("user_id")
        u = owners.get(uid) if uid is not None else None
        if u:
            o["owner"] = {k: u.get(k) for k in ("id", "username", "display_name", "farm_name")}
        else:
            o["owner"] = None
        # Convert storage file paths to web URLs (/storage/...)
        for key in ("annotated_path", "raw_frame_path"):
            p = o.get(key)
            if p:
                o[key] = _url_for_storage(p)
        try:
            o["explain_text"] = explain_detection_ja(result)
        except Exception:
            o["explain_text"] = None
    return rows


def _url_for_storage(path: str) -> str:
    """Convert an absolute storage file path into a /storage/... web URL."""
    try:
        from .config import STORAGE_DIR
        fp = Path(path).resolve()
        sp = Path(STORAGE_DIR).resolve()
        if fp.is_relative_to(sp):
            rel = fp.relative_to(sp)
            return "/" + rel.as_posix()
    except Exception:
        pass
    return path


@app.get("/api/videos/{video_id}/observations")
def video_observations(video_id: int, user: dict = Depends(get_current_user)):
    _owned_video(video_id, user)
    return _finalize(store.list_observations(video_id=video_id, user_id=_scope_id(user)))


@app.get("/api/images/{image_id}/observations")
def image_observations(image_id: int, user: dict = Depends(get_current_user)):
    _owned_image(image_id, user)
    return _finalize(store.list_observations(image_id=image_id, user_id=_scope_id(user)))


@app.get("/api/observations")
def all_observations(source_type: Optional[str] = Query(None),
                     limit: int = Query(200),
                     farmer_id: Optional[int] = Query(None),
                     tree_id: Optional[str] = Query(None),
                     from_date: Optional[str] = Query(None),
                     to_date: Optional[str] = Query(None),
                     user: dict = Depends(get_current_user)):
    if user["role"] == "admin" and farmer_id is not None:
        uid = farmer_id
    else:
        uid = _scope_id(user)
    return _finalize(store.list_observations(source_type=source_type,
                                             user_id=uid,
                                             tree_id=tree_id,
                                             from_date=from_date,
                                             to_date=to_date,
                                             limit=limit))


@app.get("/api/trees")
def list_trees(user: dict = Depends(get_current_user)):
    """Distinct tree ids (QR-recognised or manually assigned) for tree tracing."""
    return store.list_trees(user_id=_scope_id(user))


@app.delete("/api/observations")
def delete_observations(ids: list[int] = Body(..., embed=True),
                        user: dict = Depends(get_current_user)):
    """Bulk delete observations by ids.

    Non-admin users may only delete observations they own.
    """
    uid = _scope_id(user)
    deleted = 0
    not_found = 0
    if len(ids) > 500:
        raise HTTPException(400, "too many observations (max 500)")
    for oid in ids:
        if store.delete_observation_owned(oid, uid):
            deleted += 1
        else:
            not_found += 1
    return {"ok": True, "deleted": deleted, "not_found": not_found}


@app.get("/api/observations/export")
def export_observations(source_type: Optional[str] = Query(None),
                        farmer_id: Optional[int] = Query(None),
                        tree_id: Optional[str] = Query(None),
                        from_date: Optional[str] = Query(None),
                        to_date: Optional[str] = Query(None),
                        user: dict = Depends(get_current_user)):
    """Export observations as CSV (farmer-friendly columns)."""
    import csv as csv_mod
    import io as io_mod
    if user["role"] == "admin" and farmer_id is not None:
        uid = farmer_id
    else:
        uid = _scope_id(user)
    rows = _finalize(store.list_observations(source_type=source_type,
                                             user_id=uid,
                                             tree_id=tree_id,
                                             from_date=from_date,
                                             to_date=to_date,
                                             limit=10000))

    buf = io_mod.StringIO()
    writer = csv_mod.writer(buf)
    writer.writerow([
        "id", "observed_at", "source", "state", "health_score",
        "leaf_count", "fruit_count", "green_coverage", "water_stress",
        "leaf_curl_index", "wrinkled_fruit_count", "tree_id", "farm",
    ])
    for o in rows:
        hs = o.get("health_state") or {}
        lbl = hs.get("label", "")
        state_label = HEALTH_LABELS.get(lbl, {}).get("ja", lbl)
        score = hs.get("score")
        if score is None:
            score = o.get("overall_health_score")
        writer.writerow([
            o.get("id"),
            o.get("observed_at"),
            o.get("source_type") or o.get("source") or "",
            state_label,
            f'{score:.3f}' if score is not None else "",
            o.get("leaf_count") or "",
            o.get("fruit_count") or "",
            o.get("green_coverage") if o.get("green_coverage") is not None else "",
            o.get("water_stress") if o.get("water_stress") is not None else "",
            o.get("leaf_curl_index") if o.get("leaf_curl_index") is not None else "",
            o.get("wrinkled_fruit_count") or "",
            o.get("tree_id") or "",
            (o.get("owner") or {}).get("farm_name") or "",
        ])
    content = "\ufeff" + buf.getvalue()  # BOM for Excel UTF-8
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=observations.csv"},
    )


@app.delete("/api/videos/{video_id}")
def delete_own_video(video_id: int, user: dict = Depends(get_current_user)):
    """Delete the current user's own video (admin may delete any)."""
    _owned_video(video_id, user)
    path = store.delete_video(video_id)
    if path is None:
        raise HTTPException(404, "video not found")
    folder = Path(path).parent if path else None
    if folder and folder.is_dir():
        shutil.rmtree(folder, ignore_errors=True)
    return {"ok": True, "deleted_video": video_id}


@app.delete("/api/images/{image_id}")
def delete_own_image(image_id: int, user: dict = Depends(get_current_user)):
    """Delete the current user's own image (admin may delete any)."""
    _owned_image(image_id, user)
    path = store.delete_image(image_id)
    if path is None:
        raise HTTPException(404, "image not found")
    try:
        p = Path(path)
        if p.is_file():
            p.unlink(missing_ok=True)
    except OSError:
        pass
    return {"ok": True, "deleted_image": image_id}


@app.delete("/api/observations/{observation_id}")
def delete_own_observation(observation_id: int, user: dict = Depends(get_current_user)):
    """Delete the current user's own observation (admin may delete any)."""
    uid = _scope_id(user)
    ok = store.delete_observation_owned(observation_id, uid)
    if not ok:
        raise HTTPException(404, "observation not found")
    return {"ok": True}


def _scope_id(user: dict) -> Optional[int]:
    """Return the user_id filter for a normal user; None (all) for admin."""
    if user["role"] == "admin":
        return None
    return user["id"]


# --------------------------------------------------------------------------
# Static files (frames, annotations) + character SVGs
# --------------------------------------------------------------------------
@app.get("/storage/{folder}/{file_name}")
def storage_file(folder: str, file_name: str):
    path = (STORAGE_DIR / folder / file_name).resolve()
    if not path.is_file():
        raise HTTPException(404, "file not found")
    return FileResponse(path)


# --------------------------------------------------------------------------
# Character health
# --------------------------------------------------------------------------
@app.get("/api/olive/status")
def olive_status(user: dict = Depends(get_current_user),
                 farmer_id: Optional[int] = Query(None)):
    """Aggregate observations into a current state + per-state summaries.

    ``current_state`` is computed from the observations visible to the caller.
    For an admin, ``farmer_id`` scopes the aggregation to a single farmer so
    the dashboard hero matches the farmer-selected trend chart.
    """
    if user["role"] == "admin" and farmer_id is not None:
        uid = farmer_id
    else:
        uid = _scope_id(user)
    obs = store.list_observations(limit=500, user_id=uid)
    latest = {}
    for o in obs:
        vid = o["video_id"]
        if vid not in latest:
            latest[vid] = o
    # Latest observation overall (for display only).
    current = latest[max(latest, key=lambda k: latest[k]["id"])] if latest else None
    states = {
        "happy": 0, "good": 0, "caution": 0, "danger": 0,
    }
    for o in obs:
        st = health_state(o.get("result") or {})
        label = st.get("label", "good")
        states[label] = states.get(label, 0) + 1
    payload = {
        "states": states,
        "total_observations": len(obs),
        "latest": current,
        "labels": HEALTH_LABELS,
        "current_state": aggregate_health_state(obs),
    }
    if current:
        payload["current_video"] = current.get("filename")
        payload["current_timestamp"] = current.get("timestamp_sec")
    return payload


# --------------------------------------------------------------------------
# Admin / system management
# --------------------------------------------------------------------------
def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 6:
        return "*" * len(key)
    return f"{key[:4]}{'*' * max(4, len(key) - 8)}{key[-4:]}"


def _soil_doc() -> dict:
    """Return soil config as a dict suitable for the admin editor (key masked)."""
    cfg = {}
    if SOIL_MOISTURE_CONFIG_PATH.exists():
        try:
            cfg = yaml.safe_load(SOIL_MOISTURE_CONFIG_PATH.read_text(encoding="utf-8")) or {}
        except Exception:
            cfg = {}
    masked = dict(cfg)
    if cfg.get("api_key"):
        masked["api_key"] = _mask_key(str(cfg["api_key"]))
    return {
        "configured": SOIL_MOISTURE_CONFIG_PATH.exists(),
        "config": masked,
        "path": str(SOIL_MOISTURE_CONFIG_PATH),
    }


@app.get("/api/admin/stats")
def admin_stats(_: dict = Depends(require_admin)):
    return {
        "settings": load_settings(),
        "soil": _soil_doc(),
        "max_upload_mb": MAX_UPLOAD_MB,
        "db": store.stats(),
    }


@app.get("/api/admin/settings")
def admin_get_settings(_: dict = Depends(require_admin)):
    return load_settings()


@app.get("/api/settings")
def public_get_settings():
    """Public, read-only copy of site branding settings (no auth needed)."""
    s = load_settings()
    return {"site": s.get("site", {})}


@app.put("/api/admin/settings")
def admin_put_settings(payload: dict = Body(...), _: dict = Depends(require_admin)):
    return save_settings(payload)


@app.post("/api/admin/soil-config/test")
def admin_test_soil(_: dict = Depends(require_admin)):
    from .soil_moisture import build_soil_data
    try:
        data = build_soil_data(None)
        return {
            "source": data.get("source", "none"),
            "soil_moisture": data.get("soil_moisture", {}),
            "health": data.get("health", {}),
            "configured": SOIL_MOISTURE_CONFIG_PATH.exists(),
            "error": None,
        }
    except Exception as exc:
        return {
            "source": "error",
            "soil_moisture": {},
            "health": {},
            "configured": SOIL_MOISTURE_CONFIG_PATH.exists(),
            "error": str(exc),
        }


@app.put("/api/admin/soil-config")
def admin_put_soil_config(payload: dict = Body(...), _: dict = Depends(require_admin)):
    """Save soil moisture config from the admin editor (api_key masked in
    the response; if a masked key is sent back, keep the original)."""
    cfg = dict(payload or {})
    existing = {}
    if SOIL_MOISTURE_CONFIG_PATH.exists():
        try:
            existing = yaml.safe_load(SOIL_MOISTURE_CONFIG_PATH.read_text(encoding="utf-8")) or {}
        except Exception:
            existing = {}
    new_key = cfg.get("api_key")
    old_key = existing.get("api_key", "")
    if new_key is None:
        cfg["api_key"] = old_key
    elif new_key == "":
        cfg["api_key"] = ""
    elif old_key and new_key == _mask_key(old_key):
        cfg["api_key"] = old_key
    elif isinstance(new_key, str) and new_key.startswith("****"):
        cfg["api_key"] = old_key
    SOIL_MOISTURE_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    SOIL_MOISTURE_CONFIG_PATH.write_text(
        yaml.safe_dump(cfg, allow_unicode=True, default_flow_style=False),
        encoding="utf-8")
    return _soil_doc()


@app.delete("/api/admin/videos/{video_id}")
def admin_delete_video(video_id: int, _: dict = Depends(require_admin)):
    path = store.delete_video(video_id)
    if path is None:
        raise HTTPException(404, "video not found")
    folder = Path(path).parent if path else None
    if folder and folder.is_dir():
        shutil.rmtree(folder, ignore_errors=True)
    return {"ok": True, "deleted_video": video_id}


@app.delete("/api/admin/images/{image_id}")
def admin_delete_image(image_id: int, _: dict = Depends(require_admin)):
    path = store.delete_image(image_id)
    if path is None:
        raise HTTPException(404, "image not found")
    try:
        p = Path(path)
        if p.is_file():
            p.unlink(missing_ok=True)
    except OSError:
        pass
    return {"ok": True, "deleted_image": image_id}


@app.delete("/api/admin/observations/{observation_id}")
def admin_delete_observation(observation_id: int, _: dict = Depends(require_admin)):
    ok = store.delete_observation(observation_id)
    if not ok:
        raise HTTPException(404, "observation not found")
    return {"ok": True}


@app.post("/api/admin/observations/clear")
def admin_clear_observations(_: dict = Depends(require_admin)):
    n = store.clear_observations()
    return {"ok": True, "deleted": n}


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------
@app.post("/api/notifications")
def create_notification(req: dict, user: dict = Depends(require_admin)):
    """Create a notification (admin only)."""
    title = req.get("title", "").strip()
    body = req.get("body", "").strip()
    target_role = req.get("target_role", "all")
    target_user_id = req.get("target_user_id")
    if not title or not body:
        raise HTTPException(400, "title and body are required")
    nid = store.add_notification(title, body, user["id"], target_role, target_user_id)
    return {"id": nid, "ok": True}


@app.get("/api/notifications")
def list_notifications(user: dict = Depends(get_current_user)):
    """List notifications for the current user."""
    notifs = store.list_notifications(user["id"], user["role"])
    return notifs


@app.get("/api/notifications/unread-count")
def unread_count(user: dict = Depends(get_current_user)):
    """Get count of unread notifications."""
    count = store.count_unread_notifications(user["id"], user["role"])
    return {"count": count}


@app.post("/api/notifications/{notification_id}/read")
def mark_read(notification_id: int, user: dict = Depends(get_current_user)):
    """Mark a notification as read."""
    store.mark_notification_read(notification_id, user["id"])
    return {"ok": True}


@app.delete("/api/notifications/{notification_id}")
def delete_notification(notification_id: int, _: dict = Depends(require_admin)):
    """Delete a notification (admin only)."""
    store.delete_notification(notification_id)
    return {"ok": True}


# --------------------------------------------------------------------------
# Farmer management (admin only)
# --------------------------------------------------------------------------
@app.get("/api/admin/farmers")
def admin_list_farmers(_: dict = Depends(require_admin)):
    """List all farmer accounts with data counts and health-state aggregates."""
    farmers = [u for u in store.list_users() if u["role"] == "farmer"]
    state_dist = {}
    latest_at = {}
    for o in store.list_observations(limit=1000000):
        uid = o.get("user_id")
        if uid is None:
            continue
        st = health_state(o.get("result") or {})
        label = st.get("label", "good")
        d = state_dist.setdefault(uid, {})
        d[label] = d.get(label, 0) + 1
        if uid not in latest_at:
            latest_at[uid] = o.get("observed_at")
    out = []
    for f in farmers:
        d = state_dist.get(f["id"], {})
        out.append({
            **f,
            "video_count": store.count_videos(user_id=f["id"]),
            "image_count": store.count_images(user_id=f["id"]),
            "observation_count": store.count_observations(user_id=f["id"]),
            "states": {k: d.get(k, 0) for k in ("happy", "good", "caution", "danger")},
            "latest_observed_at": latest_at.get(f["id"]),
        })
    return out


@app.put("/api/admin/farmers/{user_id}")
def admin_update_farmer(user_id: int, req: FarmerUpdateRequest,
                        _: dict = Depends(require_admin)):
    user = store.get_user(user_id)
    if user is None or user["role"] != "farmer":
        raise HTTPException(404, "農家が見つかりません")
    changes = {}
    if req.display_name is not None:
        changes["display_name"] = req.display_name.strip()
    if req.farm_name is not None:
        changes["farm_name"] = req.farm_name.strip()
    for key in ("farm_area", "farm_variety", "farm_location", "farm_contact"):
        val = getattr(req, key)
        if val is not None:
            changes[key] = str(val).strip()
    if req.farm_trees is not None:
        if req.farm_trees < 0:
            raise HTTPException(400, "farm_trees must be a non-negative integer")
        changes["farm_trees"] = req.farm_trees
    if req.is_active is not None:
        changes["is_active"] = 1 if req.is_active else 0
    store.update_user(user_id, **changes)
    return store.get_user(user_id)


@app.put("/api/admin/farmers/{user_id}/password")
def admin_reset_farmer_password(user_id: int, req: PasswordResetRequest,
                                _: dict = Depends(require_admin)):
    user = store.get_user(user_id)
    if user is None or user["role"] != "farmer":
        raise HTTPException(404, "農家が見つかりません")
    store.set_user_password(user_id, req.new_password)
    return {"ok": True, "username": user["username"]}


@app.delete("/api/admin/farmers/{user_id}")
def admin_delete_farmer(user_id: int, _: dict = Depends(require_admin)):
    user = store.get_user(user_id)
    if user is None or user["role"] != "farmer":
        raise HTTPException(404, "農家が見つかりません")
    removed = store.delete_user(user_id)
    return {"ok": True, "removed": removed}


# --------------------------------------------------------------------------
# Entrypoint
# --------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, reload=False)
