#!/bin/bash
# ContinueMySong AI — Start both backend and frontend servers
# Usage: ./start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🎵 Starting ContinueMySong AI...${NC}"

# Bind to 0.0.0.0 for WSL/Docker accessibility (override with HOST env var)
export HOST="${HOST:-0.0.0.0}"

# Check if backend venv exists
if [ ! -d "$BACKEND_DIR/venv" ]; then
  echo -e "${YELLOW}Creating Python virtual environment...${NC}"
  python3 -m venv "$BACKEND_DIR/venv"
  source "$BACKEND_DIR/venv/bin/activate"
  pip install -r "$BACKEND_DIR/requirements.txt" --quiet
else
  source "$BACKEND_DIR/venv/bin/activate"
fi

# Check if frontend node_modules exist
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo -e "${YELLOW}Installing frontend dependencies...${NC}"
  cd "$FRONTEND_DIR" && npm install
fi

# Kill any existing processes on ports 8000 and 3000
kill $(lsof -t -i:8000 2>/dev/null) 2>/dev/null || true
kill $(lsof -t -i:3000 2>/dev/null) 2>/dev/null || true
sleep 1

# Start backend
echo -e "${GREEN}▶ Starting backend on http://localhost:8000${NC}"
cd "$BACKEND_DIR"
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Start frontend
echo -e "${GREEN}▶ Starting frontend on http://localhost:3000${NC}"
cd "$FRONTEND_DIR"
npx next dev --hostname 0.0.0.0 --port 3000 &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}✅ Both servers starting!${NC}"
echo -e "   Backend:  http://localhost:8000"
echo -e "   Frontend: http://localhost:3000"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop both servers${NC}"

# Trap Ctrl+C to kill both
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

# Wait for both
wait
