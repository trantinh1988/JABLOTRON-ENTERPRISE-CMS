#!/usr/bin/env bash
# Cài dependency hệ thống cho backend native (USB HID) trên Ubuntu/Debian.
# Chạy 1 lần: sudo bash scripts/setup-deps-linux.sh

set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Chạy với sudo: sudo bash $0"
  exit 1
fi

PYVER="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "3")"

echo "=== Python ${PYVER} — cài venv, pip, hidapi ==="
apt-get update -qq
apt-get install -y \
  python3 \
  python3-pip \
  python3-venv \
  "python${PYVER}-venv" \
  libhidapi-hidraw0 \
  libhidapi-libusb0 \
  usbutils \
  curl

echo ""
echo "=== Kiểm tra ==="
python3 -m venv /tmp/cms-venv-test
/tmp/cms-venv-test/bin/pip install hidapi -q
/tmp/cms-venv-test/bin/python3 -c "import hid; print('hidapi OK')"
rm -rf /tmp/cms-venv-test

echo ""
echo "Xong. Chạy tiếp (user giabao, không cần sudo):"
echo "  cd /www/wwwroot/Jablotron/JABLOTRON-ENTERPRISE-CMS"
echo "  bash scripts/deploy-usb-linux.sh"
