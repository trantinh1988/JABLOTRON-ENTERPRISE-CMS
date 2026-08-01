#!/usr/bin/env bash
# Tạo/kích hoạt virtualenv backend. Source từ deploy/start scripts.
# Usage: ensure_backend_venv "/path/to/backend"

ensure_backend_venv() {
  local backend_dir="${1:?backend dir required}"
  cd "$backend_dir"

  local pyver
  pyver="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

  _venv_ok() {
    [[ -x .venv/bin/python3 ]] && .venv/bin/python3 -c "import pip" >/dev/null 2>&1
  }

  if ! _venv_ok; then
    if [[ -d .venv ]]; then
      echo "Virtualenv lỗi — xóa và tạo lại..."
      rm -rf .venv
    fi
    echo "Tạo virtualenv (Python ${pyver})..."
    if ! python3 -m venv .venv; then
      echo ""
      echo "Thiếu python3-venv. Chạy (1 lần):"
      echo "  sudo bash scripts/setup-deps-linux.sh"
      echo ""
      echo "Hoặc thủ công:"
      echo "  sudo apt update"
      echo "  sudo apt install -y python3-venv python${pyver}-venv python3-pip libhidapi-hidraw0"
      echo ""
      echo "Sau đó: bash scripts/deploy-usb-linux.sh"
      exit 1
    fi
  fi

  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install -r requirements.txt -q
}
