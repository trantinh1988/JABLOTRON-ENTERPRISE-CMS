"""USB HID diagnostics."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import get_settings
from app.iot_core.usb_manager import get_usb_manager

router = APIRouter(prefix="/api/usb", tags=["usb"])


@router.get("/status")
async def usb_status() -> dict:
    """Trạng thái quét USB — dùng khi tủ không kết nối được."""
    settings = get_settings()
    manager = get_usb_manager()
    status = manager.get_status()
    return {
        **status,
        "mock_mode": settings.usb_mock_mode,
        "vendor_id_hex": f"0x{settings.jablotron_vendor_id:04X}",
        "product_id_hex": f"0x{settings.jablotron_product_id:04X}",
        "vendor_id": settings.jablotron_vendor_id,
        "product_id": settings.jablotron_product_id,
    }
