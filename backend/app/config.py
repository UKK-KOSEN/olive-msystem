"""olive-msystem configuration."""
from __future__ import annotations

import json
import os
import tempfile
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


def atomic_write(path: Path, content: str, encoding: str = "utf-8") -> None:
    """Write a file atomically (temp file + os.replace).

    A crash/power loss mid-write must never leave a truncated JSON/YAML file,
    since the lenient loaders silently swallow the error and revert to
    defaults — silently losing the API key / alert channels / thresholds.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except OSError:
            pass


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

    atomic_write(
        SETTINGS_PATH,
        json.dumps(current, ensure_ascii=False, indent=2) + "\n",
    )
    return current

# Path to the original olive-p project that owns the analysis algorithm.
# Resolution order:
#   1. OLIVE_P_DIR environment variable (explicit override, first-class).
#   2. The bundled <repo>/external/olive-p checkout that start.bat clones
#      from https://github.com/UKK-KOSEN/olive-vision-ai.git on first boot.
#   3. The legacy well-known checkout kept by older machines, so an existing
#      local clone is not silently abandoned by the new default.
#   4. <repo>/external/olive-p again (it does not exist yet -> start.bat will
#      clone it; check_env reports a FAIL until then).
def _olive_p_dir() -> Path:
    env = os.environ.get("OLIVE_P_DIR")
    if env:
        return Path(env)
    external = ROOT.parent / "external" / "olive-p"
    legacy = Path(r"C:\Users\yakit\Downloads\olive-p")
    for candidate in (external, legacy):
        if candidate.joinpath("src", "runtime.py").is_file():
            return candidate
    return external


OLIVE_P_DIR = _olive_p_dir()

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

# DB durability: how often (minutes) the active instance snapshots the SQLite
# database and how many rotated backups to keep.  See app/db_redundancy.py.
DB_BACKUP_INTERVAL_MIN = float(os.environ.get("DB_BACKUP_INTERVAL_MIN", "30"))
DB_BACKUP_KEEP = int(os.environ.get("DB_BACKUP_KEEP", "6"))


def ensure_dirs() -> None:
    for d in (DATA_DIR, UPLOAD_DIR, STORAGE_DIR, CONFIG_DIR):
        d.mkdir(parents=True, exist_ok=True)
