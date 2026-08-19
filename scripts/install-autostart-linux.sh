#!/usr/bin/env bash
# Cài systemd --user: CMS tự chạy khi đăng nhập Linux.
# Cần đã deploy lần đầu (có backend/.venv).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/backend/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "Chưa có virtualenv — chạy ./scripts/deploy-usb-linux.sh trước."
  exit 1
fi
export PYTHONPATH="$ROOT/backend"
cd "$ROOT/backend"
"$PY" -c "from app.iot_core.host_autostart import set_autostart; import json; print(json.dumps(set_autostart(True), ensure_ascii=False, indent=2))"
