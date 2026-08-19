"""Khởi động CMS cùng Windows (thư mục Startup) hoặc Linux (systemd --user).

Task Scheduler ONLOGON thường bị Access is denied nếu CMS không chạy Admin.
Thư mục Startup của user không cần Admin — phù hợp máy trạm vận hành.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from app.core.config import REPO_ROOT

WINDOWS_TASK = "JablotronCMS"
WINDOWS_STARTUP_NAME = "JablotronCMS.cmd"
WINDOWS_STARTUP_VBS = "JablotronCMS.vbs"
LINUX_UNIT = "jablotron-cms.service"


def current_os() -> str:
    if sys.platform == "win32":
        return "windows"
    if sys.platform.startswith("linux"):
        return "linux"
    return "other"


def start_script() -> Path:
    if current_os() == "windows":
        return REPO_ROOT / "scripts" / "start-cms-windows.ps1"
    return REPO_ROOT / "scripts" / "start-cms-linux.sh"


def linux_unit_path() -> Path:
    return Path.home() / ".config" / "systemd" / "user" / LINUX_UNIT


def windows_startup_dir() -> Path:
    appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def windows_startup_cmd() -> Path:
    return windows_startup_dir() / WINDOWS_STARTUP_NAME


def windows_startup_vbs() -> Path:
    return windows_startup_dir() / WINDOWS_STARTUP_VBS


def _run(args: list[str], timeout: int = 45) -> subprocess.CompletedProcess[str]:
    kwargs: dict[str, Any] = {
        "capture_output": True,
        "text": True,
        "timeout": timeout,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(args, **kwargs)


def _docker_ok() -> bool | None:
    # Do not run `docker info` on the HTTP request path: on Windows it can hang
    # the asyncio loop and nginx then returns 502 for every /api and /ws call.
    return None


def _windows_task_command() -> str:
    script = start_script()
    return (
        "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass "
        f'-File "{script}"'
    )


def _windows_startup_cmd_text() -> str:
    root = REPO_ROOT
    script = start_script()
    return (
        "@echo off\r\n"
        "set CMS_AUTOSTART=1\r\n"
        f'cd /d "{root}"\r\n'
        "if not exist logs mkdir logs\r\n"
        "echo %DATE% %TIME% startup-cmd begin>> logs\\autostart.log\r\n"
        '"%SystemRoot%\\System32\\timeout.exe" /t 45 /nobreak >nul\r\n'
        '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" '
        "-NoProfile -ExecutionPolicy Bypass "
        f'-File "{script}"\r\n'
        "echo %DATE% %TIME% startup-cmd end>> logs\\autostart.log\r\n"
    )


def _windows_startup_vbs_text() -> str:
    script = str(start_script()).replace("\\", "\\\\")
    return (
        'Set sh = CreateObject("WScript.Shell")\r\n'
        'sh.Environment("Process")("CMS_AUTOSTART") = "1"\r\n'
        'ps = sh.ExpandEnvironmentStrings("%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")\r\n'
        f'cmd = """" & ps & """ -NoProfile -ExecutionPolicy Bypass -File ""{script}"""\r\n'
        "sh.Run cmd, 0, False\r\n"
    )


def _windows_enabled() -> bool:
    if windows_startup_cmd().is_file() or windows_startup_vbs().is_file():
        return True
    try:
        proc = _run(["schtasks", "/Query", "/TN", WINDOWS_TASK])
    except (OSError, subprocess.TimeoutExpired):
        return False
    return proc.returncode == 0


def _linux_enabled() -> bool:
    try:
        proc = _run(["systemctl", "--user", "is-enabled", LINUX_UNIT], timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        return linux_unit_path().is_file()
    return proc.returncode == 0


def _linux_unit_text() -> str:
    script = start_script().as_posix()
    return (
        "[Unit]\n"
        "Description=Jablotron CMS (USB host backend + Docker UI)\n"
        "After=default.target\n"
        "\n"
        "[Service]\n"
        "Type=oneshot\n"
        "RemainAfterExit=yes\n"
        "TimeoutStartSec=180\n"
        f"ExecStart=/bin/bash {script}\n"
        "\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )


def get_host_status(*, detail: str | None = None, ok: bool = True) -> dict[str, Any]:
    os_name = current_os()
    supported = os_name in ("windows", "linux")
    enabled = False
    if os_name == "windows":
        enabled = _windows_enabled()
    elif os_name == "linux":
        enabled = _linux_enabled()
    label = {
        "windows": "Khởi động cùng Windows (khi đăng nhập)",
        "linux": "Khởi động cùng phiên Linux (systemd --user)",
        "other": "Hệ điều hành này chưa hỗ trợ autostart",
    }[os_name]
    return {
        "ok": ok,
        "os": os_name,
        "autostart_supported": supported,
        "autostart_enabled": enabled,
        "autostart_label": label,
        "start_script": str(start_script()),
        "docker_ok": _docker_ok(),
        "detail": detail,
    }


def set_autostart(enabled: bool) -> dict[str, Any]:
    os_name = current_os()
    if os_name == "windows":
        return _set_windows(enabled)
    if os_name == "linux":
        return _set_linux(enabled)
    return get_host_status(ok=False, detail="autostart_unsupported")


def _try_register_logon_task(enabled: bool) -> None:
    """Current-user AtLogOn task — often works without Admin (schtasks /Create does not)."""
    script = str(start_script())
    exe = str(
        Path(os.environ.get("SystemRoot", r"C:\Windows"))
        / "System32"
        / "WindowsPowerShell"
        / "v1.0"
        / "powershell.exe"
    )
    if enabled:
        ps = (
            f"$exe = '{exe.replace(chr(39), chr(39)+chr(39))}'; "
            f"$arg = '-NoProfile -ExecutionPolicy Bypass -File \"{script}\"'; "
            "$action = New-ScheduledTaskAction -Execute $exe -Argument $arg; "
            "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; "
            "$trigger.Delay = 'PT45S'; "
            "$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME "
            "-LogonType Interactive -RunLevel Limited; "
            "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries "
            "-DontStopIfGoingOnBatteries -StartWhenAvailable "
            "-ExecutionTimeLimit ([TimeSpan]::Zero); "
            f"Register-ScheduledTask -TaskName '{WINDOWS_TASK}' -Action $action "
            "-Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null"
        )
    else:
        ps = (
            f"Unregister-ScheduledTask -TaskName '{WINDOWS_TASK}' "
            "-Confirm:$false -ErrorAction SilentlyContinue"
        )
    try:
        _run([exe, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], timeout=40)
    except (OSError, subprocess.TimeoutExpired):
        return


def _set_windows(enabled: bool) -> dict[str, Any]:
    script = start_script()
    cmd_path = windows_startup_cmd()
    vbs_path = windows_startup_vbs()
    if enabled:
        if not script.is_file():
            return get_host_status(ok=False, detail="missing_start_script")
        try:
            cmd_path.parent.mkdir(parents=True, exist_ok=True)
            cmd_path.write_text(_windows_startup_cmd_text(), encoding="ascii", errors="replace")
            vbs_path.write_text(_windows_startup_vbs_text(), encoding="ascii", errors="replace")
        except OSError as exc:
            return get_host_status(ok=False, detail=str(exc)[:400])
        _try_register_logon_task(True)
        if not cmd_path.is_file() and not vbs_path.is_file():
            return get_host_status(ok=False, detail="startup_write_failed")
        return get_host_status()

    try:
        cmd_path.unlink(missing_ok=True)
        vbs_path.unlink(missing_ok=True)
    except OSError as exc:
        return get_host_status(ok=False, detail=str(exc)[:400])
    _try_register_logon_task(False)
    return get_host_status()


def _set_linux(enabled: bool) -> dict[str, Any]:
    script = start_script()
    unit = linux_unit_path()
    if enabled:
        if not script.is_file():
            return get_host_status(ok=False, detail="missing_start_script")
        unit.parent.mkdir(parents=True, exist_ok=True)
        unit.write_text(_linux_unit_text(), encoding="utf-8")
        reload_proc = _run(["systemctl", "--user", "daemon-reload"], timeout=15)
        if reload_proc.returncode != 0:
            err = (reload_proc.stderr or reload_proc.stdout or "daemon_reload_failed").strip()[:400]
            return get_host_status(ok=False, detail=err)
        proc = _run(["systemctl", "--user", "enable", LINUX_UNIT], timeout=15)
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "systemctl_enable_failed").strip()[:400]
            return get_host_status(ok=False, detail=err)
        return get_host_status()

    _run(["systemctl", "--user", "disable", LINUX_UNIT], timeout=15)
    try:
        unit.unlink(missing_ok=True)
    except OSError as exc:
        return get_host_status(ok=False, detail=str(exc)[:400])
    _run(["systemctl", "--user", "daemon-reload"], timeout=15)
    return get_host_status()
