#!/usr/bin/env bash
# Kiểm tra USB Jablotron trên host và API backend.
# Chạy: bash scripts/check-usb-linux.sh  (hoặc chmod +x scripts/*.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST_USB=0
if command -v lsusb >/dev/null 2>&1; then
  if lsusb | grep -qi 16d6; then
    HOST_USB=1
  fi
fi

echo "=== 1. Host: lsusb ==="
if command -v lsusb >/dev/null 2>&1; then
  lsusb | grep -i 16d6 || echo "(không thấy VID 16d6 — cắm USB Link Jablotron)"
else
  echo "Cài usbutils: sudo apt install usbutils"
fi

echo ""
echo "=== 2. Host: hidraw ==="
ls -la /dev/hidraw* 2>/dev/null || echo "(không có /dev/hidraw*)"

echo ""
echo "=== 3. Backend đang chạy ở đâu? ==="
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^jablotron-cms-backend$'; then
  echo "  Docker container jablotron-cms-backend (thường KHÔNG thấy USB HID)"
  docker exec jablotron-cms-backend lsusb 2>/dev/null | grep -i 16d6 || echo "  → container không thấy 16d6"
elif curl -sf http://127.0.0.1:8000/api/usb/status >/dev/null 2>&1; then
  echo "  Native trên host :8000 (đúng cho USB)"
else
  echo "  Không thấy backend (Docker hoặc native)"
fi

echo ""
echo "=== 4. API /api/usb/status ==="
STATUS="$(curl -sf http://127.0.0.1:8000/api/usb/status 2>/dev/null \
  || curl -sf http://127.0.0.1:8080/api/usb/status 2>/dev/null \
  || true)"
if [[ -n "$STATUS" ]]; then
  echo "$STATUS" | python3 -m json.tool 2>/dev/null || echo "$STATUS"
else
  echo "(không gọi được API — backend chưa chạy?)"
fi

echo ""
echo "=== Gợi ý ==="
if [[ "$HOST_USB" -eq 1 ]]; then
  echo "Host thấy USB → dùng backend NATIVE (không chạy backend trong Docker):"
  echo "  bash scripts/deploy-usb-linux.sh"
  echo "Hoặc thủ công:"
  echo "  docker compose down"
  echo "  ./scripts/start-backend-usb.sh          # terminal 1"
  echo "  docker compose -f docker-compose.usb-host.yml up -d --build"
else
  echo "Cắm USB Link, rồi: sudo ./scripts/setup-usb-linux.sh"
fi
