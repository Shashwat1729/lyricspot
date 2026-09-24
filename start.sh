#!/usr/bin/env bash
# LyricSpot — start backend (http://localhost:8000) and frontend (http://localhost:3000).
# Usage: ./start.sh            full install (voice needs ffmpeg + Whisper)
#        ./start.sh --text     text search only (fast install, no torch)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
REQS="requirements.txt"
[ "${1:-}" = "--text" ] && REQS="requirements-core.txt"

if [ ! -d "$BACKEND/venv" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "$BACKEND/venv"
fi
# shellcheck disable=SC1091
source "$BACKEND/venv/bin/activate"
if [ "$REQS" = "requirements.txt" ]; then
  pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu || true
fi
pip install --quiet -r "$BACKEND/$REQS"
command -v ffmpeg >/dev/null || echo "Note: ffmpeg not found — voice input stays disabled (text search works)."

[ -d "$FRONTEND/node_modules" ] || (cd "$FRONTEND" && npm install)

(cd "$BACKEND" && uvicorn main:app --host "${HOST:-127.0.0.1}" --port 8000) &
BACKEND_PID=$!
(cd "$FRONTEND" && npx next dev --hostname "${HOST:-127.0.0.1}" --port 3000) &
FRONTEND_PID=$!
trap 'echo; echo "Stopping..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0' INT TERM

echo
echo "  Backend:  http://localhost:8000/health"
echo "  Frontend: http://localhost:3000"
echo "  Ctrl+C stops both."
wait
