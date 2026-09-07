"""Best-effort capture-time extraction for uploaded media.

The frontend sends the file's ``lastModified`` as ``captured_at`` (epoch ms).
That is the most reliable signal (it is the creation time of the photo/video
on the device). As a fallback we try to read the JPEG EXIF ``DateTimeOriginal``
/ ``DateTime`` tag directly (no Pillow dependency needed). Video files are left
as ``None`` unless ffprobe is available on PATH.
"""
from __future__ import annotations

import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional


def parse_captured_candidate(value) -> Optional[str]:
    """Accept a client-provided capture time.

    Supports ISO-8601 strings and epoch milliseconds (JS ``Date`` timestamps).
    Returns a local-timezone ISO string, or None when unrecognised.
    """
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip()
    try:
        if text.replace("-", "").replace(".", "").isdigit():
            ms = float(text)
            sec = ms / 1000.0 if ms > 1e12 else ms
            return datetime.fromtimestamp(sec).astimezone().isoformat(timespec="seconds")
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.astimezone()
        return dt.astimezone().isoformat(timespec="seconds")
    except (TypeError, ValueError, OSError):
        return None


def extract_captured_at(path) -> Optional[str]:
    """Try to read the capture time embedded in the media file itself."""
    p = Path(path)
    if not p.exists() or p.stat().st_size == 0:
        return None
    ext = p.suffix.lower()
    if ext in {".jpg", ".jpeg", ".tif", ".tiff"}:
        return _jpeg_exif_datetime(p)
    if ext in {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}:
        return _ffprobe_creation_time(p)
    return None


def _jpeg_exif_datetime(path: Path) -> Optional[str]:
    """Parse DateTimeOriginal (0x9003) / DateTime (0x0132) from JPEG EXIF."""
    try:
        data = path.read_bytes()[:262144]  # APP1 lives near the start
    except OSError:
        return None
    pos = 2
    n = len(data)
    while pos + 4 <= n:
        if data[pos] != 0xFF:
            pos += 1
            continue
        marker = data[pos + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            pos += 2
            continue
        if marker == 0xDA:  # start of scan: no more metadata
            return None
        if pos + 4 > n:
            return None
        seg_len = int.from_bytes(data[pos + 2:pos + 4], "big")
        seg_end = pos + 2 + seg_len
        if marker == 0xE1 and seg_end <= n:
            blob = data[pos + 4:seg_end]
            xy = _exif_datetime_from_tiff(blob)
            if xy:
                return _format_exif(xy)
        pos = seg_end
    return None


def _exif_datetime_from_tiff(blob: bytes) -> Optional[str]:
    """Given the TIFF/EXIF payload (after 'Exif\\0\\0'), find the date tags."""
    if len(blob) < 8 or blob[:6] != b"Exif\x00\x00":
        return None
    tiff = blob[6:]
    if len(tiff) < 8:
        return None
    order = "little" if tiff[:2] in (b"II",) else "big"
    ifd_off = int.from_bytes(tiff[4:8], order)
    return _tiff_date_from_ifd(tiff, ifd_off, order)


def _tiff_date_from_ifd(tiff: bytes, ifd_off: int, order: str) -> Optional[str]:
    result = None
    seen = set()
    while ifd_off > 0 and ifd_off < len(tiff) and ifd_off not in seen and len(seen) < 8:
        seen.add(ifd_off)
        if ifd_off + 2 > len(tiff):
            break
        count = int.from_bytes(tiff[ifd_off:ifd_off + 2], order)
        entries = tiff[ifd_off + 2:ifd_off + 2 + count * 12]
        for i in range(count):
            ent = entries[i * 12:(i + 1) * 12]
            if len(ent) < 12:
                continue
            tag = int.from_bytes(ent[0:2], order)
            typ = int.from_bytes(ent[2:4], order)
            if tag in (0x9003, 0x0132) and typ == 2:
                n = int.from_bytes(ent[4:8], order)
                val_off = int.from_bytes(ent[8:12], order)
                if val_off < len(tiff):
                    try:
                        s = tiff[val_off:val_off + n].split(b"\x00", 1)[0].decode("ascii", errors="replace").strip()
                    except Exception:
                        continue
                    if len(s) >= 19:
                        if tag == 0x9003:
                            return s[:19]
                        if result is None:
                            result = s[:19]
        if ifd_off + 2 < len(tiff):
            off = ifd_off + 2 + count * 12
            if off + 4 <= len(tiff):
                ifd_off = int.from_bytes(tiff[off:off + 4], order)
            else:
                break
        else:
            break
    return result


def _format_exif(value: str) -> str:
    """'YYYY:MM:DD HH:MM:SS' -> local ISO 'YYYY-MM-DDTHH:MM:SS'."""
    try:
        dt = datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
        return dt.astimezone().isoformat(timespec="seconds")
    except ValueError:
        return value


def _ffprobe_creation_time(path: Path) -> Optional[str]:
    if not shutil.which("ffprobe"):
        return None
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format_tags=creation_time", "-of", "default=noprint_wrappers=1:nokey=1",
             str(path)],
            capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    text = (proc.stdout or "").strip()
    if not text:
        return None
    return parse_captured_candidate(text)