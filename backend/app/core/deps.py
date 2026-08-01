"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from app.core.config import Settings, get_settings
from app.license_manager.service import LicenseService, get_license_service


def get_settings_dep() -> Settings:
    return get_settings()


SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
LicenseServiceDep = Annotated[LicenseService, Depends(get_license_service)]


async def require_write_license(
    request: Request,
    license_service: LicenseServiceDep,
) -> None:
    """Block control APIs when license is missing, invalid, or expired (read-only mode)."""
    status_info = license_service.get_status()
    if status_info.mode != "full":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "license_read_only",
                "message": "Bản quyền không hợp lệ hoặc đã hết hạn — hệ thống đang ở chế độ chỉ đọc, không thể điều khiển.",
                "license_status": status_info.status,
                "license_mode": status_info.mode,
            },
        )


RequireWriteLicense = Annotated[None, Depends(require_write_license)]
