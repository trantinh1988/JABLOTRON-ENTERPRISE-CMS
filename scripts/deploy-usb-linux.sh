#!/usr/bin/env bash
# Triển khai CMS với USB thật trên Linux:
#   - Backend native trên host (port 8010) — HID hoạt động
#   - Frontend trong Docker (port 8080) — proxy tới host:8010
#
# Chạy: chmod +x scripts/*.sh && ./scripts/deploy-usb-linux.sh
# Lần đầu Ubuntu: sudo bash scripts/setup-deps-linux.sh
# USB udev:       sudo bash scripts/setup-usb-linux.sh

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

CMS_BACKEND_PORT="${CMS_BACKEND_PORT:-8010}"

echo "=== 1. Dừng Docker backend (container không dùng được USB HID) ==="
bash "$ROOT/scripts/stop-cms.sh"

echo ""
echo "=== 2. Kiểm tra HID trên host ==="
if ! lsusb | grep -qi 16d6; then
  echo "Cắm USB Link Jablotron rồi chạy lại."
  exit 1
fi
for f in /dev/hidraw*; do
  [[ -e "$f" ]] && chmod 666 "$f" 2>/dev/null || true
done

echo ""
echo "=== 3. Chuẩn bị backend native ==="
cd "$BACKEND"
# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-backend-venv.sh"
ensure_backend_venv "$BACKEND"

python3 - <<'PY' || { echo "hidapi không thấy Jablotron — cài: sudo apt install libhidapi-hidraw0"; exit 1; }
import hid
n = len(hid.enumerate(0x16D6, 0x0008))
print(f"hid.enumerate(16D6,0008) → {n} thiết bị")
if n == 0:
    all16 = [d for d in hid.enumerate(0, 0) if d.get("vendor_id") == 0x16D6]
    print(f"fallback enumerate → {len(all16)} thiết bị")
    if not all16:
        raise SystemExit(1)
PY

echo ""
echo "=== 4. Dừng backend cũ (nếu có) ==="
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
echo "=== 5. Khởi động backend USB (nền, port ${CMS_BACKEND_PORT}) ==="
nohup uvicorn app.main:app --host 0.0.0.0 --port "$CMS_BACKEND_PORT" >>"$LOG_DIR/backend.log" 2>&1 &
echo $! >"$PID_FILE"
sleep 2

if ! curl -sf "http://127.0.0.1:${CMS_BACKEND_PORT}/api/health" | grep -q '"status":"ok"'; then
  echo "Backend chưa sẵn sàng trên :${CMS_BACKEND_PORT} — xem log:"
  tail -20 "$LOG_DIR/backend.log" 2>/dev/null || true
  exit 1
fi

USB_JSON="$(curl -sf "http://127.0.0.1:${CMS_BACKEND_PORT}/api/usb/status")"
if echo "$USB_JSON" | grep -q 'Backend đang chạy trong Docker'; then
  echo "Lỗi: :${CMS_BACKEND_PORT} vẫn trỏ vào Docker — chạy: bash scripts/stop-cms.sh"
  exit 1
fi

echo ""
echo "=== 6. Khởi động UI Docker (proxy → host:${CMS_BACKEND_PORT}) ==="
cd "$ROOT"
docker compose -f docker-compose.usb-host.yml up -d --build

echo ""
echo "=== 7. Kiểm tra USB ==="
bash "$ROOT/scripts/check-usb-linux.sh"

echo ""
echo "Xong."
echo "  UI:      http://127.0.0.1:8080"
echo "  API:     http://127.0.0.1:${CMS_BACKEND_PORT}/api/usb/status"
echo "  Log:     tail -f $LOG_DIR/backend.log"
echo "  Dừng:    kill \$(cat $PID_FILE); docker compose -f docker-compose.usb-host.yml down"
