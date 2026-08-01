#!/usr/bin/env bash
# Cài quyền USB Jablotron trên Linux (udev + plugdev + sửa hidraw ngay lập tức)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RULES="$ROOT/scripts/99-jablotron-hid.rules"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Chạy với sudo: sudo $0"
  exit 1
fi

echo "=== Cài udev rules ==="
cp "$RULES" /etc/udev/rules.d/99-jablotron-hid.rules
udevadm control --reload-rules
udevadm trigger

echo "=== Nhóm plugdev cho user giabao (nếu có) ==="
if id giabao &>/dev/null; then
  usermod -aG plugdev giabao 2>/dev/null || groupadd plugdev && usermod -aG plugdev giabao
  echo "Đã thêm giabao vào plugdev"
fi

SUDO_USER="${SUDO_USER:-}"
if [[ -n "$SUDO_USER" ]] && [[ "$SUDO_USER" != "root" ]]; then
  usermod -aG plugdev "$SUDO_USER" 2>/dev/null || true
  echo "Đã thêm $SUDO_USER vào plugdev"
fi

echo "=== Sửa quyền hidraw hiện tại (tạm thời đến khi rút/cắm lại USB) ==="
for f in /dev/hidraw*; do
  if [[ -e "$f" ]]; then
    chmod 666 "$f"
    echo "  $f -> $(ls -la "$f")"
  fi
done

echo ""
echo "=== Kiểm tra ==="
lsusb | grep -i 16d6 || echo "Chưa thấy 16d6 — cắm USB Link"
ls -la /dev/hidraw* 2>/dev/null || true
echo ""
echo "Xong. Rebuild Docker: docker compose up -d --build"
echo "Hoặc backend native: ./scripts/start-backend-usb.sh"
