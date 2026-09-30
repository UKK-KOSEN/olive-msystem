"""olive-msystem FastAPI application."""
from __future__ import annotations

import logging
import logging.handlers
import time
import traceback
import uvicorn
import yaml
from datetime import datetime as _dt
from functools import lru_cache
from pathlib import Path
from typing import Optional

from fastapi import (Body, Depends, FastAPI, File, Form, Header, HTTPException,
                     Query, Request, UploadFile)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db_redundancy
from .analyzer import OliveAnalyzer, parse_time
from .captured import extract_captured_at, parse_captured_candidate
from .translate_report import explain_detection_ja
from .auth import get_current_user, require_admin
from .config import (CORS_ORIGINS, DATA_DIR, DB_PATH, HOST, INSTANCE_ID,
                     INSTANCE_ROLE, IS_ACTIVE, MAX_UPLOAD_MB, PORT,
                     ROOT, SETTINGS_PATH, SOIL_MOISTURE_CONFIG_PATH,
                     STORAGE_DIR, UPLOAD_DIR, ensure_dirs,
                     load_settings, save_settings)
from .errors import app_error, error_body
from .health import HEALTH_LABELS, health_state, aggregate_health_state
from .models import (AnalyseImageRequest, AnalyseTimesRequest,
                     AnalyseTimesTextRequest, SoilMoistureInput,
                     RegisterRequest, LoginRequest, FarmerUpdateRequest,
                     PasswordResetRequest, TreeCreate, TreeUpdate)
from .runner import Runner
from .soil_moisture import build_soil_data, integrate as integrate_soil, parse_observed_at_iso
from .storage import Store, get_dummy_password_hash, hash_password, verify_password

ensure_dirs()
_LOGS_DIR = ROOT / "logs"
try:
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)
except OSError:
    pass
_BOOT_TIME = time.time()

# Farm-map grid: rows are assigned in whole-row units of this many columns.
GRID_COLS = 3

app = FastAPI(title="olive-msystem", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def standby_read_only(request, call_next):
    if (
        INSTANCE_ROLE == "standby"
        and request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.url.path not in {"/api/health", "/api/health/ready"}
    ):
        return JSONResponse(
            status_code=503,
            content={"detail": "スタンバイインスタンスでは書き込み操作を受け付けません"},
        )
    # If the DB was unavailable at boot, retry lazily before any handler runs
    # so a transient startup lock cannot take the whole API down. Health probes
    # keep working in degraded mode (they report "degraded" themselves).
    if store is None and request.url.path not in {"/api/health", "/api/health/ready"}:
        st = _ensure_store()
        if st is None:
            return JSONResponse(
                status_code=503,
                content={"detail": "データベースが一時的に利用できません。しばらくしてから再試行してください。"},
            )
    return await call_next(request)


def _open_store_with_retries(max_attempts: int = 4) -> Store:
    """Open the SQLite store, retrying transient lock/corruption errors.

    Import must never fail because the DB was momentarily locked or the
    schema init hit a transient error; the watchdog keeps the service alive,
    so a few bounded retries here prevent the boot-time crash loop (F1/F2).

    If the failure looks like a broken file rather than a lock, the newest
    rotated backup is restored once, then the open is retried on the same
    attempt budget.  A corrupt database therefore becomes a bounded rollback
    to the last snapshot instead of a degraded/broken boot.
    """
    last_exc: Optional[Exception] = None
    restored_from: Optional[Path] = None
    for attempt in range(1, max_attempts + 1):
        try:
            return Store(DB_PATH, initialize_schema=IS_ACTIVE, read_only=not IS_ACTIVE)
        except Exception as exc:  # noqa: PERF203
            last_exc = exc
            if restored_from is None and db_redundancy.looks_like_corruption(exc):
                restored_from = db_redundancy.restore_latest_backup()
                if restored_from is not None:
                    continue  # do not sleep: retry against the restored file now
            if attempt < max_attempts:
                time.sleep(2 * attempt)
    raise RuntimeError(
        f"could not open the database after {max_attempts} attempts"
        + (f" (restored from {restored_from})" if restored_from else "")
        + f": {last_exc}")


try:
    store = _open_store_with_retries()
    _store_ready = True
except Exception:
    # Boot must survive even a broken DB: report degraded via /api/health and
    # let the operator see the error instead of a crash loop. A fresh Store is
    # attempted lazily by _ensure_store on the first request.
    logging.getLogger("olive-msystem").exception("database init failed; starting degraded")
    store = None
    _store_ready = False


@lru_cache(maxsize=1)
def get_grader():
    return OliveAnalyzer()


if IS_ACTIVE:
    try:
        get_grader()
    except Exception:
        logging.getLogger("olive-msystem").warning(
            "olive-p detection engine unavailable at boot; analysis will fall back "
            "to per-request errors until it becomes available", exc_info=True)


runner: Optional[Runner] = None
if IS_ACTIVE and _store_ready:
    try:
        # workers default from config; construction is guarded so a thread
        # start failure or a first-connection DB error cannot kill the boot.
        runner = Runner(store)
    except Exception:
        logging.getLogger("olive-msystem").exception(
            "runner could not be started; video analysis is disabled for this boot")

# The active instance snapshots the DB to a rotated backup set; only one
# writer should do this, so standby instances skip it entirely.
if IS_ACTIVE:
    db_redundancy.start_backup_scheduler()

# Log to both console and a rotating file, so a crash/restart can be
# investigated later even if the console window was closed.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("olive-msystem")
try:
    _file_handler = logging.handlers.RotatingFileHandler(
        _LOGS_DIR / "backend.log", maxBytes=5_000_000, backupCount=3,
        encoding="utf-8")
    _file_handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.getLogger().addHandler(_file_handler)
    logger.info("backend booted (pid=%d, db=%s)", __import__("os").getpid(), DB_PATH)
except Exception:
    pass  # logging is best-effort; never block startup on it


def _ensure_store() -> Optional[Store]:
    """Return the store, lazily re-opening it if the boot-time open failed.

    A transient DB lock at startup must not leave the process permanently
    degraded; the first request that needs ``store`` retries the open.
    """
    global store, _store_ready
    if store is not None:
        return store
    try:
        store = _open_store_with_retries(max_attempts=1)
        _store_ready = True
        logger.info("database re-opened successfully after degraded boot")
    except Exception:
        logger.warning("database still unavailable (degraded mode)")
    return store


@app.get("/api/health")
def health():
    """Liveness probe for the ops monitor / load balancer (no auth)."""
    counts = {}
    db_ok = False
    try:
        st = _ensure_store()
        if st is not None:
            counts = st.count()
            db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "service": "olive-msystem-backend",
        "version": app.version,
        "instance_id": INSTANCE_ID,
        "role": INSTANCE_ROLE,
        "active": IS_ACTIVE,
        "ready": IS_ACTIVE and db_ok,
        "can_promote": db_ok,
        "write_enabled": IS_ACTIVE,
        "db_status": "ok" if db_ok else "error",
        "db_path": str(DB_PATH),
        "db_backup": db_redundancy.backup_status(),
        "uptime_sec": int(time.time() - _BOOT_TIME),
        "timestamp": _dt.now().astimezone().isoformat(timespec="seconds"),
        **counts,
    }


@app.get("/api/health/ready")
def health_ready():
    """Readiness probe: return 503 until the active instance can use its DB."""
    payload = health()
    if not payload["ready"]:
        raise app_error(503, "UNAVAILABLE_NOT_READY", "backend is not ready")
    return payload


# ---- Sensor anomaly monitor (background thread) ---------------------------
import threading
from datetime import datetime as _dt, timezone as _tz
from .sensor_alerts import run_monitor as _sensor_alerts_run
from .sensor_alerts import load_alerts_config as _alerts_cfg


def _safe_monitor_interval() -> float:
    """Return the configured check interval (>= 30s), never raising."""
    try:
        cfg = _alerts_cfg() or {}
        return max(float(cfg.get("check_interval_minutes", 10)) * 60, 30)
    except Exception:
        return 600


def _sensor_monitor_loop():
    """Background thread: run the sensor-alert state machine periodically.

    Runs once immediately after startup so anomalies are detected without
    waiting, then sleeps for the configured check interval. Every step is
    guarded so one bad config value or DB hiccup can never kill the thread.
    """
    while True:
        interval_sec = _safe_monitor_interval()
        try:
            if store is not None:
                _sensor_alerts_run(store)
        except Exception:
            logger.exception("sensor monitor error")
        try:
            time.sleep(interval_sec)
        except Exception:  # pragma: no cover
            time.sleep(600)


def _seed_admin() -> None:
    """Ensure an admin account exists with a safe password.

    * First startup: creates "admin" with a random 10-digit numeric password
      (override via ADMIN_USERNAME / ADMIN_PASSWORD env).
    * If the admin account still uses the documented default "admin123",
      it is rotated once to a random numeric password.
    * If ADMIN_PASSWORD is set, the admin password is left untouched.

    A generated password is logged once at startup so it can be retrieved.
    """
    if store is None:
        logger.warning("seed admin skipped: database unavailable")
        return
    try:
        _seed_admin_inner()
    except Exception:
        # A failure here must never block web serving; retry on next boot.
        logger.exception("admin seeding failed (non-fatal)")


def _seed_admin_inner() -> None:
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


if IS_ACTIVE:
    try:
        _sensor_thread = threading.Thread(target=_sensor_monitor_loop, daemon=True)
        _sensor_thread.start()
    except Exception:
        logger.exception("sensor monitor thread could not be started")
        _sensor_thread = None
    _seed_admin()
else:
    _sensor_thread = None


# --------------------------------------------------------------------------
# Health / metadata
# --------------------------------------------------------------------------
@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception):
    logger.error("unhandled error on %s: %s", request.url.path, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "サーバー内部でエラーが発生しました",
                 "code": "SERVER_INTERNAL"},
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
    return JSONResponse(status_code=422,
                        content={"detail": msg, "code": "VALIDATION_ERROR"})


@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request, exc: StarletteHTTPException):
    if exc.status_code >= 500:
        logger.error("http %s error on %s: %s", exc.status_code, request.url.path, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={**error_body(exc)})


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
                {"path": "/api/sensor-alerts", "method": "GET", "description": "センサー異常監視の状態・履歴"},
                {"path": "/api/admin/soil-config/test-notification", "method": "POST", "description": "通知チャネルのテスト送信（管理者）"},
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
class _RateGuard:
    """In-memory failed-attempt throttle (per key, sliding window + lockout).

    ``record_failure`` pushes the current time onto a key's window; once the
    number of failures inside the window reaches ``max_fails`` the key is
    locked for ``lock_secs``. Login uses key ``"login|<ip>|<username>``,
    registration uses ``"reg|<ip>"``. State lives in this process only, which
    is sufficient for the single-node architecture (the active instance
    handles all writes; the standby disallows POSTs entirely).
    """

    def __init__(self, window: float = 900, max_fails: int = 5,
                 lock_secs: float = 900):
        self._window = window
        self._max_fails = max_fails
        self._lock_secs = lock_secs
        self._mu = threading.Lock()
        self._fails: dict[str, list[float]] = {}
        self._locked_until: dict[str, float] = {}

    def lock_remaining(self, key: str) -> int:
        with self._mu:
            until = self._locked_until.get(key, 0.0)
            return max(0, int(until - time.time()))

    def record_failure(self, key: str) -> None:
        with self._mu:
            now = time.time()
            recent = [t for t in self._fails.get(key, []) if t > now - self._window]
            recent.append(now)
            self._fails[key] = recent
            if len(recent) >= self._max_fails:
                self._locked_until[key] = now + self._lock_secs
                self._fails.pop(key, None)

    def record_success(self, key: str) -> None:
        with self._mu:
            self._fails.pop(key, None)
            self._locked_until.pop(key, None)


_login_guard = _RateGuard()
_registration_guard = _RateGuard(window=3600, max_fails=8, lock_secs=3600)


def _client_ip(request: Request) -> str:
    return (request.client.host if request.client else "?")


@app.post("/api/auth/register")
def register(req: RegisterRequest, request: Request):
    """Self-registration for farmers. Creates a farmer account."""
    reg_key = f"reg|{_client_ip(request)}"
    if _registration_guard.lock_remaining(reg_key):
        raise app_error(429, "LIMIT_REGISTRATION",
                        "登録が一時的に制限されています。しばらくしてから再試行してください")
    _registration_guard.record_failure(reg_key)
    username = req.username.strip()
    user = store.create_user(
        username,
        req.password,
        role="farmer",
        display_name=(req.display_name or "").strip() or None,
        farm_name=(req.farm_name or "").strip() or None,
    )
    if user is None:
        raise app_error(409, "AUTH_USERNAME_TAKEN", "このユーザー名は既に使われています")
    token = store.create_session(user["id"])
    return {"token": token, "user": user}


@app.post("/api/auth/login")
def login(req: LoginRequest, request: Request):
    username = req.username.strip()
    key = f"login|{_client_ip(request)}|{username}"
    locked_for = _login_guard.lock_remaining(key)
    if locked_for:
        raise app_error(429, "AUTH_LOCKED",
                        f"連続失敗のためログインが一時的にロックされています（残り 約 {locked_for} 秒）")
    user = store.get_user_by_username(username)
    # Timing-equalized: an unknown username still runs one real hash
    # verification, so response latency does not reveal that a user exists.
    stored = user["password_hash"] if user else get_dummy_password_hash()
    ok = verify_password(req.password, stored)
    if not ok or user is None:
        _login_guard.record_failure(key)
        logger.warning("auth: failed login attempt user=%r ip=%s", username, _client_ip(request))
        raise app_error(401, "AUTH_BAD_CREDENTIALS", "ユーザー名またはパスワードが正しくありません")
    if not user.get("is_active"):
        raise app_error(403, "AUTH_ACCOUNT_DISABLED", "このアカウントは無効です")
    _login_guard.record_success(key)
    # 旧方式(PBKDF2)のハッシュは、ログイン成功時に Argon2id へ逐次移行
    if not user["password_hash"].startswith("$argon2id$"):
        try:
            store.set_password_hash(user["id"], hash_password(req.password))
        except Exception:  # 移行失敗してもログインは継続
            logger.warning("password hash migration failed for user %s", user["username"], exc_info=True)
    logger.info("login ok: user=%s ip=%s", user["username"], _client_ip(request))
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
def update_profile(req: dict, user: dict = Depends(get_current_user),
                   authorization: str = Header(default="")):
    """Update the current user's profile (account, farm info, password, preferences)."""
    current_token = ""
    if authorization.lower().startswith("bearer "):
        current_token = authorization[7:].strip()
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
                raise app_error(400, "VALIDATION_FARM_TREES", "farm_trees must be a non-negative integer")
    if fields:
        store.update_user(user["id"], **fields)
    if req.get("password"):
        if len(str(req["password"])) < 6:
            raise app_error(400, "VALIDATION_PASSWORD", "password must be at least 6 characters")
        store.set_user_password(user["id"], str(req["password"]))
        # Invalidate any other active session of this account (e.g. an old
        # device), while keeping the session that made the change logged in.
        if current_token:
            store.delete_other_sessions(user["id"], current_token)
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
def _save_upload(file: UploadFile, dest: Path) -> int:
    """Stream an uploaded file to disk in bounded chunks.

    Reading the whole body into RAM (the naive ``await file.read()``) lets a
    single large upload OOM the process (unrecoverable). Streaming writes in
    1 MiB chunks keeps memory bounded and enforces the size limit as we go.
    """
    limit = MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    out.close()
                    try:
                        dest.unlink(missing_ok=True)
                    except OSError:
                        pass
                    raise app_error(413, "LIMIT_UPLOAD_TOO_LARGE", "file too large")
                out.write(chunk)
    except OSError as exc:
        raise app_error(500, "SERVER_UPLOAD_WRITE", f"upload failed: {exc}")
    return size


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
        raise app_error(400, "VALIDATION_NO_FILENAME", "no filename")
    if file.filename.lower().split(".")[-1] not in {"mp4", "avi", "mov", "mkv", "webm", "m4v"}:
        raise app_error(400, "VALIDATION_UNSUPPORTED_VIDEO", "unsupported video format")

    safe_name = Path(file.filename).name
    dest = UPLOAD_DIR / safe_name
    counter = 1
    while dest.exists():
        dest = UPLOAD_DIR / f"{Path(file.filename).stem}_{counter}{dest.suffix}"
        counter += 1
    size = _save_upload(file, dest)

    recorded_at = parse_captured_candidate(captured_at) or extract_captured_at(dest)
    video_id = store.add_video(safe_name, str(dest), size, user_id=user["id"],
                               recorded_at=recorded_at)
    # Try to read metadata (duration etc.).
    try:
        info = get_grader().video_info(str(dest))
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
        v["storage_path"] = "/media/" + Path(v["storage_path"]).name
    return videos


@app.get("/api/videos/jobs")
def video_jobs(user: dict = Depends(get_current_user)):
    """Return the current processing queue with progress for the running user."""
    jobs = runner.jobs() if runner is not None else []
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
        raise app_error(400, "VALIDATION_NO_FILENAME", "no filename")
    ext = file.filename.lower().rsplit(".", 1)[-1] if "." in file.filename else ""
    if ext not in {"jpg", "jpeg", "png", "bmp", "tif", "tiff", "webp"}:
        raise app_error(400, "VALIDATION_UNSUPPORTED_IMAGE", "unsupported image format")

    content = await file.read()
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise app_error(413, "LIMIT_UPLOAD_TOO_LARGE", "file too large")

    safe_name = Path(file.filename).name
    dest = UPLOAD_DIR / safe_name
    counter = 1
    while dest.exists():
        dest = UPLOAD_DIR / f"{Path(file.filename).stem}_{counter}{dest.suffix}"
        counter += 1
    size = _save_upload(file, dest)

    recorded_at = parse_captured_candidate(captured_at) or extract_captured_at(dest)
    image_id = store.add_image(safe_name, str(dest), size, user_id=user["id"],
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
        raise app_error(404, "NOT_FOUND_IMAGE", "image not found")
    if user["role"] != "admin" and image.get("user_id") != user["id"]:
        raise app_error(403, "AUTH_FORBIDDEN", "この画像にはアクセスできません")
    return image


def _owned_video(video_id: int, user: dict) -> dict:
    """Return the video if the current user may access it."""
    video = store.get_video(video_id)
    if video is None:
        raise app_error(404, "NOT_FOUND_VIDEO", "video not found")
    if user["role"] != "admin" and video.get("user_id") != user["id"]:
        raise app_error(403, "AUTH_FORBIDDEN", "この動画にはアクセスできません")
    return video


def _unlink_upload(absolute_path: Optional[str]) -> None:
    """Delete a single uploaded file that was stored directly under UPLOAD_DIR.

    Videos/images are saved as ``UPLOAD_DIR/<filename>`` (no per-row folder),
    so we must only remove the file itself — never the directory.
    """
    if not absolute_path:
        return
    try:
        p = Path(absolute_path)
        if p.is_file():
            p.unlink(missing_ok=True)
    except OSError:
        pass


@app.post("/api/images/{image_id}/analyse")
def analyse_image(image_id: int, req: AnalyseImageRequest, user: dict = Depends(get_current_user)):
    """Analyse a single uploaded image (synchronous, single image)."""
    image = _owned_image(image_id, user)
    image_path = Path(image["storage_path"])
    if not image_path.exists():
        raise app_error(404, "NOT_FOUND_IMAGE_FILE", "image file missing")

    try:
        store.update_image(image_id, status="processing")
        out_dir = STORAGE_DIR / f"img_{image_id}"
        out_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        # A DB/file error here must not leave the image permanently in a
        # half-written state; the image row is unchanged unless analysis ran.
        logger.exception("could not mark image %s as processing", image_id)
    source = f"image#{image_id}" + (f":{req.tree_id}" if req.tree_id else "")
    try:
        rec = get_grader().analyze_image_file(str(image_path), str(out_dir), source,
                                        drone_mode=req.drone_mode,
                                        upscale=req.upscale)
    except Exception as exc:
        try:
            store.update_image(image_id, status="error")
        except Exception:
            logger.exception("could not mark image %s as error", image_id)
        raise app_error(500, "SERVER_ANALYSIS_FAILED", f"analysis failed: {exc}")

    # Manually-specified tree id wins; otherwise keep the tree id that
    # olive-p recognised from a QR code in the image.
    if req.tree_id:
        rec["tree_id"] = req.tree_id
    elif not rec.get("tree_id"):
        rec["tree_id"] = None
    # Timestamp the observation at the capture time, not the analysis time.
    rec["observed_at"] = image.get("recorded_at") or image.get("created_at") or rec.get("observed_at")

    def _enrich(rec_: dict) -> None:
        target_dt = parse_observed_at_iso(rec_.get("observed_at"))
        try:
            soil_data = build_soil_data(req.soil_moisture.dict() if req.soil_moisture else None,
                                        target_time=target_dt)
            integrate_soil(rec_, soil_data)
            rec_["soil_source"] = soil_data.get("source", "none")
        except Exception:
            # Soil enrichment is optional; a failure must never lose the image.
            rec_["soil_source"] = "error"
        rec_["health_state"] = health_state(rec_)
        try:
            rec_["explain_text"] = explain_detection_ja(rec_)
        except Exception:
            rec_["explain_text"] = None
        for key in ("_frame_raw", "_frame_annotated"):
            if rec_.get(key):
                p = Path(rec_[key]).resolve()
                try:
                    rel = p.relative_to(STORAGE_DIR.resolve())
                except ValueError:
                    rel = Path(p.name)
                rec_[key + "_url"] = f"/storage/{rel.as_posix()}"

    try:
        _enrich(rec)
        try:
            store.add_observation("image", rec, image_id=image_id, user_id=user["id"])
        except Exception:
            logger.exception("could not persist image observation %s", image_id)
    except Exception:
        # If even post-processing broke (e.g. a corrupt result), keep the
        # frame but still finish the image so it is not locked at "processing".
        logger.exception("image analysis post-processing error")
        pass

    # Handle comparison result (non-upscaled pass)
    comp_rec = rec.pop("_comparison", None)
    comparison_obs = None
    if comp_rec and isinstance(comp_rec, dict):
        if req.tree_id:
            comp_rec["tree_id"] = req.tree_id
        elif not comp_rec.get("tree_id"):
            comp_rec["tree_id"] = None
        comp_rec["observed_at"] = rec["observed_at"]
        try:
            _enrich(comp_rec) if comp_rec else None
            store.add_observation("image", comp_rec, image_id=image_id, user_id=user["id"])
        except Exception:
            logger.exception("comparison observation skipped")
    try:
        store.update_image(image_id, status="done")
    except Exception:
        logger.exception("could not mark image %s as done", image_id)

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
            now = _dt.now(_tz.utc).replace(tzinfo=ts.tzinfo) if ts.tzinfo else _dt.now(_tz.utc)
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


@app.get("/api/sensor-alerts")
def sensor_alerts_status(user: dict = Depends(get_current_user)):
    """Current sensor-anomaly monitoring snapshot (evaluated state + history)."""
    from .sensor_alerts import status as _alerts_status
    st = _ensure_store()
    if st is None:
        raise app_error(503, "UNAVAILABLE_DATABASE", "database is unavailable")
    return _alerts_status(st)


@app.post("/api/admin/soil-config/test-notification")
def admin_test_notifications(_: dict = Depends(require_admin)):
    """Send a test message through every configured notification channel."""
    from .sensor_alerts import test_channels, load_alerts_config
    st = _ensure_store()
    if st is None:
        raise app_error(503, "UNAVAILABLE_DATABASE", "database is unavailable")
    return {
        "results": test_channels(st),
        "enabled": load_alerts_config().get("enabled", True),
    }


_TEMPLATE_PREVIEW_SAMPLES: dict = {
    "stale": {
        "title": "土壌水分センサー: データ更新停止",
        "body": "最終データ: 2026-09-11T06:37:38Z（約 6.5 時間前）（Kit: shodoshima-field-01）",
        "severity": "critical", "mode": "stale",
        "kit_id": "shodoshima-field-01", "measured_at": "2026-09-11T06:37:38Z",
        "age_hours": 6.5, "sensor1": 4.3, "sensor2": 78.08,
        "temperature": 27.6, "humidity": 56.3,
    },
    "risk": {
        "title": "土壌水分センサー: 水分値の異常",
        "body": "土壌水分に異常値が検出されました。",
        "severity": "warning", "mode": "risk",
        "kit_id": "shodoshima-field-01", "measured_at": "2026-09-11T07:00:00Z",
        "age_hours": 0, "sensor1": 92.4, "sensor2": 45.1,
        "temperature": 24.8, "humidity": 61.0,
    },
    "recovered": {
        "title": "土壌水分センサー: 復旧しました",
        "body": "土壌水分センサーは正常な状態に戻りました。",
        "severity": "info", "mode": "ok",
        "kit_id": "shodoshima-field-01", "measured_at": "2026-09-11T08:00:00Z",
        "age_hours": 0, "sensor1": 52.3, "sensor2": 61.8,
        "temperature": 25.1, "humidity": 57.2,
    },
    "test": {
        "title": "土壌水分センサー: テスト通知",
        "body": "これはテスト通知です。\n土壌水分センサーで異常が検出された際に、このチャネルへ通知が送信されます。",
        "severity": "test", "mode": "test",
        "kit_id": "shodoshima-field-01", "measured_at": "2026-09-11T09:00:00Z",
        "age_hours": 0, "sensor1": 45.0, "sensor2": 62.5,
        "temperature": 25.5, "humidity": 58.0,
    },
}


@app.post("/api/admin/soil-config/template-preview")
def admin_template_preview(payload: dict = Body(...), _: dict = Depends(require_admin)):
    """Render a message template against a sample alert and return the preview.

    Request body::

      {
        "template": {"title": "...", "body": "..."},   # or a preset name str
        "sample": "stale" | "risk" | "recovered" | "test",
        "webhook_format": "json" | "discord" | "line_notify" | "text"
      }

    Response: rendered title/body plus the payload that would be sent
    (fields, discord embed, etc.).
    """
    from .sensor_alerts import _render, _resolve_template, _template_context, _discord_payload, _json_payload
    from .sensor_alerts import load_alerts_config

    acfg = load_alerts_config()
    sample = payload.get("sample") or "test"
    fmt = (payload.get("webhook_format") or "json").lower()
    tmpl = payload.get("template") or {}

    ev = _TEMPLATE_PREVIEW_SAMPLES.get(sample, _TEMPLATE_PREVIEW_SAMPLES["test"])
    if not isinstance(tmpl, dict):
        tmpl = _resolve_template(acfg, {"template": tmpl} if tmpl else {})
    tctx = _template_context(ev, acfg)
    title = _render(tmpl.get("title"), tctx) or ev["title"]
    body = _render(tmpl.get("body"), tctx) or ev["body"]
    text = f"[{ev['severity']}] {title}\n{body}"

    preview_payload: dict
    if fmt == "discord":
        preview_payload = _discord_payload(title, body, ev["severity"], text, tctx)
    elif fmt == "line_notify":
        preview_payload = {"form": {"message": text}}
    elif fmt == "text":
        preview_payload = {"plain": text}
    else:  # json
        preview_payload = _json_payload(title, body, ev["severity"], text)
    return {
        "sample": sample,
        "severity": ev["severity"],
        "title": title,
        "body": body,
        "text": text,
        "payload": preview_payload,
    }


# --------------------------------------------------------------------------
# Time-specified analysis
# --------------------------------------------------------------------------
@app.post("/api/videos/{video_id}/analyse")
def analyse_video(video_id: int, req: AnalyseTimesRequest, user: dict = Depends(get_current_user)):
    """Analyse an uploaded video at the given timestamps (seconds)."""
    return _enqueue(video_id, req.times, req.tree_id, req.soil_moisture, user,
                    drone_mode=req.drone_mode, upscale=req.upscale)


@app.post("/api/videos/{video_id}/analyse-times")
def analyse_video_text(video_id: int, req: AnalyseTimesTextRequest, user: dict = Depends(get_current_user)):
    """Analyse an uploaded video at the given human time strings."""
    try:
        times = [parse_time(t) for t in req.times]
    except ValueError as exc:
        raise app_error(400, "VALIDATION_TIME_PARSE", str(exc))
    return _enqueue(video_id, times, req.tree_id, req.soil_moisture, user,
                    drone_mode=req.drone_mode, upscale=req.upscale)


def _enqueue(video_id: int, times: list[float], tree_id: Optional[str],
             soil_moisture: Optional[SoilMoistureInput] = None,
             user: dict = None,
             drone_mode: bool = False,
             upscale: Optional[bool] = None):
    if runner is None:
        raise app_error(503, "UNAVAILABLE_BACKEND", "active backend is not available")
    _owned_video(video_id, user)
    video = store.get_video(video_id)
    if video["status"] == "processing":
        raise app_error(409, "CONFLICT_VIDEO_ANALYZING", "video is already being analysed")
    if not times:
        raise app_error(400, "VALIDATION_NO_TIMES", "no times given")
    job = runner.enqueue(video_id, sorted(set(round(t, 3) for t in times)), tree_id,
                         soil_manual=soil_moisture.dict() if soil_moisture else None,
                         drone_mode=drone_mode, upscale=upscale)
    return {"job": job}


# --------------------------------------------------------------------------
# Results
# --------------------------------------------------------------------------
def _finalize(rows: list[dict]) -> list[dict]:
    """Attach computed health_state, owner (farmer) info, and explain text."""
    try:
        owners = {u["id"]: u for u in store.list_users()}
    except Exception:
        owners = {}
    for o in rows:
        # One malformed observation must never break the whole list response.
        try:
            result = o.get("result") or {}
            try:
                o["health_state"] = health_state(result)
            except Exception:
                o["health_state"] = None
            # Expose the upscale flags at the top level so the UI can badge them
            # without digging into the nested result blob.
            o["upscaled"] = result.get("upscaled")
            o["upscale_model"] = result.get("upscale_model")
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
            # Rebuild nested frame URLs too, so stale/legacy absolute paths in
            # older results still render correctly.
            for key in ("_frame_annotated", "_frame_raw"):
                p = result.get(key)
                if p:
                    result[key + "_url"] = _url_for_storage(p)
            try:
                o["explain_text"] = explain_detection_ja(result)
            except Exception:
                o["explain_text"] = None
        except Exception:
            o["health_state"] = None
            o["owner"] = None
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
            return "/storage/" + rel.as_posix()
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


@app.get("/api/trees/registry")
def list_tree_registry(farmer_id: Optional[int] = Query(None),
                       user: dict = Depends(get_current_user)):
    """Registered trees (farm-map positions + profile) for a farmer."""
    if user["role"] == "admin":
        uid = farmer_id
    else:
        uid = user["id"]
    if uid is None:
        raise app_error(400, "VALIDATION_FARMER_REQUIRED", "farmer_id を指定してください")
    rows = _with_tree_health(store.list_trees_registry(uid))
    return {"trees": rows}


@app.post("/api/trees/registry")
def create_tree_registry(payload: TreeCreate,
                         farmer_id: Optional[int] = Query(None),
                         user: dict = Depends(get_current_user)):
    uid = _target_id(user, farmer_id)
    try:
        row = store.create_tree(uid, payload.tree_id, payload.name, payload.variety,
                                payload.row_num, payload.col_num, payload.note)
    except ValueError as e:
        raise app_error(409, "CONFLICT_TREE_ID", str(e))
    return _with_tree_health([row])[0]


@app.put("/api/trees/registry/{tree_id}")
def update_tree_registry(tree_id: str, payload: TreeUpdate,
                         farmer_id: Optional[int] = Query(None),
                         user: dict = Depends(get_current_user)):
    uid = _target_id(user, farmer_id)
    row = store.update_tree(uid, tree_id, payload.name, payload.variety,
                            payload.row_num, payload.col_num, payload.note)
    if row is None:
        raise app_error(404, "NOT_FOUND_TREE", "樹木が見つかりません")
    return _with_tree_health([row])[0]


@app.delete("/api/trees/registry/{tree_id}")
def delete_tree_registry(tree_id: str, farmer_id: Optional[int] = Query(None),
                         user: dict = Depends(get_current_user)):
    uid = _target_id(user, farmer_id)
    if not store.delete_tree(uid, tree_id):
        raise app_error(404, "NOT_FOUND_TREE", "樹木が見つかりません")
    return {"ok": True}


@app.post("/api/trees/registry/import")
def import_tree_registry(farmer_id: Optional[int] = Query(None),
                         user: dict = Depends(get_current_user)):
    """Register every *observed* tree id that is not yet in the registry.

    Positions are auto-assigned to the first free cells (row-major) so a
    farm can start with data and refine the layout later.
    """
    uid = _target_id(user, farmer_id)
    observed = store.list_trees(user_id=uid)
    registered = store.list_trees_registry(user_id=uid)
    have = {t["tree_id"] for t in registered}
    todo = [t for t in observed if t["tree_id"] not in have]

    occupied = {(t["row_num"], t["col_num"]) for t in registered}
    COLS = GRID_COLS
    created = []
    max_row = max((t["row_num"] for t in registered), default=0)
    row, col = max_row + 1, 1
    for t in sorted(todo, key=lambda d: d["tree_id"]):
        while (row, col) in occupied:
            col += 1
            if col > COLS:
                col = 1
                row += 1
        occupied.add((row, col))
        rec = store.create_tree(uid, t["tree_id"], None, None, row, col, None)
        created.append(rec["tree_id"])
        col += 1
        if col > COLS:
            col = 1
            row += 1

    return {"imported": created, "count": len(created)}


@app.get("/api/farm-map")
def farm_map(farmer_id: Optional[int] = Query(None),
             user: dict = Depends(get_current_user)):
    """Return tree nodes for the farm map with the latest per-tree health.

    Layout combines the tree registry (explicit row/col positions in the
    orchard) with every observed ``tree_id``.  Observed ids that are not yet
    registered are auto-placed on free cells and flagged ``registered=false``
    so the UI can invite the farmer to register them.
    """
    if user["role"] == "admin":
        uid = farmer_id
    else:
        uid = user["id"]

    farmer = None
    if user["role"] == "admin" and uid is not None:
        u = store.get_user(uid)
        if u:
            farmer = None if u["role"] != "farmer" else {
                "id": u["id"], "username": u.get("username"),
                "display_name": u.get("display_name"), "farm_name": u.get("farm_name"),
            }

    obs = store.list_observations(limit=5000, user_id=uid)

    # Health + stats per observed tree_id.
    grouped: dict[str, dict] = {}
    for o in obs:
        tid = o.get("tree_id")
        if not tid:
            continue
        node = grouped.get(tid)
        if node is None:
            node = {
                "tree_id": tid,
                "observation_count": 0,
                "first_seen": o.get("observed_at"),
                "last_seen": o.get("observed_at"),
                "latest": o,
            }
            grouped[tid] = node
        node["observation_count"] += 1
        seen = o.get("observed_at") or ""
        if seen and seen > (node["last_seen"] or ""):
            node["last_seen"] = seen
            node["latest"] = o
        if seen and seen < (node["first_seen"] or ""):
            node["first_seen"] = seen

    def observed_health(tid: str) -> tuple:
        node = grouped.get(tid)
        if not node or not node["latest"]:
            return None, None, None, 0
        latest = node["latest"]
        st = health_state(latest.get("result") or {})
        return st, node["last_seen"], node["first_seen"], node["observation_count"]

    registered = store.list_trees_registry(user_id=uid)
    reg_by_id = {t["tree_id"]: t for t in registered}

    COLS = GRID_COLS
    CELL_W, CELL_H = 118, 130
    PAD_X, PAD_Y = 70, 70

    occupied: set = set()
    tree_nodes = []
    for t in registered:
        occupied.add((t["row_num"], t["col_num"]))
    for t in sorted(registered, key=lambda d: (d["row_num"], d["col_num"])):
        st, _, _, count = observed_health(t["tree_id"])
        tree_nodes.append({
            "tree_id": t["tree_id"],
            "name": t.get("name"),
            "variety": t.get("variety"),
            "row": t["row_num"],
            "col": t["col_num"],
            "x": PAD_X + (t["col_num"] - 1) * CELL_W + CELL_W // 2,
            "y": PAD_Y + (t["row_num"] - 1) * CELL_H + CELL_H // 2,
            "registered": True,
            "state": st,
            "last_seen": (grouped.get(t["tree_id"]) or {}).get("last_seen"),
            "first_seen": (grouped.get(t["tree_id"]) or {}).get("first_seen"),
            "observation_count": count,
        })

    # Unregistered observed ids: fill free cells row-major (deterministic).
    unregistered_ids = sorted(set(grouped) - set(reg_by_id))
    max_row = max((t["row_num"] for t in registered), default=0)
    row, col = max_row + 1, 1
    for tid in unregistered_ids:
        while (row, col) in occupied:
            col += 1
            if col > COLS:
                col = 1
                row += 1
        occupied.add((row, col))
        st, last_seen, first_seen, count = observed_health(tid)
        tree_nodes.append({
            "tree_id": tid,
            "name": None,
            "variety": None,
            "row": row,
            "col": col,
            "x": PAD_X + (col - 1) * CELL_W + CELL_W // 2,
            "y": PAD_Y + (row - 1) * CELL_H + CELL_H // 2,
            "registered": False,
            "state": st,
            "last_seen": last_seen,
            "first_seen": first_seen,
            "observation_count": count,
        })
        col += 1
        if col > COLS:
            col = 1
            row += 1

    max_row = max(2, max((t["row"] for t in tree_nodes), default=1))
    return {
        "farmer": farmer,
        "map": {
            "width": PAD_X * 2 + COLS * CELL_W,
            "height": PAD_Y * 2 + max_row * CELL_H,
        },
        "trees": tree_nodes,
        "registered_count": len(registered),
        "unregistered_count": len(unregistered_ids),
    }


def _with_tree_health(rows: list[dict]) -> list[dict]:
    """Attach latest health state + observation stats to registry rows."""
    if not rows:
        return rows
    uid = rows[0].get("user_id")
    obs = store.list_observations(limit=5000, user_id=uid)
    grouped: dict[str, dict] = {}
    for o in obs:
        tid = o.get("tree_id")
        if not tid:
            continue
        node = grouped.setdefault(tid, {"count": 0, "latest": None,
                                        "last_seen": None, "first_seen": None})
        node["count"] += 1
        seen = o.get("observed_at") or ""
        if node["latest"] is None or (seen and seen > (node["last_seen"] or "")):
            node["latest"] = o
            node["last_seen"] = seen or node["last_seen"]
        if not node["first_seen"] or (seen and seen < node["first_seen"]):
            node["first_seen"] = seen or node["first_seen"]
    out = []
    for r in rows:
        node = grouped.get(r["tree_id"]) or {}
        st = health_state((node.get("latest") or {}).get("result") or {}) if node.get("latest") else None
        out.append({
            **r,
            "state": st,
            "last_seen": node.get("last_seen"),
            "first_seen": node.get("first_seen"),
            "observed_at": node.get("last_seen"),
            "observation_count": node.get("count", 0),
        })
    return out


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
        raise app_error(400, "VALIDATION_OBSERVATIONS_LIMIT", "too many observations (max 500)")
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
        raise app_error(404, "NOT_FOUND_VIDEO", "video not found")
    _unlink_upload(path)
    return {"ok": True, "deleted_video": video_id}


@app.delete("/api/images/{image_id}")
def delete_own_image(image_id: int, user: dict = Depends(get_current_user)):
    """Delete the current user's own image (admin may delete any)."""
    _owned_image(image_id, user)
    path = store.delete_image(image_id)
    if path is None:
        raise app_error(404, "NOT_FOUND_IMAGE", "image not found")
    _unlink_upload(path)
    return {"ok": True, "deleted_image": image_id}


@app.delete("/api/observations/{observation_id}")
def delete_own_observation(observation_id: int, user: dict = Depends(get_current_user)):
    """Delete the current user's own observation (admin may delete any)."""
    uid = _scope_id(user)
    ok = store.delete_observation_owned(observation_id, uid)
    if not ok:
        raise app_error(404, "NOT_FOUND_OBSERVATION", "observation not found")
    return {"ok": True}


def _scope_id(user: dict) -> Optional[int]:
    """Return the user_id filter for a normal user; None (all) for admin."""
    if user["role"] == "admin":
        return None
    return user["id"]


def _target_id(user: dict, farmer_id: Optional[int]) -> int:
    """Resolve who a tree-registry mutation applies to.

    Farmers always operate on their own registry; admins must name a farmer
    explicitly so they can never mutate the wrong tenant.
    """
    if user["role"] == "admin":
        if farmer_id is None:
            raise app_error(400, "VALIDATION_FARMER_REQUIRED", "farmer_id を指定してください")
        u = store.get_user(farmer_id)
        if not u or u["role"] != "farmer":
            raise app_error(404, "NOT_FOUND_FARMER", "農家が存在しません")
        return farmer_id
    return user["id"]


# --------------------------------------------------------------------------
# Static files (frames, annotations) + character SVGs
# --------------------------------------------------------------------------
@app.get("/storage/{folder}/{file_name:path}")
def storage_file(folder: str, file_name: str):
    path = (STORAGE_DIR / folder / file_name).resolve()
    if not path.is_relative_to(STORAGE_DIR.resolve()) or not path.is_file():
        raise app_error(404, "NOT_FOUND_STORAGE_FILE", "file not found")
    return FileResponse(path)


@app.get("/media/{file_name:path}")
def media_file(file_name: str):
    """Serve uploaded video files (browser <video> streaming, Range enabled)."""
    path = (UPLOAD_DIR / file_name).resolve()
    if not path.is_relative_to(UPLOAD_DIR.resolve()) or not path.is_file():
        raise app_error(404, "NOT_FOUND_STORAGE_FILE", "file not found")
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
        "alerts": _mask_alerts(),
        "path": str(SOIL_MOISTURE_CONFIG_PATH),
    }


def _mask_alerts() -> dict:
    """Masked copy of the ``alerts:`` section for the admin editor."""
    from .sensor_alerts import mask_alerts_config
    cfg = {}
    if SOIL_MOISTURE_CONFIG_PATH.exists():
        try:
            raw = yaml.safe_load(SOIL_MOISTURE_CONFIG_PATH.read_text(encoding="utf-8")) or {}
            if isinstance(raw, dict):
                cfg = raw.get("alerts") or {}
        except Exception:
            cfg = {}
    return mask_alerts_config(cfg)


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


def _restore_channel_secrets(seal, old_ch: dict, new_ch: dict) -> None:
    """Restore original channel secrets when the admin editor sends back masked values."""
    # Legacy scalar fields.
    for key, keep in (("webhook_token", 0), ("webhook_url", 16)):
        new_v = new_ch.get(key)
        old_v = old_ch.get(key)
        if old_v and isinstance(new_v, str) and new_v == seal(old_v, keep):
            new_ch[key] = old_v
    # Restore the masked LINE Bot channel access token.
    new_lb = new_ch.get("line_bot")
    old_lb = old_ch.get("line_bot")
    if isinstance(new_lb, dict) and isinstance(old_lb, dict):
        n_tok = new_lb.get("channel_access_token")
        o_tok = old_lb.get("channel_access_token")
        if o_tok and isinstance(n_tok, str) and n_tok == seal(str(o_tok), 0):
            new_lb["channel_access_token"] = o_tok
    # Restore masked tokens/urls inside the webhooks list entry-by-entry.
    new_wh = new_ch.get("webhooks") or []
    old_wh = [w for w in (old_ch.get("webhooks") or []) if isinstance(w, dict)]
    if isinstance(new_wh, list):
        for nw in new_wh:
            if not isinstance(nw, dict):
                continue
            n_url = nw.get("url")
            n_tok = nw.get("token")
            for ow in old_wh:
                url_ok = (
                    n_url
                    and isinstance(n_url, str)
                    and n_url == seal(str(ow.get("url", "")), 16)
                )
                tok_ok = (
                    n_tok
                    and isinstance(n_tok, str)
                    and n_tok == seal(str(ow.get("token", "")), 0)
                )
                if url_ok or tok_ok:
                    if url_ok:
                        nw["url"] = ow["url"]
                    if tok_ok:
                        nw["token"] = ow["token"]
                    break


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
    # Merge with the stored config so a partial payload never drops settings.
    merged = dict(cfg)
    for key, value in (existing or {}).items():
        if key not in merged or merged[key] is None:
            merged[key] = value
    if isinstance(existing.get("alerts"), dict) and isinstance(merged.get("alerts"), dict):
        for key, value in existing["alerts"].items():
            # Deep-preserve nested dict keys (templates.presets, escalation.*) so
            # a partial payload never drops sub-keys that the editor did not send.
            if isinstance(value, dict) and isinstance(merged["alerts"].get(key), dict):
                for k2, v2 in value.items():
                    if k2 not in merged["alerts"][key] or merged["alerts"][key][k2] is None:
                        merged["alerts"][key][k2] = v2
            elif key not in merged["alerts"] or merged["alerts"][key] is None:
                merged["alerts"][key] = value
    if (isinstance(existing.get("alerts"), dict)
            and isinstance(existing["alerts"].get("channels"), dict)
            and isinstance(merged.get("alerts"), dict)
            and isinstance(merged["alerts"].get("channels"), dict)):
        for key, value in existing["alerts"]["channels"].items():
            if key not in merged["alerts"]["channels"] or merged["alerts"]["channels"][key] is None:
                merged["alerts"]["channels"][key] = value
    cfg = merged
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
    # Keep original alert-channel secrets when masked values are sent back.
    from .sensor_alerts import _mask_secret as _mask_alerts_secret
    new_ch = ((cfg.get("alerts") or {}).get("channels") or {})
    old_ch = ((existing.get("alerts") or {}).get("channels") or {})
    _restore_channel_secrets(_mask_alerts_secret, old_ch, new_ch)
    from .config import atomic_write as _atomic_write_text
    _atomic_write_text(
        SOIL_MOISTURE_CONFIG_PATH,
        yaml.safe_dump(cfg, allow_unicode=True, default_flow_style=False),
    )
    return _soil_doc()


@app.delete("/api/admin/videos/{video_id}")
def admin_delete_video(video_id: int, _: dict = Depends(require_admin)):
    path = store.delete_video(video_id)
    if path is None:
        raise app_error(404, "NOT_FOUND_VIDEO", "video not found")
    _unlink_upload(path)
    return {"ok": True, "deleted_video": video_id}


@app.delete("/api/admin/images/{image_id}")
def admin_delete_image(image_id: int, _: dict = Depends(require_admin)):
    path = store.delete_image(image_id)
    if path is None:
        raise app_error(404, "NOT_FOUND_IMAGE", "image not found")
    _unlink_upload(path)
    return {"ok": True, "deleted_image": image_id}


@app.delete("/api/admin/observations/{observation_id}")
def admin_delete_observation(observation_id: int, _: dict = Depends(require_admin)):
    ok = store.delete_observation(observation_id)
    if not ok:
        raise app_error(404, "NOT_FOUND_OBSERVATION", "observation not found")
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
        raise app_error(400, "VALIDATION_CONTENT_REQUIRED", "title and body are required")
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
        raise app_error(404, "NOT_FOUND_FARMER", "農家が見つかりません")
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
            raise app_error(400, "VALIDATION_FARM_TREES", "farm_trees must be a non-negative integer")
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
        raise app_error(404, "NOT_FOUND_FARMER", "農家が見つかりません")
    store.set_user_password(user_id, req.new_password)
    # The new password must force the farmer to log in again: kill every
    # session the account still has.
    store.revoke_all_sessions(user_id)
    return {"ok": True, "username": user["username"]}


@app.delete("/api/admin/farmers/{user_id}")
def admin_delete_farmer(user_id: int, _: dict = Depends(require_admin)):
    user = store.get_user(user_id)
    if user is None or user["role"] != "farmer":
        raise app_error(404, "NOT_FOUND_FARMER", "農家が見つかりません")
    removed = store.delete_user(user_id)
    return {"ok": True, "removed": removed}


# --------------------------------------------------------------------------
# Entrypoint
# --------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)
