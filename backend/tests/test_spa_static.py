"""SPA attach is optional and must not swallow API 404s."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.iot_core import spa_static as spa


def _dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>cms-shell</html>", encoding="utf-8")
    assets = dist / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("ok-js", encoding="utf-8")
    return dist


def test_missing_dist_is_none(tmp_path, monkeypatch):
    monkeypatch.setenv("CMS_SPA_DIST", str(tmp_path / "nope"))
    monkeypatch.delenv("CMS_SPA_DISABLED", raising=False)
    assert spa.spa_dist_dir() is None


def test_disabled_wins_over_dist(tmp_path, monkeypatch):
    dist = _dist(tmp_path)
    monkeypatch.setenv("CMS_SPA_DIST", str(dist))
    monkeypatch.setenv("CMS_SPA_DISABLED", "1")
    assert spa.spa_dist_dir() is None
    app = FastAPI()
    assert spa.mount_spa(app) is False


def test_reserved_paths():
    assert spa.is_reserved_path("/api/health") is True
    assert spa.is_reserved_path("/api") is True
    assert spa.is_reserved_path("/ws/events") is True
    assert spa.is_reserved_path("/media/alert-sounds/x.wav") is True
    assert spa.is_reserved_path("/media/brand/logo.png") is True
    assert spa.is_reserved_path("/docs") is True
    assert spa.is_reserved_path("/devices") is False
    assert spa.is_reserved_path("/") is False


def test_path_traversal_blocked(tmp_path):
    dist = _dist(tmp_path)
    secret = tmp_path / "secret.txt"
    secret.write_text("nope", encoding="utf-8")
    assert spa.safe_dist_file(dist, "../secret.txt") is None
    assert spa.safe_dist_file(dist, "assets/app.js") == (dist / "assets" / "app.js").resolve()


def test_spa_does_not_steal_api(tmp_path, monkeypatch):
    dist = _dist(tmp_path)
    monkeypatch.setenv("CMS_SPA_DIST", str(dist))
    monkeypatch.delenv("CMS_SPA_DISABLED", raising=False)
    app = FastAPI()

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    assert spa.mount_spa(app) is True
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    missing = client.get("/api/definitely-missing")
    assert missing.status_code == 404
    assert "cms-shell" not in missing.text
    assert "cms-shell" in client.get("/").text
    assert "cms-shell" in client.get("/devices").text
    assert client.get("/assets/app.js").text == "ok-js"
    docs = client.get("/docs")
    assert docs.status_code == 200
    assert "cms-shell" not in docs.text


def test_spa_does_not_steal_media_brand(tmp_path, monkeypatch):
    from fastapi.staticfiles import StaticFiles

    dist = _dist(tmp_path)
    brand = tmp_path / "brand"
    brand.mkdir()
    png = b"\x89PNG\r\n\x1a\n" + b"logo"
    (brand / "logo.png").write_bytes(png)
    monkeypatch.setenv("CMS_SPA_DIST", str(dist))
    monkeypatch.delenv("CMS_SPA_DISABLED", raising=False)
    app = FastAPI()
    app.mount("/media/brand", StaticFiles(directory=str(brand)), name="brand")
    assert spa.mount_spa(app) is True
    client = TestClient(app)
    res = client.get("/media/brand/logo.png")
    assert res.status_code == 200
    assert res.content == png
    missing = client.get("/media/brand/nope.png")
    assert missing.status_code == 404
    assert "cms-shell" not in missing.text


def test_lazy_dist_without_restart(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    monkeypatch.setenv("CMS_SPA_DIST", str(dist))
    monkeypatch.delenv("CMS_SPA_DISABLED", raising=False)
    app = FastAPI()
    assert spa.mount_spa(app) is True
    client = TestClient(app)
    assert client.get("/").status_code == 404
    dist.mkdir()
    (dist / "index.html").write_text("<html>late</html>", encoding="utf-8")
    assert "late" in client.get("/").text


def test_index_cache_control_no_store(tmp_path, monkeypatch):
    dist = _dist(tmp_path)
    monkeypatch.setenv("CMS_SPA_DIST", str(dist))
    monkeypatch.delenv("CMS_SPA_DISABLED", raising=False)
    app = FastAPI()
    assert spa.mount_spa(app) is True
    client = TestClient(app)
    res = client.get("/")
    assert res.status_code == 200
    assert "no-store" in (res.headers.get("cache-control") or "").lower()
