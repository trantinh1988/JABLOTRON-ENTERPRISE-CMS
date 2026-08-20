from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from typing import Any

from app.api import automation, cameras, events, license, maps, panels, system, usb, ws
from app.api.maps import ensure_map_bg_dir
from app.iot_core.automation_engine import (
    ensure_alarm_snap_dir,
    get_automation_engine,
    register_automation_engine,
)
from app.iot_core.camera_service import ensure_camera_thumb_dir
from app.core.config import get_settings
from app.db.session import init_db
from app.iot_core.event_store import register_event_persistence, trim_history_events
from app.iot_core.panel_bus import get_panel_bus
from app.iot_core.panel_store import load_panels_into_bus
from app.iot_core.spa_static import mount_spa
from app.iot_core.usb_manager import get_usb_manager
from app.license_manager.service import get_license_service
from app.schemas.common import HealthOut


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    await trim_history_events()
    register_event_persistence()
    register_automation_engine()
    await get_automation_engine().reload()
    license_service = get_license_service()
    await license_service.load_from_db()
    await load_panels_into_bus(get_panel_bus())
    usb_mgr = get_usb_manager()
    await usb_mgr.start()
    _log_usb_startup(usb_mgr)
    try:
        from app.iot_core.host_ports import ensure_runtime_files

        ensure_runtime_files()
    except OSError:
        pass
    try:
        yield
    finally:
        await usb_mgr.stop()


def _log_usb_startup(_usb_mgr: Any) -> None:
    import logging

    settings = get_settings()
    log = logging.getLogger("uvicorn.error")
    log.info(
        "USB manager started (mock=%s). Quét nền mỗi %ss — xem /api/usb/status",
        settings.usb_mock_mode,
        settings.usb_scan_interval_sec,
    )


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan, redirect_slashes=False)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-License-Mode", "X-License-Status"],
    )

    @app.middleware("http")
    async def license_headers(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        response = await call_next(request)
        status_info = get_license_service().get_status()
        response.headers["X-License-Mode"] = status_info.mode
        response.headers["X-License-Status"] = status_info.status
        return response

    @app.get("/api/health", response_model=HealthOut, tags=["system"])
    async def health() -> HealthOut:
        settings = get_settings()
        lic = get_license_service().get_status()
        usb_status = get_usb_manager().get_status()
        return HealthOut(
            status="ok",
            app=settings.app_name,
            license_mode=lic.mode,
            usb_mock_mode=settings.usb_mock_mode,
            usb_hid_available=bool(usb_status["hid_available"]),
            usb_devices_found=int(usb_status["devices_found"]),
            usb_panels_connected=int(usb_status["panels_usb_connected"]),
            usb_last_error=usb_status["last_error"],
            usb_hint=usb_status["hint"],
        )

    app.include_router(license.router)
    app.include_router(usb.router)
    app.include_router(panels.router)
    app.include_router(panels.devices_router)
    app.include_router(maps.router)
    app.include_router(events.router)
    app.include_router(cameras.router)
    app.include_router(automation.router)
    app.include_router(system.router)
    app.include_router(ws.router)

    map_bg_dir = ensure_map_bg_dir()
    app.mount(
        "/media/map-backgrounds",
        StaticFiles(directory=str(map_bg_dir)),
        name="map_backgrounds",
    )
    thumb_dir = ensure_camera_thumb_dir()
    app.mount(
        "/media/camera-thumbs",
        StaticFiles(directory=str(thumb_dir)),
        name="camera_thumbs",
    )
    snap_dir = ensure_alarm_snap_dir()
    app.mount(
        "/media/alarm-snaps",
        StaticFiles(directory=str(snap_dir)),
        name="alarm_snaps",
    )
    map_snap_dir = maps.ensure_map_snap_dir()
    app.mount(
        "/media/map-snaps",
        StaticFiles(directory=str(map_snap_dir)),
        name="map_snaps",
    )
    alert_sound_dir = system.media_dir()
    app.mount(
        "/media/alert-sounds",
        StaticFiles(directory=str(alert_sound_dir)),
        name="alert_sounds",
    )
    brand_dir = system.brand_dir()
    app.mount(
        "/media/brand",
        StaticFiles(directory=str(brand_dir)),
        name="brand",
    )
    # Last: optional workstation UI. Skipped when frontend/dist is absent (Docker UI).
    mount_spa(app)
    return app


app = create_app()
