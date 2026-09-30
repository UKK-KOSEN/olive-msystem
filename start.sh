#!/usr/bin/env bash
# ================================================================
#  olive-msystem - Linux launcher (mirror of start.bat)
#  Bootstraps everything a fresh checkout needs and starts the
#  backend/frontend watchdog processes:
#    - prerequisite tools (git / python3 / node / npm / ffmpeg,
#      auto-installed via apt + NodeSource when missing)
#    - Python venv       (backend/.venv, auto-created)
#    - backend deps      (pip install -r backend/requirements.txt)
#    - olive-p engine    (cloned to external/olive-p on first run
#                         unless OLIVE_P_DIR/env or an existing
#                         checkout is found)
#    - frontend deps     (npm install when node_modules is missing)
#    - frontend build    (npm run build when .next/BUILD_ID missing)
#    - detection engine  (olive-p / upscaler / ffmpeg health check)
#
#  Usage:
#    ./start.sh                full setup + watchdogs (recommended)
#    ./start.sh check          verify environment, do not start daemons
#    ./start.sh backend        setup + run backend in foreground
#    ./start.sh frontend       setup + run frontend in foreground
# ================================================================

set -u
cd "$(dirname "$0")"

BACKEND_PORT="${BACKEND_PORT:-8000}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
VENV_PY=backend/.venv/bin/python
EXTERNAL_OLIVE_P=external/olive-p

echo "================================================================"
echo "  olive-msystem launcher (Linux) - watchdog + detection engine"
echo "  Backend  (FastAPI)  : http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "  Frontend (Next.js)  : http://localhost:${FRONTEND_PORT}"
echo "  Duplicate-start guard + auto-restart enabled"
echo "================================================================"
echo

# ----------------------------------------------------------------
# 0. prerequisite tools (git / python3 / node / npm / ffmpeg)
# ----------------------------------------------------------------
NEED_MISSING=0
for tool in git python3 node npm ffmpeg; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "[OK]   ${tool}: found"
  else
    echo "[WARN] ${tool}: missing"
    NEED_MISSING=1
  fi
done

if [ "$NEED_MISSING" -eq 1 ]; then
  echo
  echo "[SETUP] Installing missing prerequisites via apt..."
  apt_cmd() {
    if [ "$(id -u)" -eq 0 ]; then apt-get "$@"
    elif command -v sudo >/dev/null 2>&1; then sudo -E apt-get "$@"
    else
      echo "[ERROR] Not root and no sudo available; cannot install packages."
      echo "        Run this script as root or with sudo, or install the missing tools yourself."
      exit 1
    fi
  }
  apt_cmd update || { echo "[ERROR] apt-get update failed."; exit 1; }
  apt_cmd install -y --no-install-recommends \
    git python3 python3-venv python3-pip ffmpeg curl ca-certificates \
    || { echo "[ERROR] apt-get install failed."; exit 1; }

  # Node.js >= 18.18 is required (Next.js 15). Ubuntu 22.04 apt ships node 12,
  # so install a current LTS from NodeSource when node/npm are missing or old.
  NODE_MAJOR=0
  if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node --version | sed -E 's/v([0-9]+)\..*/\1/')"
  fi
  if ! command -v npm >/dev/null 2>&1 || [ "$NODE_MAJOR" -lt 18 ]; then
    echo "[SETUP] Installing Node.js LTS via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh \
      || { echo "[ERROR] Could not download NodeSource setup script."; exit 1; }
    if [ "$(id -u)" -eq 0 ]; then
      bash /tmp/nodesource_setup.sh || { echo "[ERROR] NodeSource setup failed."; exit 1; }
    else
      sudo -E bash /tmp/nodesource_setup.sh || { echo "[ERROR] NodeSource setup failed."; exit 1; }
    fi
    apt_cmd install -y nodejs || { echo "[ERROR] nodejs install failed."; exit 1; }
  fi

  echo "[OK]   Prerequisites installed."
  rm -f /tmp/nodesource_setup.sh
fi

# ----------------------------------------------------------------
# 1. detection engine (olive-p) source
# ----------------------------------------------------------------
if [ -n "${OLIVE_P_DIR:-}" ]; then
  echo "[OK]   OLIVE_P_DIR set: ${OLIVE_P_DIR}"
elif [ -f "$EXTERNAL_OLIVE_P/src/runtime.py" ]; then
  echo "[OK]   Detection engine found: $EXTERNAL_OLIVE_P"
elif [ -d "$HOME/Downloads/olive-p" ] && [ -f "$HOME/Downloads/olive-p/src/runtime.py" ]; then
  echo "[OK]   Detection engine found (existing checkout): $HOME/Downloads/olive-p"
else
  echo "[SETUP] olive-p not found under external/olive-p. Fetching detection engine..."
  command -v git >/dev/null 2>&1 || { echo "[ERROR] git is required to clone olive-p."; exit 1; }
  mkdir -p external
  git clone --depth 1 https://github.com/UKK-KOSEN/olive-vision-ai.git "$EXTERNAL_OLIVE_P" \
    || { echo "[ERROR] Failed to clone olive-p. Check network, or set OLIVE_P_DIR."; exit 1; }
  echo "[OK]   Detection engine cloned: $EXTERNAL_OLIVE_P"
fi

# ----------------------------------------------------------------
# 2. Python venv (create when missing) + backend deps
# ----------------------------------------------------------------
if [ ! -f "$VENV_PY" ]; then
  echo "[SETUP] Creating Python venv..."
  python3 -m venv backend/.venv || { echo "[ERROR] venv creation failed."; exit 1; }
else
  echo "[OK]   Python venv found: $VENV_PY"
fi
echo "[SETUP] Ensuring backend Python deps are up to date..."
"$VENV_PY" -m pip install --disable-pip-version-check -r backend/requirements.txt \
  || { echo "[ERROR] pip install failed."; exit 1; }
echo "[OK]   Backend deps ready."

# ----------------------------------------------------------------
# 3. frontend node_modules (install when missing)
# ----------------------------------------------------------------
if [ ! -d "frontend/node_modules" ]; then
  echo "[SETUP] npm install frontend deps..."
  ( cd frontend && npm install ) || { echo "[ERROR] npm install failed."; exit 1; }
else
  echo "[OK]   node_modules found."
fi

# ----------------------------------------------------------------
# 4. frontend build (.next), skipped when running backend only
# ----------------------------------------------------------------
if [ "${1:-}" != "backend" ] && [ ! -f "frontend/.next/BUILD_ID" ]; then
  echo "[SETUP] Building frontend via npm run build..."
  ( cd frontend && npm run build ) || { echo "[ERROR] Frontend build failed."; exit 1; }
elif [ -f "frontend/.next/BUILD_ID" ]; then
  echo "[OK]   Frontend build .next found."
fi

# ----------------------------------------------------------------
# 5. detection engine check (olive-p / upscaler / ffmpeg)
# ----------------------------------------------------------------
echo
echo "[CHECK] Detection engine (olive-p / upscaler / ffmpeg)..."
if ! "$VENV_PY" ops/check_env.py; then
  echo
  echo "[WARN] One or more checks reported problems. See the list above."
fi

# ----------------------------------------------------------------
# 6. route modes
# ----------------------------------------------------------------
case "${1:-}" in
  check)
    echo "[CHECK-DONE] Environment and detection engine checked. No daemon started."
    exit 0 ;;
  backend)
    cd backend
    exec ./.venv/bin/python -m uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" ;;
  frontend)
    cd frontend
    export BACKEND_URL
    exec npm run start -- -p "$FRONTEND_PORT" ;;
  *)
    echo "[START] Backend watchdog ..."
    nohup ./run_backend.sh >/dev/null 2>&1 &
    echo "[START] Frontend watchdog ..."
    nohup ./run_frontend.sh >/dev/null 2>&1 &
    echo
    echo "Open http://localhost:${FRONTEND_PORT} in your browser."
    echo "Logs: logs/backend-uvicorn.log, logs/frontend.log"
    echo "Stop: kill the run_backend.sh / run_frontend.sh watchdog processes."
    exit 0 ;;
esac