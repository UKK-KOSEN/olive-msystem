#!/usr/bin/env python3
"""olive-msystem environment check / bootstrap for start.bat / start.sh.

Ensures the backend venv and frontend node_modules exist (creating them is the
responsibility of the launcher), verifies prerequisite tools (git / python /
node / npm / ffmpeg) and the detection engine (olive-p) with its optional
upscale tooling, and reports a friendly per-item status. Works on Windows and
Linux. Run from the repository root.

Usage:
    python ops/check_env.py            # verify only, no side effects
    python ops/check_env.py --quiet    # machine-readable-ish summary
Exit code: 0 if everything required is ready, 1 if anything is missing.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
CONFIG = BACKEND / "config"

IS_WINDOWS = os.name == "nt"
VENV_PY = BACKEND / ".venv" / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")

MAX_WIDTH = 70


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quiet", action="store_true",
                        help="suppress descriptions, status line only")
    args = parser.parse_args()

    ok, warn, fail = [], [], []

    def report(name: str, status: str, detail: str = "") -> None:
        if args.quiet:
            print(f"{status:>8}  {name}")
        else:
            print(f"[{'OK' if status == 'ok' else 'WARN' if status == 'warn' else 'FAIL':^5}] {name}")
            if detail:
                print(f"        {detail}")

    # ---- 1. prerequisite tools (git / python / node / npm / ffmpeg) ----
    git = shutil.which("git")
    if git:
        ok.append("git"); report("git", "ok", git)
    else:
        fail.append("git")
        report("git", "fail", "start.bat can install it via winget, or install manually")

    py_candidates = (["py", "python"] if IS_WINDOWS else ["python3", "python"])
    system_py = next((shutil.which(c) for c in py_candidates if shutil.which(c)), "")
    if system_py:
        ok.append("python"); report("python", "ok", system_py)
    else:
        fail.append("python")
        hint = ("start.bat can install it via winget, or install from python.org"
                if IS_WINDOWS else "apt-get install -y python3 python3-venv python3-pip")
        report("python", "fail", hint)

    node = shutil.which("node")
    if node:
        ok.append("node"); report("node.js", "ok", node)
    else:
        fail.append("node")
        hint = ("start.bat can install Node via winget"
                if IS_WINDOWS else "install Node.js 20+ (NodeSource setup_20.x)")
        report("node.js", "fail", hint)

    npm = shutil.which("npm")
    if npm:
        ok.append("npm"); report("npm", "ok", npm)
    else:
        fail.append("npm")
        report("npm", "fail", "bundled with Node.js; if node exists npm should too")

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        ok.append("ffmpeg"); report("ffmpeg", "ok", ffmpeg)
    else:
        warn.append("ffmpeg")
        report("ffmpeg", "warn",
               "start.bat/start.sh can install it; without it video GPU muxing (av1_amf) is skipped")

    # ---- 2. Python / backend venv ----
    if VENV_PY.exists():
        ok.append("backend-venv"); report("backend .venv", "ok", str(VENV_PY))
    else:
        fail.append("backend-venv")
        report("backend .venv", "fail", "run start.bat / start.sh first (creates .venv + pip install)")

    # ---- 3. frontend node_modules / build ----
    if (FRONTEND / "node_modules").exists():
        ok.append("node_modules"); report("frontend node_modules", "ok")
    else:
        fail.append("node_modules")
        report("frontend node_modules", "fail", "run start.bat / start.sh first (runs npm install)")

    build_id = FRONTEND / ".next" / "BUILD_ID"
    if build_id.exists():
        ok.append("next-build"); report("frontend build (.next)", "ok")
    else:
        # stale builds are rebuilt by `npm run build`; informing is enough here
        warn.append("next-build-stale")
        report("frontend build (.next)", "warn",
               "no build yet - launcher will run `npm run build`")

    # ---- 4. detection engine (olive-p) ----
    sys.path.insert(0, str(BACKEND))
    from app.config import OLIVE_P_DIR  # type: ignore

    if OLIVE_P_DIR.is_dir():
        runtime = OLIVE_P_DIR / "src" / "runtime.py"
        video = OLIVE_P_DIR / "src" / "video_processor.py"
        if runtime.exists() and video.exists():
            ok.append("olive-p")
            report("detection engine (olive-p)", "ok", str(OLIVE_P_DIR))
            report("  Analyzer runtime", "ok")
            report("  VideoProcessor", "ok")
        else:
            fail.append("olive-p-modules")
            report("detection engine (olive-p)", "fail",
                   f"{OLIVE_P_DIR} exists but src/runtime.py or src/video_processor.py missing")
    else:
        # OLIVE_P_DIR exists as a Path; if missing the app can still boot but
        # analysis will raise a useful error at request time.
        fail.append("olive-p")
        report("detection engine (olive-p)", "fail",
               f"'{OLIVE_P_DIR}' not found; run start.bat / start.sh (clones olive-p to "
               "external/olive-p) or set OLIVE_P_DIR")

    # ---- 5. upscale tooling (optional) ----
    upscale_dir = OLIVE_P_DIR / "tools" / "realesrgan-ncnn-vulkan"
    exe = upscale_dir / ("realesrgan-ncnn-vulkan.exe" if IS_WINDOWS
                         else "realesrgan-ncnn-vulkan")
    if exe.exists():
        ok.append("realesrgan")
        report("upscaler (realesrgan-ncnn-vulkan)", "ok", str(exe))
    else:
        model_dir = OLIVE_P_DIR / "models"
        if (model_dir / "realesrgan-x4plus.param").exists():
            report("upscaler model", "ok",
                   "realesrgan-x4plus found in olive-p/models (used via python)")

    # ---- 6. config files ----
    for name in ("settings.json", "soil_moisture.yaml"):
        if (CONFIG / name).exists():
            ok.append(name)
        else:
            warn.append(name)
            report(f"config/{name}", "warn", "managed at runtime / by admin UI")

    print()
    print("=" * MAX_WIDTH)
    print(f"  OK: {len(ok)}   WARN: {len(warn)}   FAIL: {len(fail)}")
    if fail:
        print("  RESULT: NOT READY - fix the FAIL items, then re-run the launcher")
        print("=" * MAX_WIDTH)
        return 1
    if warn:
        print("  RESULT: ready (with warnings) - will still start fine")
        print("=" * MAX_WIDTH)
        return 0
    print("  RESULT: ready")
    print("=" * MAX_WIDTH)
    return 0


if __name__ == "__main__":
    sys.exit(main())