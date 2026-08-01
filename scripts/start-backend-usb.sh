#!/usr/bin/env bash
# Backend Jablotron CMS — USB HID thật trên Linux (không Docker).
# Chạy script này TRƯỚC, sau đó: docker compose -f docker-compose.usb-host.yml up -d

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
DATA_DIR="$BACKEND/data"
KEYS="$ROOT/keys/public_key.pem"

cd "$BACKEND"

if [[ ! -f "$KEYS" ]]; then
  echo "Chưa có keys/public_key.pem. Chạy từ thư mục gốc:"
  echo "  python admin_tool_keygen.py gen-keys --out-dir keys"
  exit 1
fi

if [[ ! -d .venv ]]; then
  echo "Tạo virtualenv..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
pip install -r requirements.txt -q

mkdir -p "$DATA_DIR"

export CMS_USB_MOCK_MODE=false
export CMS_JABLOTRON_VENDOR_ID=0x16D6
export CMS_JABLOTRON_PRODUCT_ID=0x0008
export CMS_PUBLIC_KEY_PATH="$KEYS"
export CMS_DATABASE_URL="sqlite+aiosqlite:///$DATA_DIR/cms.db"
export CMS_HWID_CACHE_PATH="$DATA_DIR/hwid.cache"
export CMS_CORS_ORIGINS="http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173"

CMS_BACKEND_PORT="${CMS_BACKEND_PORT:-8010}"

echo ""
echo "Backend USB HID — http://0.0.0.0:${CMS_BACKEND_PORT}"
echo "(Port 8000 thường bị aaPanel chiếm — mặc định dùng ${CMS_BACKEND_PORT})"
echo "Terminal khác: docker compose -f docker-compose.usb-host.yml up -d --build"
echo "UI: http://127.0.0.1:8080 — cắm USB Link Jablotron"
echo ""

exec uvicorn app.main:app --host 0.0.0.0 --port "$CMS_BACKEND_PORT" --reload
