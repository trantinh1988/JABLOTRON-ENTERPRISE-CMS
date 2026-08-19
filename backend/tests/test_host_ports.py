"""Port UI / API persistence and nginx generation."""

from pathlib import Path

from app.iot_core import host_ports as hp


def test_defaults_when_missing(tmp_path: Path):
    hp.set_ports_path(tmp_path / "missing.json")
    try:
        state = hp.load_ports()
        assert state["ui_port"] == 8080
        assert state["api_port"] == 8010
    finally:
        hp.set_ports_path(None)


def test_save_and_load(tmp_path: Path):
    hp.set_ports_path(tmp_path / "host_ports.json")
    try:
        saved = hp.save_ports(9090, 8011)
        assert saved == {"ui_port": 9090, "api_port": 8011}
        assert hp.load_ports() == saved
    finally:
        hp.set_ports_path(None)


def test_reject_same_and_range():
    assert hp.validate_ports(8080, 8080) == "ports_equal"
    assert hp.validate_ports(80, 8010) == "invalid_port"
    assert hp.validate_ports(8080, 8010) is None


def test_nginx_windows_bridge():
    text = hp._nginx_conf(ui_port=9090, api_port=8011, hostnet=False)
    assert "listen 80;" in text
    assert "host.docker.internal:8011" in text
    assert "9090" in text.split("\n")[0]
    assert "location /api/system/backup" in text
    assert "client_max_body_size 256m;" in text
    assert "proxy_pass http://host.docker.internal:8011;" in text
    assert "proxy_pass http://host.docker.internal:8011/api/;" not in text


def test_docker_backend_does_not_rewrite_host_nginx(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("CMS_IN_DOCKER", "1")
    hp.set_ports_path(tmp_path / "host_ports.json")
    nginx = tmp_path / "nginx-ui.conf"
    monkeypatch.setattr(hp, "nginx_runtime_path", lambda: nginx)
    try:
        hp.write_runtime_files(8080, 8010)
        assert not nginx.exists()
    finally:
        hp.set_ports_path(None)
        monkeypatch.delenv("CMS_IN_DOCKER", raising=False)


def test_nginx_linux_hostnet():
    text = hp._nginx_conf(ui_port=9090, api_port=8011, hostnet=True)
    assert "listen 9090;" in text
    assert "127.0.0.1:8011" in text
    assert "host.docker.internal" not in text
    assert "proxy_pass http://127.0.0.1:8011;" in text
    assert "proxy_pass http://127.0.0.1:8011/api/;" not in text


def test_replace_runtime_file_removes_docker_leftover_dir(tmp_path: Path):
    leftover = tmp_path / "nginx-ui.conf"
    leftover.mkdir()
    (leftover / "stale").write_text("x", encoding="utf-8")
    hp._replace_runtime_file(leftover, "ok\n", "utf-8")
    assert leftover.is_file()
    assert leftover.read_text(encoding="utf-8") == "ok\n"


def test_cors_includes_ui_port():
    origins = hp.cors_origins(9090)
    assert "http://127.0.0.1:9090" in origins
    assert "http://localhost:5173" in origins
