"""Desktop URL helper — no GUI."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHELL = ROOT / "desktop" / "cms_shell.py"


def _load():
    spec = importlib.util.spec_from_file_location("cms_shell", SHELL)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_desktop_url_uses_api_port():
    shell = _load()
    assert shell.desktop_url(8010) == "http://127.0.0.1:8010/"
    assert shell.desktop_url(9090) == "http://127.0.0.1:9090/"


def test_choose_ui_url_prefers_api_then_ui():
    shell = _load()
    shell.looks_like_spa = lambda port, timeout=2.0: port == 8010
    assert shell.choose_ui_url(8010, 8080, timeout=0) == "http://127.0.0.1:8010/"
    shell.looks_like_spa = lambda port, timeout=2.0: port == 8080
    assert shell.choose_ui_url(8010, 8080, timeout=0) == "http://127.0.0.1:8080/"
    shell.looks_like_spa = lambda port, timeout=2.0: False
    assert shell.choose_ui_url(8010, 8080, timeout=0) is None


def test_normalize_host_and_parse():
    shell = _load()
    assert shell.normalize_host("http://192.168.1.10:8080/path") == "192.168.1.10:8080"
    assert shell.normalize_host("cms-server") == "cms-server"
    assert shell.normalize_host("bad host") is None
    assert shell.parse_host_port("192.168.1.10", 8080) == ("192.168.1.10", 8080)
    assert shell.parse_host_port("192.168.1.10:9090", 8080) == ("192.168.1.10", 9090)


def test_png_bytes_to_ico():
    shell = _load()
    png = b"\x89PNG\r\n\x1a\n" + b"logo-bytes"
    ico = shell.png_bytes_to_ico(png)
    assert ico[:6] == b"\x00\x00\x01\x00\x01\x00"
    assert ico.endswith(png)


def test_logo_file_to_ico_png(tmp_path, monkeypatch):
    shell = _load()
    monkeypatch.setenv("APPDATA", str(tmp_path))
    src = tmp_path / "mark.png"
    src.write_bytes(b"\x89PNG\r\n\x1a\n" + b"xyz")
    out = shell.logo_file_to_ico(src)
    assert out is not None
    assert out.is_file()
    assert out.read_bytes().endswith(b"\x89PNG\r\n\x1a\nxyz")
