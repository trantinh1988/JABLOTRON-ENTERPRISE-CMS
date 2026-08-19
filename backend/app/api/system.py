from __future__ import annotations

import asyncio
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.core.config import get_settings
from app.core.deps import RequireWriteLicense
from app.iot_core.host_autostart import get_host_status, set_autostart
from app.iot_core.host_ports import (
    apply_saved_ports,
    load_ports,
    ports_status,
    save_ports,
    stop_current_backend,
    validate_ports,
)
from app.iot_core.system_backup import (
    BackupError,
    MAX_ZIP_BYTES,
    apply_restored_runtime,
    build_archive,
    current_inventory,
    restore_archive,
)
from app.iot_core.system_sounds import (
    ALERT_SOUND_STATUSES,
    delete_alert_sound,
    ensure_alert_sounds_dir,
    get_system_settings,
    patch_system_settings,
    save_alert_sound,
)
from app.iot_core.usb_manager import get_usb_manager
from app.schemas.common import (
    BackupInfoOut,
    BackupRestoreOut,
    HostAutostartIn,
    HostPortsIn,
    HostPortsOut,
    HostServiceOut,
    SystemSettingsOut,
    SystemSettingsPatchIn,
)

router = APIRouter(prefix="/api/system", tags=["system"])

_ERRORS = {
    "bad_status": "Trạng thái không hợp lệ.",
    "empty": "File âm thanh trống.",
    "too_big": "File vượt quá 2MB.",
    "bad_type": "Chỉ hỗ trợ MP3, WAV, OGG, M4A hoặc WEBM.",
}

_BACKUP_ERRORS = {
    "not_zip": "File không phải ZIP backup.",
    "not_backup": "File ZIP không phải bản backup CMS.",
    "unsupported_version": "Phiên bản backup không hỗ trợ.",
    "missing_db": "Backup thiếu cơ sở dữ liệu hệ thống.",
    "unsafe_path": "File backup không hợp lệ.",
    "corrupt": "File backup bị hỏng.",
    "empty": "File backup trống.",
    "too_big": "File backup vượt quá 512MB.",
    "sqlite_missing": "Không tìm thấy cơ sở dữ liệu CMS.",
}


def _to_out(state: dict) -> SystemSettingsOut:
    return SystemSettingsOut.model_validate(state)


@router.get("/settings", response_model=SystemSettingsOut)
async def read_system_settings() -> SystemSettingsOut:
    return _to_out(get_system_settings())


@router.patch("/settings", response_model=SystemSettingsOut)
async def update_system_settings(body: SystemSettingsPatchIn, _: RequireWriteLicense) -> SystemSettingsOut:
    return _to_out(
        patch_system_settings(
            sound_enabled=body.sound_enabled,
            trail_enabled=body.trail_enabled,
            site_title=body.site_title,
        )
    )


@router.post("/sounds/{status}", response_model=SystemSettingsOut)
async def upload_alert_sound(
    status: str,
    _: RequireWriteLicense,
    file: UploadFile = File(...),
) -> SystemSettingsOut:
    key = status.lower().strip()
    if key not in ALERT_SOUND_STATUSES:
        raise HTTPException(status_code=404, detail=_ERRORS["bad_status"])
    raw = await file.read()
    try:
        state = save_alert_sound(key, file.filename or "sound", file.content_type or "", raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_ERRORS.get(str(exc), _ERRORS["bad_type"])) from exc
    return _to_out(state)


@router.delete("/sounds/{status}", response_model=SystemSettingsOut)
async def remove_alert_sound(status: str, _: RequireWriteLicense) -> SystemSettingsOut:
    key = status.lower().strip()
    if key not in ALERT_SOUND_STATUSES:
        raise HTTPException(status_code=404, detail=_ERRORS["bad_status"])
    return _to_out(delete_alert_sound(key))


def media_dir() -> Path:
    return ensure_alert_sounds_dir()


def _host_out(state: dict) -> HostServiceOut:
    usb = get_usb_manager().get_status()
    settings = get_settings()
    return HostServiceOut(
        ok=bool(state.get("ok", True)),
        os=str(state.get("os") or "other"),
        autostart_supported=bool(state.get("autostart_supported")),
        autostart_enabled=bool(state.get("autostart_enabled")),
        autostart_label=str(state.get("autostart_label") or ""),
        start_script=str(state.get("start_script") or ""),
        docker_ok=state.get("docker_ok"),
        usb_mock_mode=settings.usb_mock_mode,
        usb_hid_available=bool(usb.get("hid_available")),
        usb_devices_found=int(usb.get("devices_found") or 0),
        usb_panels_connected=int(usb.get("panels_usb_connected") or 0),
        usb_last_error=usb.get("last_error"),
        detail=state.get("detail"),
    )


@router.get("/host", response_model=HostServiceOut)
async def read_host_service() -> HostServiceOut:
    return _host_out(get_host_status())


@router.post("/host/autostart", response_model=HostServiceOut)
async def update_host_autostart(body: HostAutostartIn, _: RequireWriteLicense) -> HostServiceOut:
    state = set_autostart(body.enabled)
    out = _host_out(state)
    if not out.ok:
        raise HTTPException(status_code=409, detail=out.detail or "autostart_failed")
    return out


@router.post("/host/usb-reconnect", response_model=HostServiceOut)
async def reconnect_host_usb(_: RequireWriteLicense) -> HostServiceOut:
    result = await get_usb_manager().reconnect_hid()
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=str(result.get("error") or "usb_reconnect_failed"))
    return _host_out(get_host_status())


_PORT_ERRORS = {
    "invalid_port": "Port phải từ 1024 đến 65535.",
    "ports_equal": "Port UI và Port API phải khác nhau.",
}


@router.get("/ports", response_model=HostPortsOut)
async def read_host_ports() -> HostPortsOut:
    return HostPortsOut.model_validate(ports_status())


@router.put("/ports", response_model=HostPortsOut)
async def update_host_ports(
    body: HostPortsIn,
    _: RequireWriteLicense,
    background_tasks: BackgroundTasks,
) -> HostPortsOut:
    err = validate_ports(body.ui_port, body.api_port)
    if err:
        raise HTTPException(status_code=400, detail=_PORT_ERRORS.get(err, err))
    prev_api = load_ports()["api_port"]
    save_ports(body.ui_port, body.api_port)
    out = apply_saved_ports(prev_api)
    if body.api_port != prev_api and out.get("applied"):
        background_tasks.add_task(stop_current_backend)
    return HostPortsOut.model_validate(out)


def _backup_http(err: BackupError) -> HTTPException:
    key = str(err)
    return HTTPException(status_code=400, detail=_BACKUP_ERRORS.get(key, "Không dùng được file backup này."))


def _unlink_quiet(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


@router.get("/backup/info", response_model=BackupInfoOut)
async def backup_info() -> BackupInfoOut:
    return BackupInfoOut.model_validate(await asyncio.to_thread(current_inventory))


@router.get("/backup")
async def download_backup(_: RequireWriteLicense) -> FileResponse:
    handle = tempfile.NamedTemporaryFile(prefix="cms-backup-", suffix=".zip", delete=False)
    path = Path(handle.name)
    handle.close()
    try:
        await asyncio.to_thread(build_archive, path)
    except BackupError as exc:
        _unlink_quiet(path)
        raise _backup_http(exc) from exc
    except Exception:
        _unlink_quiet(path)
        raise
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"jablotron-cms-backup_{stamp}.zip",
        background=BackgroundTask(_unlink_quiet, path),
    )


@router.post("/backup/restore", response_model=BackupRestoreOut)
async def restore_backup(
    _: RequireWriteLicense,
    file: UploadFile = File(...),
) -> BackupRestoreOut:
    name = (file.filename or "").lower()
    if name and not name.endswith(".zip"):
        raise HTTPException(status_code=400, detail=_BACKUP_ERRORS["not_zip"])
    handle = tempfile.NamedTemporaryFile(prefix="cms-restore-", suffix=".zip", delete=False)
    dest = Path(handle.name)
    handle.close()
    try:
        size = 0
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_ZIP_BYTES:
                    raise BackupError("too_big")
                out.write(chunk)
        if size <= 0:
            raise BackupError("empty")
        inventory = await asyncio.to_thread(restore_archive, dest)
        await apply_restored_runtime()
    except BackupError as exc:
        raise _backup_http(exc) from exc
    finally:
        _unlink_quiet(dest)
    return BackupRestoreOut.model_validate({**inventory, "ok": True})
