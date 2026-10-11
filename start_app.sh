#!/bin/bash

# Jarvis Local — start the FastAPI backend and the Vite frontend.
# Ports come from .env (defaults: backend 8040, frontend 3040). Ctrl+C stops both.

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$PROJECT_ROOT/logs"
VENV="$PROJECT_ROOT/venv"
REQUIREMENTS="$PROJECT_ROOT/backend/requirements.txt"
# Kokoro (TTS) needs Python < 3.13; the default python3 here is too old.
PYTHON=${PYTHON:-python3.12}

if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a; source "$PROJECT_ROOT/.env"; set +a
fi
BACKEND_PORT=${BACKEND_PORT:-8040}
FRONTEND_PORT=${FRONTEND_PORT:-3040}
mkdir -p "$LOGS_DIR"

info() { echo -e "\033[0;34m[INFO]\033[0m $1"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $1"; }

kill_port() {
    local pid
    pid=$(lsof -ti:"$1" 2>/dev/null || true)
    if [ -n "$pid" ]; then warn "Freeing port $1 (PID $pid)"; kill -9 $pid 2>/dev/null || true; sleep 1; fi
}

cleanup() {
    info "Shutting down..."
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
    kill_port "$BACKEND_PORT"; kill_port "$FRONTEND_PORT"
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# --- setup: the venv is (re)installed whenever requirements.txt changes ---
if [ ! -d "$VENV" ]; then
    warn "Creating venv with $PYTHON..."
    "$PYTHON" -m venv "$VENV"
fi
if [ ! -f "$VENV/.requirements" ] || ! cmp -s "$REQUIREMENTS" "$VENV/.requirements"; then
    warn "Installing backend packages..."
    "$VENV/bin/pip" install -q -r "$REQUIREMENTS"
    cp "$REQUIREMENTS" "$VENV/.requirements"
fi
if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
    warn "Installing frontend packages..."
    (cd "$PROJECT_ROOT/frontend" && npm install --silent)
fi

kill_port "$BACKEND_PORT"; kill_port "$FRONTEND_PORT"

info "Backend  → http://127.0.0.1:$BACKEND_PORT"
(cd "$PROJECT_ROOT/backend" && "$VENV/bin/uvicorn" src.main:app \
    --host 127.0.0.1 --port "$BACKEND_PORT" --reload --reload-dir src) 2>&1 | tee "$LOGS_DIR/backend.log" &
BACKEND_PID=$!

info "Frontend → http://localhost:$FRONTEND_PORT"
(cd "$PROJECT_ROOT/frontend" && npx vite --port "$FRONTEND_PORT") 2>&1 | tee "$LOGS_DIR/frontend.log" &
FRONTEND_PID=$!

wait
