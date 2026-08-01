#!/usr/bin/env bash
# Kiểm tra USB Jablotron trên host và trong container Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== 1. Host: lsusb ==="
if command -v lsusb >/dev/null 2>&1; then
  lsusb | grep -i 16d6 || echo "(không thấy VID 16d6 trên host — kiểm tra cáp USB)"
else
  echo "Cài usbutils: sudo apt install usbutils"
fi

echo ""
echo "=== 2. Host: hidraw ==="
ls -la /dev/hidraw* 2>/dev/null || echo "(không có /dev/hidraw*)"

echo ""
echo "=== 3. Container: lsusb ==="
if docker ps --format '{{.Names}}' | grep -q jablotron-cms-backend; then
  docker exec jablotron-cms-backend lsusb 2>/dev/null | grep -i 16d6 || echo "(container không thấy 16d6)"
else
  echo "Container jablotron-cms-backend không chạy"
fi

echo ""
echo "=== 4. API /api/usb/status ==="
curl -sf http://127.0.0.1:8080/api/usb/status 2>/dev/null | python3 -m json.tool 2>/dev/null \
  || curl -sf http://127.0.0.1:8000/api/usb/status 2>/dev/null | python3 -m json.tool 2>/dev/null \
  || echo "(không gọi được API — backend chưa chạy?)"

echo ""
echo "=== Gợi ý ==="
echo "Host có 16d6, container không → chạy backend ngoài Docker:"
echo "  ./scripts/start-backend-usb.sh"
echo "  docker compose -f docker-compose.usb-host.yml up -d --build"
