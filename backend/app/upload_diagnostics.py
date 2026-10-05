"""Self-diagnosis for the media upload path.

The upload endpoint spans several independent resources (disk space, the
multipart spool directory, the SQLite writer, ffprobe, OpenCV/olive-p). When
any of them fails the caller only sees an opaque 500, which is impossible to
act on without reading server logs.

This module runs each stage in isolation and reports pass/fail per stage so the
failing one can be identified directly, from the CLI or from a browser.

Every check is defensive: a diagnostic must never raise, because a raised
exception here would itself surface as a 500.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import DB_PATH, MAX_UPLOAD_MB, UPLOAD_DIR

# Free space below this is treated as a failure: a large video cannot land.
_MIN_FREE_MB = 512


def _check(name: str, ok: bool, detail: str, *, fatal: bool = True,
           hint: str = "") -> Dict[str, Any]:
    return {"name": name, "ok": bool(ok), "detail": detail,
            "fatal": bool(fatal), "hint": hint}


def _free_mb(path: Path) -> Optional[int]:
    try:
        return shutil.disk_usage(str(path)).free // (1024 * 1024)
    except OSError:
        return None


def _actually_writable(path: Path) -> Optional[str]:
    """Prove writability by writing a probe file.

    ``os.access(path, os.W_OK)`` is not trustworthy here: it reports success
    for root and for Windows administrators even when the directory cannot
    really be written to. Only an actual write settles it.
    """
    probe = None
    try:
        fd, probe = tempfile.mkstemp(dir=str(path), prefix=".diag_", suffix=".tmp")
        os.close(fd)
        return None
    except OSError as exc:
        return str(exc)
    finally:
        if probe:
            try:
                os.unlink(probe)
            except OSError:
                pass


def _probe_dir(name: str, path: Path, *, required: bool) -> Dict[str, Any]:
    """A directory must exist, be writable, and have room for a video."""
    if not path.exists():
        return _check(name, False, f"missing: {path}", fatal=required,
                      hint="create it, or pull the deployment again")
    if not path.is_dir():
        return _check(name, False, f"not a directory: {path}", fatal=required)
    write_err = _actually_writable(path)
    if write_err:
        return _check(name, False, f"cannot write into {path}: {write_err}",
                      fatal=required,
                      hint="check ownership/permissions for the backend service user")
    free = _free_mb(path)
    if free is None:
        return _check(name, True, f"writable (free space unknown): {path}", fatal=False)
    if free < _MIN_FREE_MB:
        return _check(name, False, f"only {free} MB free at {path}", fatal=required,
                      hint="free disk space; a video upload will fail")
    return _check(name, True, f"writable, {free} MB free: {path}")


def _check_ffprobe() -> Dict[str, Any]:
    """ffprobe must be on PATH and actually executable."""
    exe = shutil.which("ffprobe")
    if not exe:
        return _check("ffprobe", True, "not installed (capture time will be skipped)",
                      fatal=False,
                      hint="optional: apt install ffmpeg to enable video timestamps")
    try:
        proc = subprocess.run([exe, "-version"], capture_output=True,
                              text=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as exc:
        return _check("ffprobe", False, f"cannot execute {exe}: {exc}")
    if proc.returncode != 0:
        return _check("ffprobe", False, f"{exe} exited {proc.returncode}")
    first = (proc.stdout or "").splitlines()[0] if proc.stdout else "unknown"
    return _check("ffprobe", True, f"ok ({first.strip()})")


def _check_db_writable() -> Dict[str, Any]:
    """Acquire and release a real write lock.

    WAL plus busy_timeout hides contention from readers, so the only reliable
    probe is to actually take the writer lock the way add_video() does.
    """
    try:
        con = sqlite3.connect(str(DB_PATH), timeout=10)
    except sqlite3.Error as exc:
        return _check("database_write", False, f"cannot open {DB_PATH}: {exc}",
                      hint="check file permissions and available disk space")
    try:
        con.execute("PRAGMA busy_timeout=10000")
        mode = con.execute("PRAGMA journal_mode").fetchone()[0]
        con.execute("BEGIN IMMEDIATE")
        con.execute("ROLLBACK")
        if str(mode).lower() != "wal":
            return _check("database_write", True, f"writable (journal_mode={mode})",
                          fatal=False,
                          hint="WAL is recommended for concurrent readers/writers")
        return _check("database_write", True, f"writable (journal_mode={mode})")
    except sqlite3.OperationalError as exc:
        msg = str(exc)
        if "locked" in msg.lower() or "busy" in msg.lower():
            return _check("database_write", False,
                          f"database is locked: {msg}",
                          hint="another writer holds the lock; stop analysis jobs "
                               "or restart the backend")
        return _check("database_write", False, f"write failed: {msg}")
    except sqlite3.Error as exc:
        return _check("database_write", False, f"write failed: {exc}")
    finally:
        con.close()


def _make_probe_video(dest: Path) -> str:
    """Create a tiny real MP4 so decode paths are exercised for real."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        try:
            proc = subprocess.run(
                [ffmpeg, "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=160x120:rate=10",
                 "-pix_fmt", "yuv420p", str(dest)],
                capture_output=True, text=True, timeout=120)
            if proc.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
                return "ffmpeg lavfi testsrc"
        except (OSError, subprocess.SubprocessError):
            pass
    dest.write_bytes(b"\x00" * 4096)
    return "placeholder (ffmpeg unavailable)"


def _check_engine(probe: Path) -> List[Dict[str, Any]]:
    """Verify olive-p/OpenCV can import and decode a video."""
    from .analyzer import OliveAnalyzer

    out: List[Dict[str, Any]] = []
    try:
        OliveAnalyzer()
        out.append(_check("olive_p_import", True, "olive-p runtime importable"))
    except Exception as exc:
        out.append(_check("olive_p_import", False,
                          f"{type(exc).__name__}: {exc}",
                          hint="the detection engine is missing or broken; "
                               "video upload itself may still work"))
        return out

    try:
        analyzer = OliveAnalyzer()
        info = analyzer.video_info(str(probe))
        ok = isinstance(info, dict) and info.get("frame_count")
        out.append(_check("video_decode", bool(ok),
                          f"decoded {info.get('width')}x{info.get('height')} "
                          f"{info.get('frame_count')} frames "
                          f"{info.get('fps')} fps" if ok else f"empty info: {info}",
                          fatal=False,
                          hint="metadata read failed; upload still succeeds without it"))
    except Exception as exc:
        out.append(_check("video_decode", False,
                          f"{type(exc).__name__}: {exc}", fatal=False,
                          hint="OpenCV could not open the probe video"))
    return out


def _check_capture_time(probe: Path) -> Dict[str, Any]:
    """extract_captured_at() must never raise (it runs unguarded on upload)."""
    from .captured import extract_captured_at
    try:
        return _check("capture_time", True,
                      f"ok -> {extract_captured_at(probe)!r}", fatal=False)
    except Exception as exc:
        return _check("capture_time", False,
                      f"raised {type(exc).__name__}: {exc}",
                      hint="this exception would fail every upload with a 500")


def _check_pipeline_roundtrip(probe: Path, user: Optional[dict]) -> Dict[str, Any]:
    """Run the real save + register path end to end, then undo it."""
    from .storage import Store

    store = Store(DB_PATH, initialize_schema=False)
    dest = UPLOAD_DIR / ("_diagnose_probe%s" % (probe.suffix or ".mp4"))
    video_id = None
    try:
        data = probe.read_bytes()
        with dest.open("wb") as fh:
            fh.write(data)
        if dest.stat().st_size != len(data):
            return _check("upload_roundtrip", False,
                          f"wrote {dest.stat().st_size} of {len(data)} bytes")
        video_id = store.add_video("_diagnose_probe", str(dest), len(data),
                                  user_id=(user or {}).get("id"),
                                  recorded_at=None)
        return _check("upload_roundtrip", True,
                      f"wrote and registered {len(data)} bytes (video id {video_id})")
    except Exception as exc:
        return _check("upload_roundtrip", False,
                      f"{type(exc).__name__}: {exc}",
                      hint="this is the stage that turns into the 500 you saw")
    finally:
        if video_id is not None:
            try:
                store.delete_video(video_id)
            except Exception:
                pass
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass


def _check_limits() -> Dict[str, Any]:
    """Surface the values that govern whether a large body is accepted."""
    return _check("size_limit", True,
                  f"MAX_UPLOAD_MB={MAX_UPLOAD_MB} "
                  f"(~{MAX_UPLOAD_MB * 1024 * 1024 // (1024 * 1024)} MB), "
                  f"frontend upload timeout=120s", fatal=False)


def diagnose_upload(user: Optional[dict] = None) -> Dict[str, Any]:
    """Run every upload-stage check and summarise the outcome."""
    checks: List[Dict[str, Any]] = []
    checks.append(_probe_dir("uploads_dir", UPLOAD_DIR, required=True))
    checks.append(_probe_dir("multipart_spool_dir", Path(tempfile.gettempdir()),
                             required=True))
    checks.append(_check_db_writable())
    checks.append(_check_ffprobe())
    checks.append(_check_limits())

    probe = UPLOAD_DIR / "_diagnose_source.mp4"
    made_by = "none"
    try:
        made_by = _make_probe_video(probe)
        checks.append(_check("probe_video", probe.exists() and probe.stat().st_size > 0,
                             f"{made_by}, {probe.stat().st_size} bytes", fatal=False))
        checks.extend(_check_engine(probe))
        checks.append(_check_capture_time(probe))
        checks.append(_check_pipeline_roundtrip(probe, user))
    finally:
        try:
            probe.unlink(missing_ok=True)
        except OSError:
            pass

    failures = [c for c in checks if c["fatal"] and not c["ok"]]
    warnings = [c for c in checks if not c["fatal"] and not c["ok"]]
    return {
        "ok": not failures,
        "checked_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "failures": len(failures),
        "warnings": len(warnings),
        "first_failure": failures[0]["name"] if failures else None,
        "checks": checks,
    }


def render_report(result: Dict[str, Any]) -> str:
    """Plain-text report, deliberately free of colour codes and log jargon."""
    lines = []
    lines.append("=" * 68)
    lines.append("  olive-msystem  upload diagnosis")
    lines.append("=" * 68)
    lines.append("")
    for c in result["checks"]:
        mark = "OK  " if c["ok"] else ("FAIL" if c["fatal"] else "WARN")
        lines.append("[%s] %-22s %s" % (mark, c["name"], c["detail"]))
        if not c["ok"] and c["hint"]:
            lines.append("       -> %s" % c["hint"])
    lines.append("")
    if result["ok"]:
        lines.append("RESULT: all upload stages pass.")
        if result["warnings"]:
            lines.append("        %d non-fatal warning(s) above." % result["warnings"])
        lines.append("        If uploads still fail, the cause is outside these")
        lines.append("        stages: check the reverse proxy / client timeout.")
    else:
        first = result["first_failure"]
        lines.append("RESULT: FAILED at stage '%s'." % first)
        lines.append("        That is the stage producing the 500.")
    lines.append("")
    return "\n".join(lines)