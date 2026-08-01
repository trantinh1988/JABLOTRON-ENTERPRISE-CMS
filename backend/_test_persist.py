import asyncio

from sqlalchemy import select

from app.db.models import PanelRecord
from app.db.session import SessionLocal, init_db
from app.iot_core.panel_bus import get_panel_bus
from app.iot_core.panel_store import load_panels_into_bus


async def test() -> None:
    await init_db()
    bus = get_panel_bus()
    bus._persist = True
    await bus.ensure_panel("PANEL_1", display_name="Test Cabinet", connection="disconnected")
    async with SessionLocal() as s:
        row = (
            await s.execute(select(PanelRecord).where(PanelRecord.panel_id == "PANEL_1"))
        ).scalar_one_or_none()
        assert row is not None
        assert row.display_name == "Test Cabinet"
    bus.panels.clear()
    await load_panels_into_bus(bus)
    assert "PANEL_1" in bus.panels
    assert bus.panels["PANEL_1"].display_name == "Test Cabinet"
    assert bus.panels["PANEL_1"].connection == "disconnected"
    print("OK: panel persistence works")


if __name__ == "__main__":
    asyncio.run(test())
