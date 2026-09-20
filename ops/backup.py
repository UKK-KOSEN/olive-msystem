"""olive-msystem backup: consistent DB copy + config + media, with retention.

Run manually (ops/backup.bat) or via Task Scheduler daily.  Keeps the last
``--keep`` backups and appends an audit line to ``logs/backup.log``.

Usage:
    python ops/backup.py [--keep N] [--include-storage] [--out DIR]
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # olive-msystem/
LOGS_DIR = ROOT / "logs"
DEFAULT_OUT = ROOT / "backups"

INCLUDE: list[tuple[str, Path]] = [
    ("config", ROOT / "backend" / "config"),            # settings / secrets (may be absent)
    ("uploads", ROOT / "backend" / "uploads"),          # raw uploaded media
]


def log(msg: str) -> None:
    line = f"{datetime.now().astimezone().isoformat(timespec='seconds')} [backup] {msg}"
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    with (LOGS_DIR / "backup.log").open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)


def backup_db(src: Path, dst: Path) -> bool:
    """Consistent online copy via the SQLite backup API (WAL safe)."""
    try:
        s = sqlite3.connect(str(src))
        d = sqlite3.connect(str(dst))
        try:
            s.backup(d)
        finally:
            d.close()
            s.close()
        return True
    except Exception as e:  # noqa: BLE001
        log(f"db backup failed: {e}")
        return False


def verify_db(path: Path) -> bool:
    """Verify a backup with SQLite's integrity check."""
    try:
        con = sqlite3.connect(str(path))
        try:
            result = con.execute("PRAGMA integrity_check").fetchone()
            return bool(result and result[0] == "ok")
        finally:
            con.close()
    except Exception as e:  # noqa: BLE001
        log(f"db verify failed: {e}")
        return False


def prune(out: Path, keep: int) -> None:
    dirs = sorted(
        (p for p in out.glob("20*_20*") if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    for old in dirs[keep:]:
        shutil.rmtree(old, ignore_errors=True)
        log(f"pruned old backup: {old.name}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=10)
    ap.add_argument("--include-storage", action="store_true",
                    help="also copy the annotated-frame storage dir (may be large)")
    ap.add_argument("--verify", action="store_true",
                    help="run PRAGMA integrity_check on the copied database")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    dest = args.out / datetime.now().strftime("%Y%m%d_%H%M%S")
    dest.mkdir(parents=True, exist_ok=True)

    db = ROOT / "backend" / "data" / "olive_msystem.db"
    ok = backup_db(db, dest / "olive_msystem.db") if db.exists() else False
    if not ok:
        log("ABORT: DB backup failed, keeping destination anyway")
        return 1
    if args.verify and not verify_db(dest / "olive_msystem.db"):
        log("ABORT: DB integrity verification failed")
        return 1

    for name, src in INCLUDE:
        if src.exists():
            shutil.copytree(src, dest / name, dirs_exist_ok=True)
            log(f"copied {name} ({len(list(src.rglob('*')))} files)")
    if args.include_storage:
        st = ROOT / "backend" / "storage"
        if st.exists():
            shutil.copytree(st, dest / "storage", dirs_exist_ok=True)
            log("copied storage (annotated frames)")

    prune(args.out, args.keep)
    log(f"backup complete: {dest}")
    print(f"OK {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())