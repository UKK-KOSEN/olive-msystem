"""Database redundancy: online backups and corruption recovery.

The SQLite database runs in WAL mode so readers and the single writer can
proceed concurrently.  This module periodically snapshots that database with
the SQLite *online backup* API.  Backups are therefore always internally
consistent, even while writes are happening, and each one is a simple copy of
the file (no WAL tail is required to restore it).

When the primary database file is detected as corrupt during boot, the
newest rotated backup is written back over it before the app gives up,
converting a manual outage into a bounded rollback to the last snapshot.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from .config import DB_BACKUP_INTERVAL_MIN, DB_BACKUP_KEEP, DB_PATH

logger = logging.getLogger("olive-msystem.db_redundancy")

BACKUP_DIR = DB_PATH.parent / "backups"
BACKUP_PREFIX = "olive_msystem."
BACKUP_SUFFIX = ".db"
INITIAL_DELAY_SEC = 60            # let boot / schema init finish first
_MAX_BACKUP_SIZE_MB = 256         # refuse to restore an absurdly large backup

_backup_lock = threading.Lock()
_last_backup_at: datetime | None = None


def _backup_name(ts: datetime) -> str:
    """Timestamp-suffixed name; lexicographic order equals chronological."""
    stamp = ts.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{BACKUP_PREFIX}{stamp}{BACKUP_SUFFIX}"


def _is_backup(name: str) -> bool:
    return name.startswith(BACKUP_PREFIX) and name.endswith(BACKUP_SUFFIX)


def list_backups() -> list[Path]:
    """Rotated backups, newest first."""
    if not BACKUP_DIR.is_dir():
        return []
    names = [p.name for p in BACKUP_DIR.iterdir() if _is_backup(p.name)]
    names.sort(reverse=True)
    return [BACKUP_DIR / name for name in names]


def _latest_backup() -> Path | None:
    backups = list_backups()
    return backups[0] if backups else None


def backup_database(db_path: Path | None = None) -> Path | None:
    """Snapshot ``db_path`` into the rotated backup set.

    Returns the new backup path, or ``None`` if the snapshot could not be
    taken (the outage is logged here; it must never break a request).
    """
    db_path = Path(db_path or DB_PATH)
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        src = sqlite3.connect(str(db_path), timeout=30)
        try:
            next_name = _backup_name(datetime.now(timezone.utc))
            while (BACKUP_DIR / next_name).exists():
                next_name = _backup_name(datetime.now(timezone.utc))
            tmp_path = BACKUP_DIR / (next_name + ".tmp")
            dest = sqlite3.connect(str(tmp_path))
            try:
                src.backup(dest)      # consistent even under concurrent writes
            finally:
                dest.close()
            tmp_path.replace(BACKUP_DIR / next_name)
        finally:
            src.close()

        backups = list_backups()
        for stale in backups[DB_BACKUP_KEEP:]:
            stale.unlink(missing_ok=True)
        _set_last_backup_at(datetime.now(timezone.utc))
        logger.info("db backup written: %s (%d kept)", next_name, len(backups))
        return BACKUP_DIR / next_name
    except Exception:
        logger.exception("db backup failed for %s", db_path)
        return None


def restore_latest_backup(db_path: Path | None = None) -> Path | None:
    """Write the newest backup back over a corrupt ``db_path``.

    Returns the restored backup path, or ``None`` if there was nothing safe
    to restore from.  Writes are atomic (temp file + ``replace``), so a
    failure mid-copy cannot leave the database half-written.
    """
    db_path = Path(db_path or DB_PATH)
    backup = _latest_backup()
    if backup is None:
        logger.error("db restore requested but no backup exists")
        return None
    try:
        if backup.stat().st_size > _MAX_BACKUP_SIZE_MB * 1024 * 1024:
            logger.error("refusing to restore oversized backup: %s", backup)
            return None
        # Drop any WAL/SHM files so the restored file is used as-is.
        for suffix in ("-wal", "-shm"):
            (Path(str(db_path) + suffix)).unlink(missing_ok=True)
        tmp_path = db_path.with_suffix(db_path.suffix + ".restore.tmp")
        with backup.open("rb") as src, tmp_path.open("wb") as dst:
            for chunk in iter(lambda: src.read(1 << 20), b""):
                dst.write(chunk)
        tmp_path.replace(db_path)
        logger.info("db restored from %s", backup)
        return backup
    except Exception:
        logger.exception("db restore failed from %s", backup)
        return None


def looks_like_corruption(exc: Exception) -> bool:
    """True when ``exc`` points at a broken file rather than a transient lock."""
    if not isinstance(exc, sqlite3.Error):
        return False
    message = " ".join(str(arg) for arg in exc.args).lower()
    for needle in ("corrupt", "malformed", "not a database", "disk i/o error"):
        if needle in message:
            return True
    return False


def _set_last_backup_at(value: datetime | None) -> None:
    global _last_backup_at
    with _backup_lock:
        _last_backup_at = value


def backup_status() -> dict:
    """Summary for the ops monitor; exposed via ``/api/health``."""
    with _backup_lock:
        last = _last_backup_at
    return {
        "enabled": True,
        "last_backup_at": last.astimezone().isoformat(timespec="seconds") if last else None,
        "backup_dir": str(BACKUP_DIR),
        "files": len(list_backups()),
    }


def start_backup_scheduler() -> None:
    """Run periodic snapshots on a daemon thread (active instances only)."""
    interval = max(DB_BACKUP_INTERVAL_MIN * 60, 60)
    _set_last_backup_at(None)

    def loop() -> None:
        time.sleep(INITIAL_DELAY_SEC)
        while True:
            backup_database()
            time.sleep(interval)

    threading.Thread(target=loop, name="db-backup-scheduler", daemon=True).start()
    logger.info("db backup scheduler started (every %d min, keep %d)",
                DB_BACKUP_INTERVAL_MIN, DB_BACKUP_KEEP)