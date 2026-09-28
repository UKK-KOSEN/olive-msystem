"""
olive-msystem storage: SQLite database for uploaded videos and their
time-specified analysis results, plus a small file index.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import shutil
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .config import DB_PATH, STORAGE_DIR


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _json_default(value) -> object:
    """JSON encoder fallback that never raises on numpy/Python scalars.

    The detection pipeline produces numpy scalars (np.float32, np.int64, ...)
    that are not ``np.ndarray`` and so survive the analyzer's filter; without
    this, ``json.dumps`` raises TypeError and aborts the whole video job.
    """
    import numpy as np
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    return str(value)


def _json_dumps(obj) -> str:
    try:
        return json.dumps(obj, ensure_ascii=False)
    except (TypeError, ValueError):
        try:
            return json.dumps(obj, ensure_ascii=False, default=_json_default)
        except Exception:
            return json.dumps({"serialization_error": True})


def atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> None:
    """Write a text file atomically (temp file + os.replace).

    A crash or power loss mid-write must never leave a truncated
    config/settings file, which the lenient loaders would silently accept.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding=encoding)
    try:
        import os
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _rmtree_retry(path: Path, attempts: int = 3, delay: float = 0.3) -> None:
    """Remove a directory tree, retrying on transient OSError (e.g. Windows locks)."""
    for i in range(attempts):
        try:
            shutil.rmtree(path)
            return
        except OSError:
            if i == attempts - 1:
                return
            time.sleep(delay)


_PBKDF2_ITER = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITER)
    return f"pbkdf2${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
    except (ValueError, AttributeError):
        return False
    if scheme != "pbkdf2":
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITER)
    return hmac.compare_digest(dk.hex(), digest)


class Store:
    """Thread-safe SQLite store. Uses one connection per call."""

    def __init__(self, db_path=None, *, initialize_schema=True, read_only=False):
        self.path = Path(db_path or DB_PATH)
        self.read_only = read_only
        if not self.read_only:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        if initialize_schema and not self.read_only:
            self._init_schema()

    def _connect(self):
        if self.read_only:
            uri = f"{self.path.resolve().as_uri()}?mode=ro"
            con = sqlite3.connect(uri, uri=True, timeout=30)
        else:
            con = sqlite3.connect(str(self.path), timeout=30)
        con.row_factory = sqlite3.Row
        try:
            # Reduce "database is locked" OperationalErrors under concurrent
            # writers (runner + request handlers + sensor monitor thread).
            con.execute("PRAGMA busy_timeout=30000")
            if self.read_only:
                con.execute("PRAGMA query_only=ON")
        except sqlite3.Error:
            pass
        return con

    def _init_schema(self):
        con = self._connect()
        try:
            # WAL journal: safer with the long-running service (concurrent
            # readers + single writer) and makes online backups consistent.
            # synchronous=NORMAL is durable enough for WAL (a checkpoint or
            # two may be lost on power failure, never committed data) and
            # avoids fsync-ing on every commit.
            con.execute("PRAGMA journal_mode=WAL")
            con.execute("PRAGMA synchronous=NORMAL")
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'farmer',   -- farmer|admin
                    display_name TEXT,
                    farm_name TEXT,
                    created_at TEXT NOT NULL,
                    is_active INTEGER DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS videos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    filename TEXT NOT NULL,
                    storage_path TEXT NOT NULL,
                    size_bytes INTEGER DEFAULT 0,
                    duration_sec REAL,
                    fps REAL,
                    width INTEGER,
                    height INTEGER,
                    created_at TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',   -- pending|processing|done|error
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    filename TEXT NOT NULL,
                    storage_path TEXT NOT NULL,
                    size_bytes INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS observations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    video_id INTEGER,
                    image_id INTEGER,
                    source_type TEXT DEFAULT 'video',
                    timestamp_sec REAL NOT NULL,
                    label TEXT,
                    observed_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    leaf_count INTEGER,
                    fruit_count INTEGER,
                    green_coverage REAL,
                    overall_health_score REAL,
                    water_stress REAL,
                    leaf_curl_index REAL,
                    wrinkled_fruit_count INTEGER,
                    result_json TEXT NOT NULL,
                    annotated_path TEXT,
                    raw_frame_path TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id),
                    FOREIGN KEY(video_id) REFERENCES videos(id),
                    FOREIGN KEY(image_id) REFERENCES images(id)
                );
                CREATE TABLE IF NOT EXISTS trees (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    tree_id TEXT NOT NULL,
                    name TEXT,
                    variety TEXT,
                    row_num INTEGER NOT NULL DEFAULT 1,
                    col_num INTEGER NOT NULL DEFAULT 1,
                    note TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(user_id, tree_id),
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );
                CREATE INDEX IF NOT EXISTS idx_trees_user ON trees(user_id);
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    target_role TEXT DEFAULT 'all',  -- all|farmer|admin
                    target_user_id INTEGER,  -- NULL = all users of target_role
                    created_by INTEGER,
                    created_at TEXT NOT NULL,
                    is_read INTEGER DEFAULT 0,
                    FOREIGN KEY(created_by) REFERENCES users(id),
                    FOREIGN KEY(target_user_id) REFERENCES users(id)
                );
                CREATE TABLE IF NOT EXISTS sensor_alert_state (
                    key TEXT PRIMARY KEY,
                    mode TEXT NOT NULL,          -- ok|unconfigured|stale|api_error|risk
                    opened_at TEXT,
                    last_sent_at TEXT,
                    level INTEGER DEFAULT 0,     -- number of reminders sent
                    data TEXT DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS sensor_alert_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mode TEXT NOT NULL,          -- ok|unconfigured|stale|api_error|risk|test
                    severity TEXT NOT NULL,      -- info|warning|critical|recovered|test
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    channels TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                );
                """
            )
            # ---- lightweight migration for pre-existing DBs -----------------
            cols = {r["name"] for r in con.execute("PRAGMA table_info(observations)").fetchall()}
            for name in ("image_id", "source_type", "user_id"):
                if name not in cols:
                    sqltype = "TEXT" if name == "source_type" else "INTEGER"
                    con.execute(f"ALTER TABLE observations ADD COLUMN {name} {sqltype}")
            if "tree_id" not in cols:
                con.execute("ALTER TABLE observations ADD COLUMN tree_id TEXT")
                con.execute("CREATE INDEX IF NOT EXISTS idx_observations_tree ON observations(tree_id)")
            for table in ("videos", "images"):
                vcols = {r["name"] for r in con.execute(f"PRAGMA table_info({table})").fetchall()}
                if "user_id" not in vcols:
                    con.execute(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER")
                if "recorded_at" not in vcols:
                    con.execute(f"ALTER TABLE {table} ADD COLUMN recorded_at TEXT")
            # preferences column for user settings
            ucols = {r["name"] for r in con.execute("PRAGMA table_info(users)").fetchall()}
            if "preferences" not in ucols:
                con.execute("ALTER TABLE users ADD COLUMN preferences TEXT DEFAULT '{}'")
            # farm profile fields for richer farmer accounts
            for name, sqltype in (
                ("farm_area", "TEXT"),
                ("farm_trees", "INTEGER"),
                ("farm_variety", "TEXT"),
                ("farm_location", "TEXT"),
                ("farm_contact", "TEXT"),
            ):
                if name not in ucols:
                    con.execute(f"ALTER TABLE users ADD COLUMN {name} {sqltype}")
            con.commit()
        finally:
            con.close()

    # ---- users & sessions -------------------------------------------------
    def create_user(self, username: str, password: str, role: str = "farmer",
                    display_name: Optional[str] = None,
                    farm_name: Optional[str] = None,
                    farm_area: Optional[str] = None,
                    farm_trees: Optional[int] = None,
                    farm_variety: Optional[str] = None,
                    farm_location: Optional[str] = None,
                    farm_contact: Optional[str] = None) -> Optional[dict]:
        with self._lock:
            con = self._connect()
            try:
                cur = con.execute(
                    "SELECT id FROM users WHERE username = ?", (username,)
                )
                if cur.fetchone():
                    return None
                cur = con.execute(
                    "INSERT INTO users (username, password_hash, role, display_name, "
                    "farm_name, farm_area, farm_trees, farm_variety, farm_location, "
                    "farm_contact, created_at, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
                    (username, hash_password(password), role, display_name, farm_name,
                     farm_area, farm_trees, farm_variety, farm_location, farm_contact, _now()),
                )
                con.commit()
                return self.get_user(cur.lastrowid)
            finally:
                con.close()

    def get_user(self, user_id: int) -> Optional[dict]:
        con = self._connect()
        try:
            row = con.execute(
                "SELECT id, username, role, display_name, farm_name, farm_area, farm_trees, "
                "farm_variety, farm_location, farm_contact, created_at, is_active, preferences "
                "FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if row:
                d = dict(row)
                import json
                d["preferences"] = json.loads(d.get("preferences") or "{}")
                return d
            return None
        finally:
            con.close()

    def get_user_by_username(self, username: str) -> Optional[dict]:
        con = self._connect()
        try:
            row = con.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            return dict(row) if row else None
        finally:
            con.close()

    def list_users(self) -> list[dict]:
        con = self._connect()
        try:
            rows = con.execute(
                "SELECT id, username, role, display_name, farm_name, farm_area, farm_trees, "
                "farm_variety, farm_location, farm_contact, created_at, is_active "
                "FROM users ORDER BY id ASC"
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            con.close()

    def update_user(self, user_id: int, **fields) -> None:
        allowed = {"display_name", "farm_name", "role", "is_active", "username",
                   "farm_area", "farm_trees", "farm_variety", "farm_location", "farm_contact"}
        sets = ", ".join(f"{k} = ?" for k in fields if k in allowed)
        if not sets:
            return
        with self._lock:
            con = self._connect()
            try:
                con.execute(f"UPDATE users SET {sets} WHERE id = ?",
                            (*[fields[k] for k in fields if k in allowed], user_id))
                con.commit()
            finally:
                con.close()

    def set_user_password(self, user_id: int, password: str) -> None:
        with self._lock:
            con = self._connect()
            try:
                con.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                            (hash_password(password), user_id))
                con.commit()
            finally:
                con.close()

    def get_preferences(self, user_id: int) -> dict:
        con = self._connect()
        try:
            row = con.execute("SELECT preferences FROM users WHERE id = ?", (user_id,)).fetchone()
            if row and row["preferences"]:
                import json
                return json.loads(row["preferences"])
            return {}
        finally:
            con.close()

    def update_preferences(self, user_id: int, prefs: dict) -> dict:
        import json
        with self._lock:
            con = self._connect()
            try:
                current = self.get_preferences(user_id)
                current.update(prefs)
                con.execute("UPDATE users SET preferences = ? WHERE id = ?",
                            (json.dumps(current, ensure_ascii=False), user_id))
                con.commit()
                return current
            finally:
                con.close()

    def delete_user(self, user_id: int) -> bool:
        """Delete a user and all owned data. Returns True if a user was removed."""
        with self._lock:
            con = self._connect()
            try:
                row = con.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
                if not row:
                    return False
                con.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
                con.execute("DELETE FROM observations WHERE user_id = ?", (user_id,))
                vids = [r["id"] for r in con.execute("SELECT id FROM videos WHERE user_id = ?", (user_id,)).fetchall()]
                iids = [r["id"] for r in con.execute("SELECT id FROM images WHERE user_id = ?", (user_id,)).fetchall()]
                con.execute("DELETE FROM videos WHERE user_id = ?", (user_id,))
                con.execute("DELETE FROM images WHERE user_id = ?", (user_id,))
                con.execute("DELETE FROM users WHERE id = ?", (user_id,))
                con.commit()
                return {"videos": vids, "images": iids}
            finally:
                con.close()

    def create_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            con = self._connect()
            try:
                expires = (datetime.now().astimezone() + timedelta(days=30)).isoformat(timespec="seconds")
                con.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
                con.execute(
                    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)",
                    (token, user_id, expires, _now()),
                )
                con.commit()
                return token
            finally:
                con.close()

    def get_user_by_token(self, token: str) -> Optional[dict]:
        if not token:
            return None
        con = self._connect()
        try:
            row = con.execute(
                "SELECT u.id, u.username, u.role, u.display_name, u.farm_name, u.is_active, u.preferences "
                "FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token = ? AND s.expires_at > ?",
                (token, datetime.now().astimezone().isoformat(timespec="seconds")),
            ).fetchone()
            if not row:
                return None
            u = dict(row)
            if not u.get("is_active"):
                return None
            if u.get("preferences"):
                import json
                try:
                    u["preferences"] = json.loads(u["preferences"])
                except Exception:
                    u["preferences"] = {}
            else:
                u["preferences"] = {}
            return u
        finally:
            con.close()

    def delete_session(self, token: str) -> None:
        with self._lock:
            con = self._connect()
            try:
                con.execute("DELETE FROM sessions WHERE token = ?", (token,))
                con.commit()
            finally:
                con.close()

    # ---- notifications -----------------------------------------------------
    def add_notification(self, title: str, body: str, created_by: int,
                         target_role: str = "all", target_user_id: Optional[int] = None) -> int:
        with self._lock:
            con = self._connect()
            try:
                cur = con.execute(
                    "INSERT INTO notifications (title, body, target_role, target_user_id, created_by, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (title, body, target_role, target_user_id, created_by, _now()),
                )
                con.commit()
                return cur.lastrowid
            finally:
                con.close()

    def list_notifications(self, user_id: int, role: str) -> list[dict]:
        con = self._connect()
        try:
            if role == "admin":
                rows = con.execute(
                    "SELECT n.*, u.username as creator_name "
                    "FROM notifications n LEFT JOIN users u ON u.id = n.created_by "
                    "ORDER BY n.created_at DESC"
                ).fetchall()
            else:
                rows = con.execute(
                    "SELECT n.*, u.username as creator_name "
                    "FROM notifications n LEFT JOIN users u ON u.id = n.created_by "
                    "WHERE (n.target_role = 'all' OR n.target_role = ?) "
                    "AND (n.target_user_id IS NULL OR n.target_user_id = ?) "
                    "ORDER BY n.created_at DESC",
                    (role, user_id),
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            con.close()

    def mark_notification_read(self, notification_id: int, user_id: int) -> None:
        with self._lock:
            con = self._connect()
            try:
                con.execute(
                    "UPDATE notifications SET is_read = 1 WHERE id = ? AND (target_user_id = ? OR target_user_id IS NULL)",
                    (notification_id, user_id),
                )
                con.commit()
            finally:
                con.close()

    def count_unread_notifications(self, user_id: int, role: str) -> int:
        con = self._connect()
        try:
            row = con.execute(
                "SELECT COUNT(*) as cnt FROM notifications "
                "WHERE is_read = 0 "
                "AND (target_role = 'all' OR target_role = ?) "
                "AND (target_user_id IS NULL OR target_user_id = ?)",
                (role, user_id),
            ).fetchone()
            return row["cnt"] if row else 0
        finally:
            con.close()

    def delete_notification(self, notification_id: int) -> bool:
        with self._lock:
            con = self._connect()
            try:
                cur = con.execute("DELETE FROM notifications WHERE id = ?", (notification_id,))
                con.commit()
                return cur.rowcount > 0
            finally:
                con.close()

    # ---- sensor alert state / history ------------------------------------
    def get_sensor_alert_state(self, key: str = "default") -> Optional[dict]:
        con = self._connect()
        try:
            row = con.execute(
                "SELECT * FROM sensor_alert_state WHERE key = ?", (key,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            con.close()

    def set_sensor_alert_state(self, key: str, mode: str, opened_at: Optional[str],
                               last_sent_at: Optional[str], level: int,
                               data: Optional[dict]) -> None:
        with self._lock:
            con = self._connect()
            try:
                con.execute(
                    "INSERT INTO sensor_alert_state (key, mode, opened_at, last_sent_at, level, data) "
                    "VALUES (?,?,?,?,?,?) "
                    "ON CONFLICT(key) DO UPDATE SET mode=excluded.mode, "
                    "opened_at=excluded.opened_at, last_sent_at=excluded.last_sent_at, "
                    "level=excluded.level, data=excluded.data",
                    (key, mode, opened_at, last_sent_at, int(level),
                     json.dumps(data or {}, ensure_ascii=False)),
                )
                con.commit()
            finally:
                con.close()

    def add_sensor_alert_event(self, mode: str, severity: str, title: str,
                               body: str, channels: str) -> int:
        with self._lock:
            con = self._connect()
            try:
                cur = con.execute(
                    "INSERT INTO sensor_alert_events (mode, severity, title, body, channels, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (mode, severity, title, body, channels, _now()),
                )
                con.commit()
                return cur.lastrowid
            finally:
                con.close()

    def get_sensor_alert_events(self, limit: int = 50) -> list[dict]:
        con = self._connect()
        try:
            rows = con.execute(
                "SELECT * FROM sensor_alert_events ORDER BY id DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            con.close()

    # ---- videos -----------------------------------------------------------
    def add_video(self, filename: str, storage_path: str, size_bytes: int,
                  user_id: Optional[int] = None,
                  recorded_at: Optional[str] = None) -> int:
        with self._lock:
            con = self._connect()
            try:
                cur = con.execute(
                    "INSERT INTO videos (user_id, filename, storage_path, size_bytes, created_at, status, recorded_at) "
                    "VALUES (?,?,?,?,?, 'pending', ?)",
                    (user_id, filename, str(storage_path), size_bytes, _now(), recorded_at),
                )
                con.commit()
                return cur.lastrowid
            finally:
                con.close()

    def update_video(self, video_id: int, **fields) -> None:
        if not fields:
            return
        allowed = {"status", "duration_sec", "fps", "width", "height", "recorded_at"}
        sets = ", ".join(f"{k} = ?" for k in fields if k in allowed)
        if not sets:
            return
        with self._lock:
            con = self._connect()
            try:
                con.execute(
                    f"UPDATE videos SET {sets} WHERE id = ?",
                    (*[fields[k] for k in fields if k in allowed], video_id),
                )
                con.commit()
            finally:
                con.close()

    def get_video(self, video_id: int) -> Optional[dict]:
        con = self._connect()
        try:
            row = con.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()
            return dict(row) if row else None
        finally:
            con.close()

    def list_videos(self, status: Optional[str] = None,
                    user_id: Optional[int] = None) -> list[dict]:
        con = self._connect()
        try:
            where = []
            params = []
            if status:
                where.append("status = ?")
                params.append(status)
            if user_id is not None:
                where.append("user_id = ?")
                params.append(user_id)
            sql = "SELECT * FROM videos"
            if where:
                sql += " WHERE " + " AND ".join(where)
            sql += " ORDER BY id DESC"
            rows = con.execute(sql, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            con.close()

    # ---- images -----------------------------------------------------------
    def add_image(self, filename: str, storage_path: str, size_bytes: int,
                  user_id: Optional[int] = None,
                  recorded_at: Optional[str] = None) -> int:
        with self._lock:
            con = self._connect()
            try:
                cur = con.execute(
                    "INSERT INTO images (user_id, filename, storage_path, size_bytes, created_at, status, recorded_at) "
                    "VALUES (?,?,?,?,?, 'pending', ?)",
                    (user_id, filename, str(storage_path), size_bytes, _now(), recorded_at),
                )
                con.commit()
                return cur.lastrowid
            finally:
                con.close()

    def update_image(self, image_id: int, **fields) -> None:
        if not fields:
            return
        allowed = {"status", "recorded_at"}
        sets = ", ".join(f"{k} = ?" for k in fields if k in allowed)
        if not sets:
            return
        with self._lock:
            con = self._connect()
            try:
                con.execute(
                    f"UPDATE images SET {sets} WHERE id = ?",
                    (*[fields[k] for k in fields if k in allowed], image_id),
                )
                con.commit()
            finally:
                con.close()

    def get_image(self, image_id: int) -> Optional[dict]:
        con = self._connect()
        try:
            row = con.execute("SELECT * FROM images WHERE id = ?", (image_id,)).fetchone()
            return dict(row) if row else None
        finally:
            con.close()

    def list_images(self, user_id: Optional[int] = None) -> list[dict]:
        con = self._connect()
        try:
            if user_id is not None:
                rows = con.execute(
                    "SELECT * FROM images WHERE user_id = ? ORDER BY id DESC", (user_id,)
                ).fetchall()
            else:
                rows = con.execute("SELECT * FROM images ORDER BY id DESC").fetchall()
            return [dict(r) for r in rows]
        finally:
            con.close()

    # ---- observations -----------------------------------------------------
    def add_observation(self, source_type: str, rec: dict,
                        video_id: Optional[int] = None,
                        image_id: Optional[int] = None,
                        user_id: Optional[int] = None) -> int:
        with self._lock:
            con = self._connect()
            try:
                if user_id is None and video_id is not None:
                    row = con.execute("SELECT user_id FROM videos WHERE id = ?", (video_id,)).fetchone()
                    if row:
                        user_id = row["user_id"]
                if user_id is None and image_id is not None:
                    row = con.execute("SELECT user_id FROM images WHERE id = ?", (image_id,)).fetchone()
                    if row:
                        user_id = row["user_id"]
                cur = con.execute(
                    "INSERT INTO observations "
                    "(user_id, video_id, image_id, source_type, timestamp_sec, label, observed_at, source, "
                    " tree_id, leaf_count, fruit_count, green_coverage, overall_health_score, "
                    " water_stress, leaf_curl_index, wrinkled_fruit_count, "
                    " result_json, annotated_path, raw_frame_path) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        user_id,
                        video_id,
                        image_id,
                        source_type,
                        rec.get("timestamp_sec", 0.0),
                        rec.get("label"),
                        rec.get("observed_at", _now()),
                        rec.get("source", ""),
                        rec.get("tree_id"),
                        rec.get("leaf_count"),
                        rec.get("fruit_count"),
                        rec.get("green_coverage"),
                        rec.get("overall_health_score"),
                        rec.get("water_stress"),
                        rec.get("leaf_curl_index"),
                        rec.get("wrinkled_fruit_count"),
                        json.dumps(rec, ensure_ascii=False, default=_json_default),
                        rec.get("_frame_annotated"),
                        rec.get("_frame_raw"),
                    ),
                )
                con.commit()
                return cur.lastrowid
            finally:
                con.close()

    def list_observations(self, video_id: Optional[int] = None,
                          image_id: Optional[int] = None,
                          source_type: Optional[str] = None,
                          user_id: Optional[int] = None,
                          tree_id: Optional[str] = None,
                          from_date: Optional[str] = None,
                          to_date: Optional[str] = None,
                          limit: int = 500) -> list[dict]:
        con = self._connect()
        try:
            sql = (
                "SELECT o.*, "
                "COALESCE(v.filename, im.filename) AS filename "
                "FROM observations o "
                "LEFT JOIN videos v ON v.id = o.video_id "
                "LEFT JOIN images im ON im.id = o.image_id "
            )
            where = []
            params = []
            if source_type:
                where.append("o.source_type = ?")
                params.append(source_type)
            if video_id is not None:
                where.append("o.video_id = ?")
                params.append(video_id)
            if image_id is not None:
                where.append("o.image_id = ?")
                params.append(image_id)
            if user_id is not None:
                where.append("o.user_id = ?")
                params.append(user_id)
            if tree_id:
                where.append("o.tree_id = ?")
                params.append(tree_id)
            if from_date:
                where.append("o.observed_at >= ?")
                params.append(from_date + "T00:00:00")
            if to_date:
                # exclusive upper bound = next day 00:00
                dt = datetime.strptime(to_date, "%Y-%m-%d")
                next_day = dt + timedelta(days=1)
                where.append("o.observed_at < ?")
                params.append(next_day.strftime("%Y-%m-%dT%H:%M:%S"))
            if where:
                sql += "WHERE " + " AND ".join(where) + " "
            if video_id is not None:
                sql += "ORDER BY o.timestamp_sec ASC LIMIT ?"
            else:
                sql += "ORDER BY o.id DESC LIMIT ?"
            params.append(limit)
            rows = con.execute(sql, params).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                try:
                    d["result"] = json.loads(d["result_json"])
                except Exception:
                    d["result"] = {}
                d.pop("result_json", None)
                result.append(d)
            return result
        finally:
            con.close()

    def count(self) -> int:
        con = self._connect()
        try:
            n = con.execute("SELECT COUNT(*) c FROM observations").fetchone()[0]
            m = con.execute("SELECT COUNT(*) c FROM videos").fetchone()[0]
            i = con.execute("SELECT COUNT(*) c FROM images").fetchone()[0]
            return {"observations": n, "videos": m, "images": i}
        finally:
            con.close()

    def list_trees(self, user_id: Optional[int] = None) -> list[dict]:
        """Distinct tree ids (QR-recognised or manually assigned) for tracing."""
        con = self._connect()
        try:
            sql = (
                "SELECT tree_id, COUNT(*) AS observation_count, "
                "MIN(observed_at) AS first_seen, MAX(observed_at) AS last_seen "
                "FROM observations WHERE tree_id IS NOT NULL AND tree_id != ''"
            )
            params: list = []
            if user_id is not None:
                sql += " AND user_id = ?"
                params.append(user_id)
            sql += " GROUP BY tree_id ORDER BY last_seen DESC, tree_id ASC"
            rows = con.execute(sql, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            con.close()

    # ---- tree registry (farm map) ---------------------------------------
    def list_trees_registry(self, user_id: Optional[int] = None) -> list[dict]:
        """Registered trees with their farm-map position and observation stats."""
        con = self._connect()
        try:
            sql = (
                "SELECT t.id, t.user_id, t.tree_id, t.name, t.variety, "
                "t.row_num, t.col_num, t.note, t.created_at, t.updated_at, "
                "COUNT(o.id) AS observation_count, "
                "MIN(o.observed_at) AS first_seen, MAX(o.observed_at) AS last_seen "
                "FROM trees t "
                "LEFT JOIN observations o ON o.tree_id = t.tree_id "
                "AND (o.user_id = t.user_id OR o.user_id IS NULL) "
            )
            params: list = []
            if user_id is not None:
                sql += "WHERE t.user_id = ? "
                params.append(user_id)
            sql += (
                "GROUP BY t.id "
                "ORDER BY t.row_num ASC, t.col_num ASC, t.tree_id ASC"
            )
            rows = con.execute(sql, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            con.close()

    def create_tree(self, user_id: int, tree_id: str, name: Optional[str] = None,
                    variety: Optional[str] = None, row_num: int = 1,
                    col_num: int = 1, note: Optional[str] = None) -> dict:
        now = _now()
        con = self._connect()
        try:
            try:
                cur = con.execute(
                    "INSERT INTO trees (user_id, tree_id, name, variety, "
                    "row_num, col_num, note, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (user_id, tree_id.strip(), name or None, variety or None,
                     row_num, col_num, note or None, now, now),
                )
                con.commit()
            except sqlite3.IntegrityError:
                with self._lock:
                    cur = con.execute(
                        "SELECT id FROM trees WHERE user_id = ? AND tree_id = ?",
                        (user_id, tree_id.strip()),
                    )
                    if cur.fetchone():
                        raise ValueError("その樹木IDは既に登録されています")
                    raise
            row = con.execute(
                "SELECT id, user_id, tree_id, name, variety, row_num, col_num, "
                "note, created_at, updated_at FROM trees WHERE id = ?",
                (cur.lastrowid,),
            ).fetchone()
            return dict(row)
        finally:
            con.close()

    def update_tree(self, user_id: int, tree_id: str,
                    name: Optional[str] = None, variety: Optional[str] = None,
                    row_num: Optional[int] = None, col_num: Optional[int] = None,
                    note: Optional[str] = None) -> Optional[dict]:
        now = _now()
        con = self._connect()
        try:
            cur = con.execute(
                "UPDATE trees SET name = COALESCE(?, name), "
                "variety = COALESCE(?, variety), "
                "row_num = COALESCE(?, row_num), "
                "col_num = COALESCE(?, col_num), "
                "note = COALESCE(?, note), "
                "updated_at = ? "
                "WHERE user_id = ? AND tree_id = ?",
                (name or None, variety or None, row_num, col_num,
                 note or None, now, user_id, tree_id),
            )
            con.commit()
            if cur.rowcount == 0:
                return None
            row = con.execute(
                "SELECT id, user_id, tree_id, name, variety, row_num, col_num, "
                "note, created_at, updated_at FROM trees "
                "WHERE user_id = ? AND tree_id = ?",
                (user_id, tree_id),
            ).fetchone()
            return dict(row)
        finally:
            con.close()

    def delete_tree(self, user_id: int, tree_id: str) -> bool:
        con = self._connect()
        try:
            cur = con.execute(
                "DELETE FROM trees WHERE user_id = ? AND tree_id = ?",
                (user_id, tree_id),
            )
            con.commit()
            return cur.rowcount > 0
        finally:
            con.close()

    def count_trees(self, user_id: Optional[int] = None) -> int:
        con = self._connect()
        try:
            if user_id is not None:
                return con.execute(
                    "SELECT COUNT(*) c FROM trees WHERE user_id = ?",
                    (user_id,)).fetchone()[0]
            return con.execute("SELECT COUNT(*) c FROM trees").fetchone()[0]
        finally:
            con.close()

    def count_observations(self, user_id: Optional[int] = None) -> int:
        con = self._connect()
        try:
            if user_id is not None:
                return con.execute(
                    "SELECT COUNT(*) c FROM observations WHERE user_id = ?",
                    (user_id,)).fetchone()[0]
            return con.execute("SELECT COUNT(*) c FROM observations").fetchone()[0]
        finally:
            con.close()

    def count_videos(self, user_id: Optional[int] = None) -> int:
        con = self._connect()
        try:
            if user_id is not None:
                return con.execute(
                    "SELECT COUNT(*) c FROM videos WHERE user_id = ?",
                    (user_id,)).fetchone()[0]
            return con.execute("SELECT COUNT(*) c FROM videos").fetchone()[0]
        finally:
            con.close()

    def count_images(self, user_id: Optional[int] = None) -> int:
        con = self._connect()
        try:
            if user_id is not None:
                return con.execute(
                    "SELECT COUNT(*) c FROM images WHERE user_id = ?",
                    (user_id,)).fetchone()[0]
            return con.execute("SELECT COUNT(*) c FROM images").fetchone()[0]
        finally:
            con.close()

    def stats(self) -> dict:
        """DB stats + on-disk usage for the admin page."""
        con = self._connect()
        try:
            obs = con.execute("SELECT COUNT(*) c FROM observations").fetchone()[0]
            videos = con.execute("SELECT COUNT(*) c FROM videos").fetchone()[0]
            images = con.execute("SELECT COUNT(*) c FROM images").fetchone()[0]
            video_bytes = con.execute("SELECT COALESCE(SUM(size_bytes),0) s FROM videos").fetchone()[0]
            image_bytes = con.execute("SELECT COALESCE(SUM(size_bytes),0) s FROM images").fetchone()[0]
            db_bytes = self.path.stat().st_size if self.path.exists() else 0
            return {
                "observations": obs,
                "videos": videos,
                "images": images,
                "video_storage_bytes": video_bytes,
                "image_storage_bytes": image_bytes,
                "db_bytes": db_bytes,
            }
        finally:
            con.close()

    # ---- deletes (admin) --------------------------------------------------
    def delete_video(self, video_id: int) -> Optional[str]:
        """Delete a video and its observations. Returns its storage path."""
        with self._lock:
            con = self._connect()
            try:
                row = con.execute("SELECT storage_path FROM videos WHERE id = ?", (video_id,)).fetchone()
                if not row:
                    return None
                out = STORAGE_DIR / str(video_id)
                con.execute("DELETE FROM observations WHERE video_id = ?", (video_id,))
                con.execute("DELETE FROM videos WHERE id = ?", (video_id,))
                con.commit()
                if out.is_dir():
                    _rmtree_retry(out)
                return row["storage_path"]
            finally:
                con.close()

    def delete_image(self, image_id: int) -> Optional[str]:
        """Delete an image and its observations. Returns its storage folder."""
        with self._lock:
            con = self._connect()
            try:
                row = con.execute("SELECT storage_path FROM images WHERE id = ?", (image_id,)).fetchone()
                if not row:
                    return None
                out = STORAGE_DIR / f"img_{image_id}"
                con.execute("DELETE FROM observations WHERE image_id = ?", (image_id,))
                con.execute("DELETE FROM images WHERE id = ?", (image_id,))
                con.commit()
                if out.is_dir():
                    _rmtree_retry(out)
                return row["storage_path"]
            finally:
                con.close()

    def delete_observation(self, observation_id: int) -> bool:
        with self._lock:
            con = self._connect()
            try:
                cur = con.execute("DELETE FROM observations WHERE id = ?", (observation_id,))
                con.commit()
                return cur.rowcount > 0
            finally:
                con.close()

    def delete_observation_owned(self, observation_id: int,
                                 user_id: Optional[int]) -> bool:
        """Delete an observation only if it belongs to user_id (or any if None)."""
        with self._lock:
            con = self._connect()
            try:
                if user_id is None:
                    cur = con.execute(
                        "DELETE FROM observations WHERE id = ?", (observation_id,))
                else:
                    cur = con.execute(
                        "DELETE FROM observations WHERE id = ? AND user_id = ?",
                        (observation_id, user_id))
                con.commit()
                return cur.rowcount > 0
            finally:
                con.close()

    def clear_observations(self) -> int:
        with self._lock:
            con = self._connect()
            try:
                cur = con.execute("DELETE FROM observations")
                con.commit()
                return cur.rowcount
            finally:
                con.close()
