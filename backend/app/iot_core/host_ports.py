"""Port UI (Docker/nginx) và port API (uvicorn native) — lưu trên máy trạm."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

from app.core.config import BACKEND_ROOT, REPO_ROOT
from app.iot_core.host_autostart import current_os, start_script

DEFAULT_UI_PORT = 8080
DEFAULT_API_PORT = 8010
PORT_MIN = 1024
PORT_MAX = 65535

_lock = threading.Lock()
_path_override: Path | None = None


def set_ports_path(path: Path | None) -> None:
    global _path_override
    _path_override = path


def ports_path() -> Path:
    return _path_override or (BACKEND_ROOT / "data" / "host_ports.json")


def nginx_runtime_path() -> Path:
    return BACKEND_ROOT / "data" / "nginx-ui.conf"


def env_runtime_path() -> Path:
    return BACKEND_ROOT / "data" / "cms-ports.env"


def _empty() -> dict[str, int]:
    return {"ui_port": DEFAULT_UI_PORT, "api_port": DEFAULT_API_PORT}


def _clamp_port(value: Any, default: int) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError):
        return default
    if port < PORT_MIN or port > PORT_MAX:
        return default
    return port


def load_ports() -> dict[str, int]:
    path = ports_path()
    if not path.is_file():
        return _empty()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty()
    if not isinstance(raw, dict):
        return _empty()
    ui = _clamp_port(raw.get("ui_port"), DEFAULT_UI_PORT)
    api = _clamp_port(raw.get("api_port"), DEFAULT_API_PORT)
    if ui == api:
        return _empty()
    return {"ui_port": ui, "api_port": api}


def validate_ports(ui_port: int, api_port: int) -> str | None:
    for port in (ui_port, api_port):
        if not isinstance(port, int) or port < PORT_MIN or port > PORT_MAX:
            return "invalid_port"
    if ui_port == api_port:
        return "ports_equal"
    return None


def cors_origins(ui_port: int) -> list[str]:
    return [
        f"http://localhost:{ui_port}",
        f"http://127.0.0.1:{ui_port}",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


def cors_origins_env(ui_port: int) -> str:
    return ",".join(cors_origins(ui_port))


def _nginx_conf(*, ui_port: int, api_port: int, hostnet: bool) -> str:
    listen = str(ui_port) if hostnet else "80"
    upstream = f"127.0.0.1:{api_port}" if hostnet else f"host.docker.internal:{api_port}"
    return (
        f"# generated — UI :{ui_port}  API :{api_port}\n"
        "server {\n"
        f"    listen {listen};\n"
        "    server_name _;\n"
        "    root /usr/share/nginx/html;\n"
        "    index index.html;\n"
        "\n"
        "    location / {\n"
        "        try_files $uri $uri/ /index.html;\n"
        "    }\n"
        "\n"
        "    location /api/system/backup {\n"
        f"        proxy_pass http://{upstream};\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\n"
        "        proxy_connect_timeout 10s;\n"
        "        proxy_send_timeout 300s;\n"
        "        proxy_read_timeout 300s;\n"
        "        client_max_body_size 256m;\n"
        "    }\n"
        "\n"
        "    location /api/ {\n"
        f"        proxy_pass http://{upstream}/api/;\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\n"
        "        proxy_connect_timeout 10s;\n"
        "        proxy_send_timeout 90s;\n"
        "        proxy_read_timeout 90s;\n"
        "        proxy_next_upstream error timeout;\n"
        "        proxy_next_upstream_tries 2;\n"
        "        client_max_body_size 15m;\n"
        "    }\n"
        "\n"
        "    location /media/ {\n"
        f"        proxy_pass http://{upstream}/media/;\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "        proxy_set_header X-Forwarded-Proto $scheme;\n"
        "        client_max_body_size 15m;\n"
        "    }\n"
        "\n"
        "    location /ws/ {\n"
        f"        proxy_pass http://{upstream}/ws/;\n"
        "        proxy_http_version 1.1;\n"
        "        proxy_set_header Upgrade $http_upgrade;\n"
        "        proxy_set_header Connection \"upgrade\";\n"
        "        proxy_set_header Host $host;\n"
        "        proxy_set_header X-Real-IP $remote_addr;\n"
        "        proxy_connect_timeout 10s;\n"
        "        proxy_read_timeout 86400;\n"
        "    }\n"
        "}\n"
    )


def write_runtime_files(ui_port: int, api_port: int) -> None:
    data_dir = BACKEND_ROOT / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    hostnet = current_os() == "linux"
    nginx_runtime_path().write_text(
        _nginx_conf(ui_port=ui_port, api_port=api_port, hostnet=hostnet),
        encoding="utf-8",
    )
    env_runtime_path().write_text(
        f"CMS_UI_PORT={ui_port}\nCMS_BACKEND_PORT={api_port}\n",
        encoding="ascii",
    )


def save_ports(ui_port: int, api_port: int) -> dict[str, int]:
    err = validate_ports(ui_port, api_port)
    if err:
        raise ValueError(err)
    path = ports_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {"ui_port": ui_port, "api_port": api_port}
    with _lock:
        path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        if _path_override is None:
            write_runtime_files(ui_port, api_port)
    return state


def ensure_runtime_files() -> dict[str, int]:
    state = load_ports()
    if _path_override is None:
        try:
            write_runtime_files(state["ui_port"], state["api_port"])
        except OSError:
            pass
    return state


def compose_file() -> Path:
    if current_os() == "linux":
        return REPO_ROOT / "docker-compose.usb-host.linux.yml"
    return REPO_ROOT / "docker-compose.usb-host.yml"


def _docker_env(ui_port: int, api_port: int) -> dict[str, str]:
    env = os.environ.copy()
    env["CMS_UI_PORT"] = str(ui_port)
    env["CMS_BACKEND_PORT"] = str(api_port)
    env["CMS_CORS_ORIGINS"] = cors_origins_env(ui_port)
    return env


def recreate_frontend(ui_port: int, api_port: int) -> str | None:
    compose = compose_file()
    if not compose.is_file():
        return "missing_compose"
    write_runtime_files(ui_port, api_port)
    kwargs: dict[str, Any] = {
        "cwd": str(REPO_ROOT),
        "capture_output": True,
        "text": True,
        "timeout": 120,
        "encoding": "utf-8",
        "errors": "replace",
        "env": _docker_env(ui_port, api_port),
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                str(compose),
                "up",
                "-d",
                "--force-recreate",
                "--no-deps",
                "frontend",
            ],
            **kwargs,
        )
    except FileNotFoundError:
        return "docker_missing"
    except subprocess.TimeoutExpired:
        return "docker_timeout"
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "docker_failed").strip()[:400]
        return err or "docker_failed"
    return None


def _health_ok(port: int, timeout: float = 2.0) -> bool:
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        return raw.get("status") == "ok"
    except (OSError, URLError, json.JSONDecodeError, TimeoutError, ValueError):
        return False


def spawn_backend(api_port: int, ui_port: int) -> None:
    log_dir = REPO_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    out = open(log_dir / "backend.log", "a", encoding="utf-8", errors="replace")
    err = open(log_dir / "backend.err.log", "a", encoding="utf-8", errors="replace")
    kwargs: dict[str, Any] = {
        "cwd": str(BACKEND_ROOT),
        "stdout": out,
        "stderr": err,
        "env": _docker_env(ui_port, api_port),
        "close_fds": sys.platform != "win32",
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0
        )
    else:
        kwargs["start_new_session"] = True
    try:
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "0.0.0.0",
                "--port",
                str(api_port),
            ],
            **kwargs,
        )
    finally:
        out.close()
        err.close()
    pid_file = log_dir / "backend.pid"
    try:
        pid_file.write_text(str(proc.pid), encoding="ascii")
    except OSError:
        pass


def stop_current_backend() -> None:
    time.sleep(1.2)
    try:
        os.kill(os.getpid(), signal.SIGTERM)
    except OSError:
        os._exit(0)


def apply_saved_ports(prev_api: int) -> dict[str, Any]:
    state = load_ports()
    ui_port = state["ui_port"]
    api_port = state["api_port"]
    if api_port != prev_api:
        spawn_backend(api_port, ui_port)
        ready = False
        for _ in range(25):
            time.sleep(0.4)
            if _health_ok(api_port):
                ready = True
                break
        if not ready:
            return ports_status(applied=False, detail="api_start_failed")
    docker_err = recreate_frontend(ui_port, api_port)
    return ports_status(applied=docker_err is None, detail=docker_err)


def ports_status(*, applied: bool | None = None, detail: str | None = None) -> dict[str, Any]:
    state = ensure_runtime_files()
    ui = state["ui_port"]
    api = state["api_port"]
    return {
        "ui_port": ui,
        "api_port": api,
        "ui_port_default": DEFAULT_UI_PORT,
        "api_port_default": DEFAULT_API_PORT,
        "ui_url": f"http://127.0.0.1:{ui}",
        "api_url": f"http://127.0.0.1:{api}",
        "os": current_os(),
        "applied": applied,
        "detail": detail,
        "start_script": str(start_script()),
    }
