#!/usr/bin/env bash
# Dừng toàn bộ CMS (Docker full stack + backend native).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/logs/backend.pid"

echo "Dừng container Docker..."
docker stop jablotron-cms-backend jablotron-cms-frontend 2>/dev/null || true
docker compose -f "$ROOT/docker-compose.yml" down --remove-orphans 2>/dev/null || true
docker compose -f "$ROOT/docker-compose.usb-host.yml" down --remove-orphans 2>/dev/null || true
docker compose -f "$ROOT/docker-compose.usb-host.linux.yml" down --remove-orphans 2>/dev/null || true

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi
pkill -f "uvicorn app.main:app --host 0.0.0.0 --port 8010" 2>/dev/null || true
pkill -f "uvicorn app.main:app --host 0.0.0.0 --port 8000" 2>/dev/null || true

echo "Đã dừng."
