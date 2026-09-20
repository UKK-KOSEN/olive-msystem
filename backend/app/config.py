"""olive-msystem configuration."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # backend/
DATA_DIR = ROOT / "data"
UPLOAD_DIR = ROOT / "uploads"
STORAGE_DIR = ROOT / "storage"
CONFIG_DIR = ROOT / "config"
DB_PATH = DATA_DIR / "olive_msystem.db"

# Optional soil moisture API config (see backend/config/soil_moisture.yaml.example).
SOIL_MOISTURE_CONFIG_PATH = CONFIG_DIR / "soil_moisture.yaml"

# App-managed settings (health thresholds, ...) editable from the admin page.
SETTINGS_PATH = CONFIG_DIR / "settings.json"

DEFAULT_SETTINGS = {
    "health_thresholds": {
        "happy": 0.75,
        "good": 0.55,
        "caution": 0.35,
    },
    "site": {
        "name": "olive-msystem",
        "subtitle": "オリーブ管理ダッシュボード",
        "accent": "#2b2b2b",
    },
}


def _is_hex_color(value) -> bool:
    if not isinstance(value, str):
        return False
    v = value.strip()
    return len(v) in (4, 7) and v.startswith("#") and all(
        c in "0123456789abcdefABCDEF" for c in v[1:]
    )


def load_settings() -> dict:
    """Merge saved settings over the defaults."""
    merged = json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        if SETTINGS_PATH.exists():
            saved = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            for section, values in (saved or {}).items():
                if isinstance(values, dict) and isinstance(merged.get(section), dict):
                    merged[section].update(values)
                else:
                    merged[section] = values
    except Exception:
        pass
    return merged


def save_settings(settings: dict) -> dict:
    """Validate and persist settings; merge over current settings."""
    current = load_settings()

    # health thresholds
    health = settings.get("health_thresholds") or {}
    th = current.setdefault("health_thresholds", {})
    for key, default in DEFAULT_SETTINGS["health_thresholds"].items():
        try:
            val = float(health.get(key, current["health_thresholds"].get(key, default)))
            th[key] = max(0.0, min(1.0, val))
        except (TypeError, ValueError):
            th[key] = current["health_thresholds"].get(key, default)

    # site (branding) settings
    site = settings.get("site") or {}
    cur_site = current.setdefault("site", dict(DEFAULT_SETTINGS["site"]))
    for key, default in DEFAULT_SETTINGS["site"].items():
        val = site.get(key, cur_site.get(key, default))
        if key == "accent":
            cur_site[key] = val if _is_hex_color(val) else default
        elif isinstance(val, str) and val.strip():
            cur_site[key] = val.strip()
        else:
            cur_site[key] = default

    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(
        json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return current

# Path to the original olive-p project that owns the analysis algorithm.
OLIVE_P_DIR = Path(os.environ.get(
    "OLIVE_P_DIR",
    r"C:\Users\yakit\Downloads\olive-p",
))

# --- runtime ---
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "2048"))

# CORS origins for the Next.js dev server (and prod).
FRONTEND_PORT = int(os.environ.get("FRONTEND_PORT", "3001"))
CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]
for origin in (
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
):
    if origin not in CORS_ORIGINS:
        CORS_ORIGINS.append(origin)

# Runtime process identity. The redundancy supervisor starts one active and
# one standby backend on separate ports.
INSTANCE_ID = os.environ.get("OLIVE_INSTANCE_ID", "standalone").strip() or "standalone"
INSTANCE_ROLE = os.environ.get("OLIVE_INSTANCE_ROLE", "active").strip().lower()
if INSTANCE_ROLE not in {"active", "standby"}:
    raise ValueError("OLIVE_INSTANCE_ROLE must be 'active' or 'standby'")
IS_ACTIVE = INSTANCE_ROLE == "active"

# How many simultaneous video processing workers.
WORKERS = int(os.environ.get("WORKERS", "2"))


def ensure_dirs() -> None:
    for d in (DATA_DIR, UPLOAD_DIR, STORAGE_DIR, CONFIG_DIR):
        d.mkdir(parents=True, exist_ok=True)
