#!/usr/bin/env bash
# Sửa quyền backend/data — Docker thường tạo cms.db với user root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT/backend/data"
USER_NAME="$(whoami)"
GROUP_NAME="$(id -gn)"

mkdir -p "$DATA_DIR"

if ! touch "$DATA_DIR/.write_test" 2>/dev/null; then
  echo "Không ghi được $DATA_DIR — cần sudo để sửa quyền (Docker tạo file root:root)"
  sudo chown -R "${USER_NAME}:${GROUP_NAME}" "$DATA_DIR"
  sudo chmod -R u+rwX "$DATA_DIR"
else
  rm -f "$DATA_DIR/.write_test"
  # File DB riêng lẻ có thể vẫn root
  if [[ -f "$DATA_DIR/cms.db" ]] && [[ ! -w "$DATA_DIR/cms.db" ]]; then
    echo "cms.db không ghi được — sửa quyền..."
    sudo chown "${USER_NAME}:${GROUP_NAME}" "$DATA_DIR/cms.db" "$DATA_DIR/"* 2>/dev/null || true
    sudo chmod u+rw "$DATA_DIR/cms.db" 2>/dev/null || true
  fi
fi

echo "Quyền data/:"
ls -la "$DATA_DIR"
