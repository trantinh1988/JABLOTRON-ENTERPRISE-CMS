#!/usr/bin/env bash
# Khởi động CMS USB trên Linux (autostart systemd --user / trang Hệ thống).
# Không rebuild Docker, không bắt buộc USB đã cắm, không dừng stack nếu đang chạy.
# Chạy: ./scripts/start-cms-linux.sh

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
LOG_DIR="$ROOT/logs"
PID_FILE="$LOG_DIR/backend.pid"
DATA_DIR="$BACKEND/data"
KEYS="$ROOT/keys/public_key.pem"
CMS_BACKEND_PORT="${CMS_BACKEND_PORT:-8010}"
CMS_UI_PORT="${CMS_UI_PORT:-8080}"
COMPOSE_FILE="$ROOT/docker-compose.usb-host.linux.yml"

cd "$ROOT"
mkdir -p "$LOG_DIR" "$DATA_DIR"

if [[ -f "$DATA_DIR/host_ports.json" ]]; then
  # shellcheck disable=SC2002
  _ui="$(python3 -c "import json; p=json.load(open('$DATA_DIR/host_ports.json')); print(p.get('ui_port') or '')" 2>/dev/null || true)"
  _api="$(python3 -c "import json; p=json.load(open('$DATA_DIR/host_ports.json')); print(p.get('api_port') or '')" 2>/dev/null || true)"
  [[ -n "${_ui:-}" ]] && CMS_UI_PORT="$_ui"
  [[ -n "${_api:-}" ]] && CMS_BACKEND_PORT="$_api"
fi
export CMS_UI_PORT CMS_BACKEND_PORT
# Docker tạo nginx-ui.conf thành thư mục nếu file gitignore chưa có trên host.
if [[ -d "$DATA_DIR/nginx-ui.conf" ]]; then
  rm -rf "$DATA_DIR/nginx-ui.conf"
fi
if [[ ! -f "$DATA_DIR/nginx-ui.conf" ]]; then
  cp "$ROOT/frontend/nginx.host-backend.hostnet.conf" "$DATA_DIR/nginx-ui.conf"
fi

if [[ ! -f "$KEYS" ]]; then
  echo "Thiếu keys/public_key.pem — chạy ./scripts/deploy-usb-linux.sh lần đầu."
  exit 1
fi

backend_ok() {
  curl -sf "http://127.0.0.1:${CMS_BACKEND_PORT}/api/health" 2>/dev/null | grep -q '"status":"ok"'
}

wait_docker() {
  local i=0
  while (( i < 36 )); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
    i=$((i + 1))
  done
  return 1
}

if ! backend_ok; then
  echo "=== Khởi động backend USB native ==="
  bash "$ROOT/scripts/fix-data-perms.sh" || true
  cd "$BACKEND"
  # shellcheck disable=SC1091
  source "$ROOT/scripts/ensure-backend-venv.sh"
  ensure_backend_venv "$BACKEND"
  # shellcheck disable=SC1091
  source .venv/bin/activate
  export CMS_USB_MOCK_MODE=false
  export CMS_JABLOTRON_VENDOR_ID=0x16D6
  export CMS_JABLOTRON_PRODUCT_ID=0x0008
  export CMS_PUBLIC_KEY_PATH="$KEYS"
  export CMS_DATABASE_URL="sqlite+aiosqlite:///$DATA_DIR/cms.db"
  export CMS_HWID_CACHE_PATH="$DATA_DIR/hwid.cache"
  export CMS_CORS_ORIGINS="http://localhost:${CMS_UI_PORT},http://127.0.0.1:${CMS_UI_PORT},http://localhost:5173,http://127.0.0.1:5173"
  nohup uvicorn app.main:app --host 0.0.0.0 --port "$CMS_BACKEND_PORT" >>"$LOG_DIR/backend.log" 2>&1 &
  echo $! >"$PID_FILE"
  ready=0
  for _ in $(seq 1 20); do
    sleep 1
    if backend_ok; then
      ready=1
      break
    fi
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "Backend chưa sẵn sàng trên :${CMS_BACKEND_PORT}"
    tail -20 "$LOG_DIR/backend.log" 2>/dev/null || true
    exit 1
  fi
else
  echo "Backend đã chạy trên :${CMS_BACKEND_PORT}"
fi

cd "$ROOT"
if wait_docker; then
  echo "=== Docker UI (proxy USB native :8010) ==="
  docker stop jablotron-cms-backend >/dev/null 2>&1 || true
  docker rm jablotron-cms-backend >/dev/null 2>&1 || true
  docker compose -f "$ROOT/docker-compose.yml" stop backend >/dev/null 2>&1 || true
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans --force-recreate
else
  echo "Docker chưa sẵn sàng — enable docker.service. Backend USB vẫn chạy."
fi

echo "Xong. UI http://127.0.0.1:${CMS_UI_PORT}  API http://127.0.0.1:${CMS_BACKEND_PORT}/api/health"
