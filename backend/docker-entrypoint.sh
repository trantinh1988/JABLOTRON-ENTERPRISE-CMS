#!/bin/bash
set -e
# Container chạy root — mở quyền hidraw Jablotron (host udev chưa kịp áp dụng)
for f in /dev/hidraw*; do
  if [ -e "$f" ]; then
    chmod 666 "$f" 2>/dev/null || true
  fi
done
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
