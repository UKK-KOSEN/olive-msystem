#!/usr/bin/env bash
# ================================================================
#  olive-msystem - Backend watchdog for Linux (auto-restart)
#  Runs uvicorn on BACKEND_PORT (default 8000). On crash it restarts
#  with exponential backoff; a crash-loop (<10s lifetime) backs off
#  further, a healthy long run resets the counter. The duplicate
#  guard (port already listening) prevents double startup.
# ================================================================

set -u
cd "$(dirname "$0")"

if [ -n "${PORT:-}" ] && [ -z "${BACKEND_PORT:-}" ]; then BACKEND_PORT="$PORT"; fi
if [ -n "${HOST:-}" ] && [ -z "${BACKEND_HOST:-}" ]; then BACKEND_HOST="$HOST"; fi
BACKEND_PORT="${BACKEND_PORT:-8000}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"

if [ ! -f "backend/.venv/bin/python" ]; then
  echo "[watchdog] [ERROR] backend/.venv/bin/python not found."
  echo "[watchdog] Run ./start.sh once to create the venv, then re-run this."
  exit 1
fi

mkdir -p logs

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -tln | grep -q ":${BACKEND_PORT} "
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tln 2>/dev/null | grep -q ":${BACKEND_PORT} "
  else
    return 1
  fi
}

ATTEMPT=0
RESTARTS=0

while true; do
  if port_in_use; then
    echo "[watchdog] Backend already running on port $BACKEND_PORT. Only monitoring..."
    sleep 5
    continue
  fi

  ATTEMPT=$((ATTEMPT + 1))
  RESTARTS=$((RESTARTS + 1))
  START=$(date +%s)
  echo "[watchdog] Starting backend (uvicorn on $BACKEND_PORT) [attempt $ATTEMPT]..."
  (
    cd backend || exit 1
    exec ./.venv/bin/python -m uvicorn app.main:app \
      --host "$BACKEND_HOST" --port "$BACKEND_PORT"
  ) >> logs/backend-uvicorn.log 2>&1
  EXIT_CODE=$?

  ELAPSED=$(( $(date +%s) - START ))
  echo "[watchdog] Backend exited (code $EXIT_CODE, lived ${ELAPSED}s). Restarting..."

  DELAY=3
  if [ "$ELAPSED" -lt 10 ]; then
    DELAY=$((2 + RESTARTS * 2))
  else
    RESTARTS=0
  fi
  [ "$DELAY" -gt 30 ] && DELAY=30
  if [ "$RESTARTS" -ge 15 ]; then
    echo "[watchdog] Backend has crashed $RESTARTS times right after boot."
    echo "[watchdog] Check logs/backend-uvicorn.log. Waiting 60s before retry."
    DELAY=60
  fi
  echo "[watchdog] Waiting ${DELAY}s before retry..."
  sleep "$DELAY"
done