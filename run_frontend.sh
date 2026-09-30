#!/usr/bin/env bash
# ================================================================
#  olive-msystem - Frontend watchdog for Linux (auto-restart)
#  Runs Next.js on FRONTEND_PORT (default 3001). On crash it
#  restarts with exponential backoff (same policy as backend). The
#  duplicate guard (port already listening) prevents double startup.
# ================================================================

set -u
cd "$(dirname "$0")"

FRONTEND_PORT="${FRONTEND_PORT:-3001}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT:-8000}}"

if [ ! -d "frontend/node_modules" ]; then
  echo "[watchdog] [ERROR] frontend/node_modules not found."
  echo "[watchdog] Run ./start.sh once to install dependencies, then re-run this."
  exit 1
fi
if [ ! -f "frontend/.next/BUILD_ID" ]; then
  echo "[watchdog] [ERROR] frontend/.next/BUILD_ID not found."
  echo "[watchdog] Run \"npm run build\" in frontend/ or re-run ./start.sh."
  exit 1
fi

mkdir -p logs

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -tln | grep -q ":${FRONTEND_PORT} "
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tln 2>/dev/null | grep -q ":${FRONTEND_PORT} "
  else
    return 1
  fi
}

ATTEMPT=0
RESTARTS=0
export BACKEND_URL

while true; do
  if port_in_use; then
    echo "[watchdog] Frontend already running on port $FRONTEND_PORT. Only monitoring..."
    sleep 5
    continue
  fi

  ATTEMPT=$((ATTEMPT + 1))
  RESTARTS=$((RESTARTS + 1))
  START=$(date +%s)
  echo "[watchdog] Starting frontend (Next.js on $FRONTEND_PORT) [attempt $ATTEMPT]..."
  (
    cd frontend || exit 1
    exec npm run start -- -p "$FRONTEND_PORT"
  ) >> logs/frontend.log 2>&1
  EXIT_CODE=$?

  ELAPSED=$(( $(date +%s) - START ))
  echo "[watchdog] Frontend exited (code $EXIT_CODE, lived ${ELAPSED}s). Restarting..."

  DELAY=3
  if [ "$ELAPSED" -lt 10 ]; then
    DELAY=$((2 + RESTARTS * 2))
  else
    RESTARTS=0
  fi
  [ "$DELAY" -gt 30 ] && DELAY=30
  if [ "$RESTARTS" -ge 15 ]; then
    echo "[watchdog] Frontend has crashed $RESTARTS times right after boot."
    echo "[watchdog] Check logs/frontend.log. Waiting 60s before retry."
    DELAY=60
  fi
  echo "[watchdog] Waiting ${DELAY}s before retry..."
  sleep "$DELAY"
done