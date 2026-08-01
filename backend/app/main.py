from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api import events, license, maps, panels, ws
from app.core.config import get_settings
from app.db.session import init_db
from app.iot_core.event_store import register_event_persistence
from app.iot_core.usb_manager import get_usb_manager
from app.license_manager.service import get_license_service
from app.schemas.common import HealthOut


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    register_event_persistence()
    license_service = get_license_service()
    await license_service.load_from_db()
    usb = get_usb_manager()
    await usb.start()
    try:
        yield
    finally:
        await usb.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

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
        return HealthOut(
            status="ok",
            app=settings.app_name,
            license_mode=lic.mode,
            usb_mock_mode=settings.usb_mock_mode,
        )

    app.include_router(license.router)
    app.include_router(panels.router)
    app.include_router(panels.devices_router)
    app.include_router(maps.router)
    app.include_router(events.router)
    app.include_router(ws.router)
    return app


app = create_app()
