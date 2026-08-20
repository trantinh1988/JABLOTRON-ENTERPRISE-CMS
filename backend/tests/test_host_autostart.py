"""Windows Startup folder autostart helpers."""

from types import SimpleNamespace

from app.iot_core import host_autostart as host


def _ok(stdout: str = "", stderr: str = "") -> SimpleNamespace:
    return SimpleNamespace(returncode=0, stdout=stdout, stderr=stderr)


def _fail(stderr: str = "denied") -> SimpleNamespace:
    return SimpleNamespace(returncode=1, stdout="", stderr=stderr)


def test_windows_status_enabled_via_startup_file(monkeypatch, tmp_path):
    cmd = tmp_path / "JablotronCMS.cmd"
    cmd.write_text("@echo off\n", encoding="utf-8")
    monkeypatch.setattr(host, "current_os", lambda: "windows")
    monkeypatch.setattr(host, "windows_startup_cmd", lambda: cmd)
    monkeypatch.setattr(host, "_run", lambda *a, **k: _fail())
    monkeypatch.setattr(host, "_docker_ok", lambda: True)
    state = host.get_host_status()
    assert state["os"] == "windows"
    assert state["autostart_supported"] is True
    assert state["autostart_enabled"] is True
    assert "start-cms-windows.ps1" in state["start_script"]


def test_windows_enable_writes_startup_cmd(monkeypatch, tmp_path):
    script = tmp_path / "start-cms-windows.ps1"
    script.write_text("# start\n", encoding="utf-8")
    cmd = tmp_path / "Startup" / "JablotronCMS.cmd"
    vbs = tmp_path / "Startup" / "JablotronCMS.vbs"
    monkeypatch.setattr(host, "current_os", lambda: "windows")
    monkeypatch.setattr(host, "start_script", lambda: script)
    monkeypatch.setattr(host, "windows_startup_cmd", lambda: cmd)
    monkeypatch.setattr(host, "windows_startup_vbs", lambda: vbs)
    monkeypatch.setattr(host, "_run", lambda *a, **k: _fail("Access is denied."))
    monkeypatch.setattr(host, "_docker_ok", lambda: False)
    state = host.set_autostart(True)
    assert state["ok"] is True
    assert cmd.is_file()
    assert vbs.is_file()
    body = cmd.read_text(encoding="utf-8")
    assert "start-cms-windows.ps1" in body
    assert "SystemRoot" in body
    assert state["autostart_enabled"] is True


def test_windows_disable_removes_startup_cmd(monkeypatch, tmp_path):
    cmd = tmp_path / "JablotronCMS.cmd"
    vbs = tmp_path / "JablotronCMS.vbs"
    cmd.write_text("@echo off\n", encoding="utf-8")
    vbs.write_text("' vbs\n", encoding="utf-8")
    monkeypatch.setattr(host, "current_os", lambda: "windows")
    monkeypatch.setattr(host, "windows_startup_cmd", lambda: cmd)
    monkeypatch.setattr(host, "windows_startup_vbs", lambda: vbs)
    monkeypatch.setattr(host, "_run", lambda *a, **k: _ok())
    monkeypatch.setattr(host, "_docker_ok", lambda: None)
    state = host.set_autostart(False)
    assert state["ok"] is True
    assert not cmd.exists()
    assert not vbs.exists()


def test_linux_autostart_unsupported(monkeypatch):
    monkeypatch.setattr(host, "current_os", lambda: "linux")
    monkeypatch.setattr(host, "_docker_ok", lambda: None)
    state = host.set_autostart(True)
    assert state["ok"] is False
    assert state["autostart_supported"] is False
    assert state["detail"] == "autostart_unsupported"


def test_windows_enable_fails_without_script(monkeypatch, tmp_path):
    missing = tmp_path / "nope.ps1"
    cmd = tmp_path / "JablotronCMS.cmd"
    vbs = tmp_path / "JablotronCMS.vbs"
    monkeypatch.setattr(host, "current_os", lambda: "windows")
    monkeypatch.setattr(host, "start_script", lambda: missing)
    monkeypatch.setattr(host, "windows_startup_cmd", lambda: cmd)
    monkeypatch.setattr(host, "windows_startup_vbs", lambda: vbs)
    monkeypatch.setattr(host, "_docker_ok", lambda: None)
    monkeypatch.setattr(host, "_windows_enabled", lambda: False)
    state = host.set_autostart(True)
    assert state["ok"] is False
    assert state["detail"] == "missing_start_script"
