"""Windows CMS window — loads the existing SPA (local or remote server).

Does not start USB/API itself. WebView2 (pywebview) first; Edge --app= fallback.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
PORTS_FILE = BACKEND / "data" / "host_ports.json"
DEFAULT_API_PORT = 8010
DEFAULT_UI_PORT = 8080
TITLE = "Jablotron Enterprise CMS"


def window_icon_cache_path() -> Path:
    appdata = os.environ.get("APPDATA", "").strip()
    folder = Path(appdata) / "JablotronCMS" if appdata else BACKEND / "data"
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError:
        folder = BACKEND / "data"
        folder.mkdir(parents=True, exist_ok=True)
    return folder / "window.ico"


def png_bytes_to_ico(png: bytes) -> bytes:
    size = len(png)
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, size, 22)
    return header + entry + png


def logo_file_to_ico(src: Path) -> Path | None:
    if not src.is_file():
        return None
    try:
        raw = src.read_bytes()
    except OSError:
        return None
    dest = window_icon_cache_path()
    suffix = src.suffix.lower()
    if suffix == ".ico":
        try:
            dest.write_bytes(raw)
            return dest
        except OSError:
            return src
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        try:
            dest.write_bytes(png_bytes_to_ico(raw))
            return dest
        except OSError:
            return None
    return None


def load_site_branding() -> tuple[str, Path | None]:
    _ensure_backend_path()
    title = TITLE
    icon: Path | None = None
    try:
        from app.iot_core.system_sounds import ensure_brand_dir, get_system_settings

        state = get_system_settings()
        custom = str(state.get("site_title") or "").strip()
        if custom:
            title = custom[:80]
        slot = state.get("site_logo")
        if isinstance(slot, dict):
            url = str(slot.get("url") or "")
            name = url.rsplit("/", 1)[-1]
            if name and ".." not in name and "\\" not in name:
                src = ensure_brand_dir() / name
                icon = logo_file_to_ico(src)
    except Exception:
        pass
    return title, icon
_HOST_OK = re.compile(
    r"^(?:(?:\d{1,3}\.){3}\d{1,3}|localhost|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)$"
)


def config_path() -> Path:
    appdata = os.environ.get("APPDATA", "").strip()
    if appdata:
        folder = Path(appdata) / "JablotronCMS"
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError:
            return ROOT / "desktop.json"
        return folder / "desktop.json"
    return ROOT / "desktop.json"


def load_client_config() -> dict:
    path = config_path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def save_client_config(data: dict) -> None:
    path = config_path()
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def normalize_host(raw: str) -> str | None:
    text = (raw or "").strip()
    for prefix in ("http://", "https://"):
        if text.lower().startswith(prefix):
            text = text[len(prefix) :]
    text = text.split("/")[0].strip()
    host = text
    port: int | None = None
    if ":" in text:
        host, _, rest = text.partition(":")
        if rest.isdigit():
            port = int(rest)
        else:
            return None
    host = host.strip().strip("[]")
    if not host or not _HOST_OK.match(host):
        return None
    if port is not None:
        return f"{host}:{port}"
    return host


def parse_host_port(host_raw: str, port_raw: object) -> tuple[str, int] | None:
    host = normalize_host(str(host_raw or ""))
    if not host:
        return None
    if ":" in host:
        name, _, p = host.partition(":")
        if not p.isdigit():
            return None
        n = int(p)
        if n < 1 or n > 65535:
            return None
        return name, n
    try:
        port = int(port_raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if port < 1 or port > 65535:
        return None
    return host, port


def _ensure_backend_path() -> None:
    backend = str(BACKEND)
    if BACKEND.is_dir() and backend not in sys.path:
        sys.path.insert(0, backend)


def _clamp_port(value: object, default: int) -> int:
    try:
        port = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    if port < 1024 or port > 65535:
        return default
    return port


def load_desktop_ports() -> tuple[int, int]:
    _ensure_backend_path()
    try:
        from app.iot_core.host_ports import load_ports

        state = load_ports()
        return int(state["api_port"]), int(state["ui_port"])
    except Exception:
        pass
    api = DEFAULT_API_PORT
    ui = DEFAULT_UI_PORT
    if PORTS_FILE.is_file():
        try:
            raw = json.loads(PORTS_FILE.read_text(encoding="utf-8"))
            api = _clamp_port(raw.get("api_port"), DEFAULT_API_PORT)
            ui = _clamp_port(raw.get("ui_port"), DEFAULT_UI_PORT)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    env_api = os.environ.get("CMS_BACKEND_PORT", "").strip()
    env_ui = os.environ.get("CMS_UI_PORT", "").strip()
    if env_api.isdigit():
        api = _clamp_port(env_api, api)
    if env_ui.isdigit():
        ui = _clamp_port(env_ui, ui)
    return api, ui


def api_port() -> int:
    return load_desktop_ports()[0]


def ui_port() -> int:
    return load_desktop_ports()[1]


def desktop_url(port: int | None = None) -> str:
    return f"http://127.0.0.1:{port if port is not None else api_port()}/"


def remote_url(host: str, port: int) -> str:
    return f"http://{host}:{port}/"


def health_ok(port: int, timeout: float = 2.0) -> bool:
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        return raw.get("status") == "ok"
    except (OSError, URLError, json.JSONDecodeError, TimeoutError, ValueError):
        return False


def looks_like_spa_url(url: str, timeout: float = 2.0) -> bool:
    try:
        with urlopen(url, timeout=timeout) as resp:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            body = resp.read(4096).decode("utf-8", errors="replace").lower()
        if "application/json" in ctype:
            return False
        return "<html" in body or "<!doctype" in body
    except (HTTPError, OSError, URLError, TimeoutError, ValueError):
        return False


def looks_like_spa(port: int, timeout: float = 2.0) -> bool:
    return looks_like_spa_url(desktop_url(port), timeout=timeout)


def with_cache_bust(url: str) -> str:
    stamp = str(int(time.time()))
    if "?" in url:
        return f"{url}&cms={stamp}"
    if url.endswith("/"):
        return f"{url}?cms={stamp}"
    return f"{url}/?cms={stamp}"


def clear_webview_http_cache(storage: Path) -> None:
    for rel in (
        "EBWebView/Default/Cache",
        "EBWebView/Default/Code Cache",
        "Cache",
        "Code Cache",
    ):
        path = storage / rel
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)


def choose_ui_url(api: int, ui: int, timeout: float = 12.0) -> str | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if looks_like_spa(api):
            return desktop_url(api)
        if looks_like_spa(ui):
            return desktop_url(ui)
        time.sleep(0.35)
    if looks_like_spa(api):
        return desktop_url(api)
    if looks_like_spa(ui):
        return desktop_url(ui)
    return None


def wait_health(port: int, timeout: float = 25.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if health_ok(port):
            return True
        time.sleep(0.4)
    return False


def client_saved_url() -> str | None:
    cfg = load_client_config()
    if str(cfg.get("mode") or "") != "client":
        return None
    parsed = parse_host_port(str(cfg.get("host") or ""), cfg.get("port"))
    if not parsed:
        return None
    host, port = parsed
    if port < 1:
        return None
    url = remote_url(host, port)
    return url if looks_like_spa_url(url, timeout=3.0) else None


def edge_exe() -> Path | None:
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "Microsoft"
        / "Edge"
        / "Application"
        / "msedge.exe",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
        / "Microsoft"
        / "Edge"
        / "Application"
        / "msedge.exe",
        Path(local) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def open_edge_app(url: str) -> bool:
    edge = edge_exe()
    if edge is None:
        return False
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0
        )
    subprocess.Popen([str(edge), f"--app={url}", "--new-window"], **kwargs)
    return True


def connect_html() -> str:
    return """<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<title>Jablotron Enterprise CMS</title>
<style>
body{font-family:Segoe UI,sans-serif;background:#eef1f4;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#fff;border-radius:12px;padding:1.5rem;width:22rem;max-width:92vw;box-shadow:0 16px 40px rgba(0,0,0,.12)}
h1{font-size:1.1rem;margin:0 0 .35rem}
p{color:#5b6570;font-size:.8rem;margin:0 0 1rem}
label{display:block;font-size:.75rem;margin:.55rem 0 .2rem}
input{width:100%;box-sizing:border-box;padding:.45rem .6rem;border:1px solid #d5dbe3;border-radius:6px}
.row{display:flex;gap:.5rem;margin-top:1rem}
button{flex:1;border:0;border-radius:6px;padding:.5rem .7rem;cursor:pointer}
.ok{background:#0e7c6b;color:#fff}
.ghost{background:#eef1f4}
.err{color:#b42318;font-size:.75rem;min-height:1.1rem;margin-top:.6rem}
</style></head><body>
<div class="card">
<h1>Ket noi may chu CMS</h1>
<p>Nhap IP va port giao dien (thuong 8080) cua may server USB.</p>
<label>Dia chi IP / host</label>
<input id="host" placeholder="192.168.1.10" autocomplete="off">
<label>Port</label>
<input id="port" type="number" value="8080" min="1" max="65535">
<div class="row">
<button class="ghost" id="local" type="button">May nay</button>
<button class="ok" id="go" type="button">Ket noi</button>
</div>
<p class="err" id="err"></p>
</div>
<script>
function err(t){document.getElementById('err').textContent=t||''}
async function ready(){
  const api=window.pywebview&&window.pywebview.api
  if(!api){err('WebView chua san sang');return}
  document.getElementById('go').onclick=async()=>{
    err('')
    const r=await api.save_server(document.getElementById('host').value, document.getElementById('port').value)
    if(!r||!r.ok) err((r&&r.error)||'Khong ket noi duoc server')
  }
  document.getElementById('local').onclick=async()=>{
    err('')
    const r=await api.use_local()
    if(!r||!r.ok) err((r&&r.error)||'Khong thay CMS tren may nay')
  }
}
window.addEventListener('pywebviewready', ready)
if(window.pywebview&&window.pywebview.api) ready()
</script>
</body></html>
"""


class DesktopApi:
    def raise_on_alarm(self) -> bool:
        try:
            import webview
        except ImportError:
            return False
        for win in webview.windows:
            try:
                win.restore()
            except Exception:
                pass
            try:
                win.show()
            except Exception:
                pass
            try:
                win.maximize()
            except Exception:
                pass
        return True

    def set_title(self, title: str) -> bool:
        text = str(title or "").strip()[:80] or TITLE
        try:
            import webview
        except ImportError:
            return False
        for win in webview.windows:
            try:
                win.set_title(text)
            except Exception:
                try:
                    win.title = text
                except Exception:
                    pass
        return True

    def refresh_branding(self, title: str = "") -> bool:
        text = str(title or "").strip()[:80]
        if not text:
            text, icon = load_site_branding()
        else:
            _, icon = load_site_branding()
        self.set_title(text)
        if icon is not None:
            _apply_window_icon(icon)
        return True

    def save_server(self, host: str, port: object) -> dict:
        parsed = parse_host_port(host, port)
        if not parsed or parsed[1] < 1:
            return {"ok": False, "error": "IP hoac port khong hop le"}
        name, p = parsed
        url = remote_url(name, p)
        if not looks_like_spa_url(url, timeout=4.0):
            return {"ok": False, "error": "Khong thay giao dien CMS tai dia chi nay"}
        save_client_config({"mode": "client", "host": name, "port": p})
        self._load(with_cache_bust(url))
        return {"ok": True, "url": url}

    def use_local(self) -> dict:
        api, ui = load_desktop_ports()
        url = choose_ui_url(api, ui, timeout=6.0)
        if not url:
            return {"ok": False, "error": "Khong thay CMS tren may nay"}
        save_client_config({"mode": "local"})
        self._load(with_cache_bust(url))
        return {"ok": True, "url": url}

    def _load(self, url: str) -> None:
        try:
            import webview
        except ImportError:
            return
        if webview.windows:
            webview.windows[0].load_url(url)


def _apply_window_icon(ico: Path) -> None:
    if not ico.is_file():
        return
    try:
        import webview
    except ImportError:
        return
    for win in webview.windows:
        form = getattr(win, "native", None)
        if form is None:
            continue
        try:
            from System.Drawing import Icon

            icon = Icon(str(ico))

            def _set(form=form, icon=icon):
                form.Icon = icon

            if getattr(form, "InvokeRequired", False):
                form.Invoke(_set)
            else:
                _set()
        except Exception:
            pass


def open_webview(url: str | None) -> bool:
    try:
        import webview
    except ImportError:
        return False
    appdata = os.environ.get("APPDATA", "")
    storage = Path(appdata) / "JablotronCMS" / "webview" if appdata else BACKEND / "data" / "webview"
    try:
        storage.mkdir(parents=True, exist_ok=True)
    except OSError:
        storage = None
    title, icon = load_site_branding()
    window_kwargs: dict = {
        "title": title,
        "width": 1440,
        "height": 900,
        "min_size": (1024, 700),
        "js_api": DesktopApi(),
    }
    if url:
        window_kwargs["url"] = url
    else:
        window_kwargs["html"] = connect_html()
    webview.create_window(**window_kwargs)
    start_kwargs: dict = {"private_mode": False}
    if storage is not None:
        clear_webview_http_cache(storage)
        start_kwargs["storage_path"] = str(storage)
    if icon is not None:
        start_kwargs["icon"] = str(icon)
    if sys.platform == "win32":
        start_kwargs["gui"] = "edgechromium"
    try:
        webview.start(**start_kwargs)
        return True
    except Exception:
        if "gui" in start_kwargs:
            start_kwargs.pop("gui", None)
            try:
                webview.start(**start_kwargs)
                return True
            except Exception:
                return False
        return False


def resolve_start_url() -> str | None:
    saved = client_saved_url()
    if saved:
        return with_cache_bust(saved)
    api, ui = load_desktop_ports()
    wait_health(api, timeout=8.0)
    url = choose_ui_url(api, ui, timeout=8.0)
    return with_cache_bust(url) if url else None


def main() -> int:
    url = resolve_start_url()
    if open_webview(url):
        return 0 if url else 0
    if url and open_edge_app(url):
        return 0
    if url:
        import webbrowser

        webbrowser.open(url)
        return 0
    print("CMS UI not found — open connect form requires pywebview", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
