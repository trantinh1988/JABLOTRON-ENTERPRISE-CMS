#!/usr/bin/env bash
# Triển khai CMS với USB thật trên Linux:
#   - Backend native trên host (port 8010) — HID hoạt động
#   - Frontend trong Docker (port 8080) — proxy tới host:8010
#
# Chạy: chmod +x scripts/*.sh && ./scripts/deploy-usb-linux.sh
# Lần đầu: sudo ./scripts/setup-usb-linux.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
LOG_DIR="$ROOT/logs"
PID_FILE="$LOG_DIR/backend.pid"
DATA_DIR="$BACKEND/data"
KEYS="$ROOT/keys/public_key.pem"

cd "$ROOT"
mkdir -p "$LOG_DIR" "$DATA_DIR"

if [[ ! -f "$KEYS" ]]; then
  echo "Thiếu keys/public_key.pem"
  exit 1
fi

echo "=== 1. Dừng stack Docker đầy đủ (backend trong container không thấy USB) ==="
docker compose down 2>/dev/null || true

echo ""
echo "=== 2. Chuẩn bị backend native ==="
cd "$BACKEND"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -r requirements.txt -q

CMS_BACKEND_PORT="${CMS_BACKEND_PORT:-8010}"

echo ""
echo "=== 3. Dừng backend cũ (nếu có) ==="
if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi
pkill -f "uvicorn app.main:app --host 0.0.0.0 --port ${CMS_BACKEND_PORT}" 2>/dev/null || true
pkill -f "uvicorn app.main:app --host 0.0.0.0 --port 8000" 2>/dev/null || true
sleep 1

export CMS_USB_MOCK_MODE=false
export CMS_JABLOTRON_VENDOR_ID=0x16D6
export CMS_JABLOTRON_PRODUCT_ID=0x0008
export CMS_PUBLIC_KEY_PATH="$KEYS"
export CMS_DATABASE_URL="sqlite+aiosqlite:///$DATA_DIR/cms.db"
export CMS_HWID_CACHE_PATH="$DATA_DIR/hwid.cache"
export CMS_CORS_ORIGINS="http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173"

echo ""
echo "=== 4. Khởi động backend USB (nền, port ${CMS_BACKEND_PORT}) ==="
nohup uvicorn app.main:app --host 0.0.0.0 --port "$CMS_BACKEND_PORT" >>"$LOG_DIR/backend.log" 2>&1 &
echo $! >"$PID_FILE"
sleep 2

if ! curl -sf "http://127.0.0.1:${CMS_BACKEND_PORT}/api/health" >/dev/null; then
  echo "Backend chưa sẵn sàng trên :${CMS_BACKEND_PORT} — xem log: tail -f $LOG_DIR/backend.log"
  echo "Port 8000 có thể bị aaPanel chiếm — backend CMS dùng :${CMS_BACKEND_PORT}"
  exit 1
fi

echo ""
echo "=== 5. Khởi động UI Docker (proxy → host:${CMS_BACKEND_PORT}) ==="
cd "$ROOT"
docker compose -f docker-compose.usb-host.yml up -d --build

echo ""
echo "=== 6. Kiểm tra USB ==="
bash "$ROOT/scripts/check-usb-linux.sh"

echo ""
echo "Xong."
echo "  UI:      http://127.0.0.1:8080"
echo "  API:     http://127.0.0.1:${CMS_BACKEND_PORT}/api/usb/status"
echo "  Log:     tail -f $LOG_DIR/backend.log"
echo "  Dừng:    kill \$(cat $PID_FILE); docker compose -f docker-compose.usb-host.yml down"
