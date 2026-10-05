"""Print an upload diagnosis for this olive-msystem installation.

Run it on the machine that serves uploads:

    cd backend && ./.venv/bin/python tools/diagnose_upload.py

It exercises every stage of the upload path (disk, multipart spool dir,
database writer lock, ffprobe, olive-p/OpenCV, capture-time parsing and the
save+register round trip) and reports which one fails, so the cause of a 500
does not have to be read out of a log file.

Exit code is 0 when every stage passes, 1 otherwise.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.upload_diagnostics import diagnose_upload, render_report  # noqa: E402


def main() -> int:
    try:
        result = diagnose_upload()
    except Exception as exc:  # a diagnostic must still produce output
        print("diagnosis could not complete: %s: %s" % (type(exc).__name__, exc))
        return 1
    print(render_report(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())