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
  echo "  ⚠ Container jablotron-cms-backend vẫn chạy — USB HID không hoạt động trong Docker"
  echo "    Dừng: bash scripts/stop-cms.sh"
  docker exec jablotron-cms-backend lsusb 2>/dev/null | grep -i 16d6 || true
elif curl -sf http://127.0.0.1:8010/api/health 2>/dev/null | grep -q '"status":"ok"'; then
  echo "  ✓ Backend native :8010 (đúng cho USB)"
else
  echo "  ✗ Chưa có backend native — chạy: bash scripts/deploy-usb-linux.sh"
fi

echo ""
echo "=== 4. API (native :8010) ==="
NATIVE="$(curl -sf http://127.0.0.1:8010/api/usb/status 2>/dev/null || true)"
if [[ -n "$NATIVE" ]]; then
  echo "$NATIVE" | python3 -m json.tool 2>/dev/null || echo "$NATIVE"
else
  echo "  (không phản hồi — backend native chưa chạy trên port 8010)"
fi

echo ""
echo "=== 5. API (UI :8080) ==="
UI="$(curl -sf http://127.0.0.1:8080/api/usb/status 2>/dev/null || true)"
if [[ -n "$UI" ]]; then
  echo "$UI" | python3 -m json.tool 2>/dev/null || echo "$UI"
else
  echo "  (UI chưa chạy hoặc chưa proxy tới :8010)"
fi

echo ""
echo "=== Gợi ý ==="
if [[ "$HOST_USB" -eq 1 ]]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^jablotron-cms-backend$'; then
    echo "Đang chạy SAI chế độ (backend trong Docker). Chạy:"
    echo "  bash scripts/stop-cms.sh"
    echo "  bash scripts/deploy-usb-linux.sh"
  elif [[ -z "$NATIVE" ]]; then
    echo "USB đã cắm nhưng backend native chưa chạy:"
    echo "  bash scripts/deploy-usb-linux.sh"
  else
    echo "OK — dùng http://127.0.0.1:8080 (UI) hoặc http://127.0.0.1:8010 (API trực tiếp)"
  fi
else
  echo "Cắm USB Link, rồi: sudo bash scripts/setup-usb-linux.sh"
fi
