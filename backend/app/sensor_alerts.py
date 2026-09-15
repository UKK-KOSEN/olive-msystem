"""
Sensor anomaly monitoring & alerting for soil moisture.

Layered on top of the existing :mod:`soil_moisture` integration, this module
decides *when* to alert, *how strongly*, and *through which channels*.

Detected anomaly modes:

* ``stale``       - the sensor stopped reporting (measured_at too old)
* ``risk``        - fresh readings indicate abnormal (dry / wet) soil
* ``api_error``   - the automatic fetch itself fails (key / url / network)

Behaviour:

* Immediate notification when an anomaly is first detected, then scheduled
  reminders while it persists, and finally a recovery notification when the
  sensor is healthy again.
* Channels (configured under ``alerts:`` in soil_moisture.yaml):
    - ``inapp``:        the app's own notification feed (SQLite)
    - ``webhooks``:     any number of targets; per-entry ``format`` selects
                        json (Slack/Discord/Teams/generic), line_notify, or
                        plain text, with optional token/custom headers
    - ``line_bot``:     LINE Messaging API push to a specific LINE user
* Current state and an event history are persisted, so restarts never
  duplicate alerts and escalation picks up where it left off.
"""
from __future__ import annotations

import hashlib
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Optional

import yaml

from .config import SOIL_MOISTURE_CONFIG_PATH
from . import soil_moisture as _sm

logger = logging.getLogger("olive-msystem")

ALERT_MODES = {"stale", "api_error", "risk"}

DEFAULT_ALERTS: dict = {
    "enabled": True,
    "check_interval_minutes": 10,
    "stale_hours": 6,
    "dry_percent": 15,
    "wet_percent": 85,
    "notify_risk": True,
    "remind_hours": [6, 24, 72, 168],
    "recover_notify": True,
    "channels": {
        "inapp": True,
        # Multiple declarative webhooks.
        # each entry: {name, url, format: json|line_notify|text, token, headers, timeout}
        "webhooks": [],
        # LINE BOT (Messaging API).  `to` is the LINE user id that receives pushes.
        "line_bot": {
            "enabled": False,
            "channel_access_token": "",
            "to": "",
            "endpoint": "https://api.line.me/v2/bot/message/push",
        },
        # Legacy single-webhook fields (kept for backward compatibility).
        "webhook_url": "",
        "webhook_token": "",
    },
}


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _deep_merge(base: dict, update: dict) -> None:
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def _load_alerts_raw() -> dict:
    raw = {}
    if SOIL_MOISTURE_CONFIG_PATH.exists():
        try:
            cfg = yaml.safe_load(SOIL_MOISTURE_CONFIG_PATH.read_text(encoding="utf-8")) or {}
            if isinstance(cfg, dict):
                raw = cfg.get("alerts") or {}
        except Exception:
            raw = {}
    return raw if isinstance(raw, dict) else {}


def load_alerts_config() -> dict:
    """Return the ``alerts:`` section of soil_moisture.yaml merged with defaults."""
    raw = _load_alerts_raw()
    merged = json.loads(json.dumps(DEFAULT_ALERTS))
    if isinstance(raw, dict):
        _deep_merge(merged, raw)
    # Backward compatibility: migrate legacy single webhook into webhooks list.
    ch = merged.get("channels") or {}
    if not ch.get("webhooks") and (ch.get("webhook_url") or "").strip():
        ch["webhooks"] = [{
            "name": "webhook",
            "url": (ch.get("webhook_url") or "").strip(),
            "format": "line_notify" if (ch.get("webhook_token") or "").strip() else "json",
            "token": (ch.get("webhook_token") or "").strip(),
        }]
    return merged


def _mask_secret(value: str, keep: int = 0) -> str:
    """Mask a secret for the admin editor.

    The mask keeps the first ``keep`` characters and appends a short hash tag
    of the original value (``*****`` + 8 hex chars) so that identical-looking
    masks stay unambiguous and masked values can be matched back to the stored
    secret on save.
    """
    value = value or ""
    if not value:
        return ""
    tag = hashlib.sha1(value.encode("utf-8")).hexdigest()[:8]
    return value[:keep] + "*****" + tag


def mask_alerts_config(raw: dict) -> dict:
    """Mask secrets for the admin editor while keeping the rest visible."""
    merged = json.loads(json.dumps(DEFAULT_ALERTS))
    if isinstance(raw, dict):
        _deep_merge(merged, raw)
    ch = dict(merged.get("channels") or {})
    if ch.get("webhook_url"):
        ch["webhook_url"] = _mask_secret(str(ch["webhook_url"]), 16)
    if ch.get("webhook_token"):
        ch["webhook_token"] = _mask_secret(str(ch["webhook_token"]))
    webhooks = []
    for w in ch.get("webhooks") or []:
        w2 = dict(w)
        if w2.get("url"):
            w2["url"] = _mask_secret(str(w2["url"]), 16)
        if w2.get("token"):
            w2["token"] = _mask_secret(str(w2["token"]))
        webhooks.append(w2)
    ch["webhooks"] = webhooks
    lb = dict(ch.get("line_bot") or {})
    if lb.get("channel_access_token"):
        lb["channel_access_token"] = _mask_secret(str(lb["channel_access_token"]))
    ch["line_bot"] = lb
    return {**merged, "channels": ch}


def _elapsed_hours(iso: Optional[str]) -> Optional[float]:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.astimezone()
        return (datetime.now().astimezone() - dt).total_seconds() / 3600.0
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
def evaluate() -> dict:
    """Fetch the latest reading and classify the sensor state.

    Returns a dict with ``mode`` plus the message payload (title / body /
    severity) and the values that were used.  Modes:
    ``ok``, ``unconfigured``, ``stale``, ``api_error``, ``risk``.
    """
    acfg = load_alerts_config()
    base_cfg = _sm._load_auto_config()
    configured = base_cfg is not None
    base = {
        "configured": configured,
        "alerts": mask_alerts_config(acfg),
    }

    kit_id = ((base_cfg or {}).get("default_kit_id") or "default").lower()

    if not configured:
        return {
            **base,
            "mode": "unconfigured",
            "sensor_online": False,
            "title": "土壌水分センサー: 監視対象外",
            "body": "soil_moisture.yaml が未設定のため、土壌水分センサーの監視は行われていません。",
            "severity": "info",
            "kit_id": None,
            "measured_at": None,
            "age_hours": None,
            "sensor1": None,
            "sensor2": None,
            "temperature": None,
            "humidity": None,
            "risk": None,
            "health_message": None,
            "error": None,
        }

    try:
        data = _sm.build_soil_data(None)
    except Exception as exc:  # pragma: no cover
        data = {"source": "error", "error": str(exc)}
    sm = data.get("soil_moisture") or {}
    health = data.get("health") or {}

    measured = sm.get("measured_at")
    age_hours = None
    if measured:
        ts = _sm._parse_api_ts(measured)
        if ts:
            now = datetime.utcnow().replace(tzinfo=ts.tzinfo) if ts.tzinfo else datetime.utcnow()
            age_hours = (now - ts).total_seconds() / 3600.0

    s1 = sm.get("sensor1_moisture_percent")
    s2 = sm.get("sensor2_moisture_percent")
    ctx = {
        "kit_id": kit_id,
        "measured_at": measured,
        "age_hours": age_hours,
        "sensor1": s1,
        "sensor2": s2,
        "temperature": sm.get("temperature"),
        "humidity": sm.get("humidity"),
        "risk": health.get("risk"),
        "health_message": health.get("message"),
    }

    if data.get("source") != "api":
        stats = _sm.get_fetcher_stats()
        err = stats.get("last_error_msg") or "自動取得に失敗しました"
        return {
            **base,
            "mode": "api_error",
            "sensor_online": False,
            "title": "土壌水分センサー: API接続エラー",
            "body": (
                f"土壌水分センサー API への接続に失敗しています。（Kit: {kit_id}）\n"
                f"詳細: {err}\n"
                "APIキー・接続先URL・ネットワーク接続を確認してください。"
            ),
            "severity": "warning",
            "error": err,
            **ctx,
        }

    stale_hours = float(acfg.get("stale_hours", 6))
    if age_hours is not None and age_hours > stale_hours:
        return {
            **base,
            "mode": "stale",
            "sensor_online": False,
            "title": "土壌水分センサー: データ更新停止",
            "body": (
                f"最終更新は {measured}（約 {age_hours:.1f} 時間前）です。（Kit: {kit_id}）\n"
                "センサーの電源・通信・設置状態を物理的に確認してください。"
            ),
            "severity": "critical",
            "error": None,
            **ctx,
        }

    dry = float(acfg.get("dry_percent", 15))
    wet = float(acfg.get("wet_percent", 85))
    hints = []
    for tag, val in (("センサー1", s1), ("センサー2", s2)):
        if val is None:
            continue
        if val < dry:
            hints.append(f"{tag} {val:.1f}% は乾燥閾値 {dry:.0f}% 未満")
        elif val > wet:
            hints.append(f"{tag} {val:.1f}% は過湿閾値 {wet:.0f}% 超")
    hr = health.get("risk")
    if acfg.get("notify_risk", True) and (hints or hr in ("high", "dry", "wet")):
        msg = "、".join(hints) if hints else (health.get("message") or f"判定: {hr}")
        return {
            **base,
            "mode": "risk",
            "sensor_online": True,
            "title": "土壌水分センサー: 水分値の異常",
            "body": (
                f"土壌水分に異常値が検出されました。\n{msg}\n"
                f"（Kit: {kit_id}、測定 {measured}）"
            ),
            "severity": "warning",
            "error": None,
            **ctx,
        }

    return {
        **base,
        "mode": "ok",
        "sensor_online": True,
        "title": "土壌水分センサー: 正常",
        "body": f"正常です。（Kit: {kit_id}）",
        "severity": "info",
        "error": None,
        **ctx,
    }


# ---------------------------------------------------------------------------
# Channel senders
# ---------------------------------------------------------------------------
def _build_webhook_entries(acfg: dict) -> list[dict]:
    """Resolve configured webhooks (declarative list, plus legacy fallback)."""
    ch = acfg.get("channels") or {}
    entries = []
    for w in (ch.get("webhooks") or []):
        if isinstance(w, dict) and (w.get("url") or "").strip():
            entries.append(w)
    if not entries and (ch.get("webhook_url") or "").strip():
        entries.append({
            "name": "webhook",
            "url": (ch.get("webhook_url") or "").strip(),
            "format": "line_notify" if (ch.get("webhook_token") or "").strip() else "json",
            "token": (ch.get("webhook_token") or "").strip(),
        })
    return entries


def _send_one_webhook(entry: dict, title: str, body: str, severity: str):
    """POST to a single webhook entry.

    ``format`` selects the payload style:
      - ``json``        JSON object (default, for Slack/Discord/Teams/generic)
      - ``line_notify`` LINE Notify form format (Bearer token optional)
      - ``text``        raw text/plain message
    """
    url = (entry.get("url") or "").strip()
    if not url:
        return "skipped", None
    fmt = (entry.get("format") or "json").lower()
    timeout = float(entry.get("timeout") or 10)
    text = f"[{severity}] {title}\n{body}"
    token = (entry.get("token") or "").strip()
    headers = {str(k): str(v) for k, v in (entry.get("headers") or {}).items()}
    try:
        if fmt == "line_notify":
            headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
            if token:
                headers["Authorization"] = "Bearer " + token
            data = urllib.parse.urlencode({"message": text}).encode("utf-8")
        elif fmt == "text":
            headers.setdefault("Content-Type", "text/plain; charset=utf-8")
            data = text.encode("utf-8")
        else:  # json
            headers.setdefault("Content-Type", "application/json")
            payload = {
                "title": title,
                "body": body,
                "severity": severity,
                "type": "sensor_alert",
                "service": "olive-msystem",
            }
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=timeout):
            pass
        return "ok", None
    except urllib.error.HTTPError as exc:
        return "error", f"HTTP {exc.code}"
    except Exception as exc:
        return "error", str(exc)


def _send_line_bot(acfg: dict, title: str, body: str, severity: str):
    """Send a push message via LINE Messaging API (LINE BOT)."""
    ch = acfg.get("channels") or {}
    lb = ch.get("line_bot") or {}
    if not lb.get("enabled"):
        return "skipped", None
    token = (lb.get("channel_access_token") or "").strip()
    to = (lb.get("to") or "").strip()
    if not token or not to:
        return "error", "LINE Bot: channel_access_token / to が未設定です"
    endpoint = (lb.get("endpoint") or "https://api.line.me/v2/bot/message/push").strip()
    text = f"[{severity}] {title}\n{body}"
    payload = {"to": to, "messages": [{"type": "text", "text": text}]}
    try:
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                return "error", f"LINE API HTTP {resp.status}"
        return "ok", None
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", "replace")[:300]
        except Exception:
            detail = str(exc)
        return "error", f"HTTP {exc.code}: {detail}"
    except Exception as exc:
        return "error", str(exc)


def _send_inapp(store, title: str, body: str, severity: str):
    try:
        store.add_notification(title, body, created_by=0, target_role="all")
        return "ok", None
    except Exception as exc:
        return "error", str(exc)


def send_channels(store, acfg: dict, title: str, body: str, severity: str) -> list[dict]:
    """Deliver through every enabled channel; return per-channel results."""
    ch = acfg.get("channels") or {}
    results = []
    if ch.get("inapp", True):
        ok, err = _send_inapp(store, title, body, severity)
        results.append({"channel": "inapp", "ok": ok == "ok", "detail": err})
    for entry in _build_webhook_entries(acfg):
        ok, err = _send_one_webhook(entry, title, body, severity)
        results.append({
            "channel": "webhook",
            "name": (entry.get("name") or "webhook").strip() or "webhook",
            "ok": ok == "ok",
            "detail": err,
        })
    ok, err = _send_line_bot(acfg, title, body, severity)
    if ok != "skipped":
        results.append({"channel": "line_bot", "ok": ok == "ok", "detail": err})
    return results


def _used_channels(results: list[dict]) -> str:
    labels = []
    for c in results:
        if not c.get("ok"):
            continue
        labels.append(c.get("name") or c["channel"])
    return ",".join(dict.fromkeys(labels))


def _state_summary(ev: dict) -> dict:
    return {
        "kit_id": ev.get("kit_id"),
        "measured_at": ev.get("measured_at"),
        "sensor1": ev.get("sensor1"),
        "sensor2": ev.get("sensor2"),
    }


# ---------------------------------------------------------------------------
# Monitor state machine
# ---------------------------------------------------------------------------
def run_monitor(store) -> dict:
    """Perform one monitoring pass and act on state transitions."""
    acfg = load_alerts_config()
    if not acfg.get("enabled", True):
        return {"action": "disabled"}
    ev = evaluate()
    state = store.get_sensor_alert_state() or {}
    prev = state.get("mode")
    now = _now_iso()

    if ev["mode"] in ALERT_MODES:
        data = _state_summary(ev)
        if prev not in ALERT_MODES:
            # First detection of an anomaly (or the type changed).
            results = send_channels(store, acfg, ev["title"], ev["body"], ev["severity"])
            used = _used_channels(results)
            store.add_sensor_alert_event(ev["mode"], "open", ev["title"], ev["body"], used)
            store.set_sensor_alert_state("default", ev["mode"], now, now, 0, data)
            logger.warning("sensor alert opened: mode=%s channels=%s", ev["mode"], used or "none")
            return {"action": "open", "mode": ev["mode"], "channels": results}
        if ev["mode"] == prev:
            # Same anomaly persists: fire the next scheduled reminder if due.
            elapsed_h = _elapsed_hours(state.get("opened_at"))
            level = int(state.get("level") or 0)
            schedule = [float(x) for x in (acfg.get("remind_hours") or [])]
            if elapsed_h is not None and 0 <= level < len(schedule) and elapsed_h >= schedule[level]:
                n = level + 1
                title = f"（リマインド {n}）{ev['title']}"
                body = (
                    f"【リマインド {n} 回目】検知から約 {elapsed_h:.0f} 時間が経過しています。\n"
                    f"{ev['body']}"
                )
                results = send_channels(store, acfg, title, body, ev["severity"])
                used = _used_channels(results)
                store.add_sensor_alert_event(ev["mode"], "remind", title, body, used)
                store.set_sensor_alert_state("default", ev["mode"], state.get("opened_at"), now, n, data)
                logger.warning("sensor alert reminded: mode=%s reminder=%d", ev["mode"], n)
                return {"action": "remind", "mode": ev["mode"], "reminder": n, "channels": results}
            return {"action": "hold", "mode": ev["mode"]}
        # Different anomaly kind while in an alert state -> re-open.
        results = send_channels(store, acfg, ev["title"], ev["body"], ev["severity"])
        used = _used_channels(results)
        store.add_sensor_alert_event(ev["mode"], "open", ev["title"], ev["body"], used)
        store.set_sensor_alert_state("default", ev["mode"], now, now, 0, data)
        logger.warning("sensor alert changed: %s -> %s (channels=%s)", prev, ev["mode"], used or "none")
        return {"action": "changed", "mode": ev["mode"], "channels": results}

    # Healthy / unconfigured.
    if prev in ALERT_MODES:
        if ev["mode"] == "ok" and acfg.get("recover_notify", True):
            title = "土壌水分センサー: 復旧しました"
            body = (
                f"土壌水分センサーは正常な状態に戻りました。\n"
                f"最新データ: センサー1 {_fmt(ev.get('sensor1'))} / "
                f"センサー2 {_fmt(ev.get('sensor2'))}（測定 {ev.get('measured_at')}）"
            )
            results = send_channels(store, acfg, title, body, "info")
            used = _used_channels(results)
            store.add_sensor_alert_event("ok", "recovered", title, body, used)
            store.set_sensor_alert_state("default", ev["mode"], None, None, 0, _state_summary(ev))
            logger.info("sensor alert recovered: %s -> %s (channels=%s)", prev, ev["mode"], used or "none")
            return {"action": "recovered", "channels": results}
        store.set_sensor_alert_state("default", ev["mode"], None, None, 0, _state_summary(ev))
        logger.info("sensor alert state ended: %s -> %s", prev, ev["mode"])
        return {"action": "cleared", "mode": ev["mode"]}
    if prev is None:
        store.set_sensor_alert_state("default", ev["mode"], None, None, 0, _state_summary(ev))
        return {"action": "init", "mode": ev["mode"]}
    return {"action": "ok", "mode": ev["mode"]}


def _fmt(value) -> str:
    if value is None:
        return "—"
    return f"{value:.1f}%" if isinstance(value, (int, float)) else str(value)


# ---------------------------------------------------------------------------
# Test / status helpers
# ---------------------------------------------------------------------------
def test_channels(store) -> list[dict]:
    """Send a test message through every enabled channel."""
    acfg = load_alerts_config()
    title = "土壌水分センサー: テスト通知"
    body = (
        "これはテスト通知です。\n"
        "土壌水分センサーで異常が検出された際に、このチャネルへ通知が送信されます。\n"
        f"送信日時: {_now_iso()}"
    )
    results = send_channels(store, acfg, title, body, "test")
    store.add_sensor_alert_event("test", "test", title, body, _used_channels(results))
    return results


def status(store) -> dict:
    """Current monitoring snapshot for the admin page."""
    ev = evaluate()
    return {
        "enabled": load_alerts_config().get("enabled", True),
        "configured": ev.get("configured"),
        "evaluation": ev,
        "state": store.get_sensor_alert_state(),
        "events": store.get_sensor_alert_events(30),
        "channels": ev.get("alerts") or {},
    }