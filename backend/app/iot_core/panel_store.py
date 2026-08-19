"""Persist panel/device/zone/user/pg configuration to SQLite."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select

from app.db.models import DeviceRecord, PanelRecord, PanelUserRecord, PgRecord, ZoneRecord
from app.db.session import SessionLocal
from app.iot_core.device_id import parse_global_id


def runtime_state_for_boot(persisted: str | None) -> str:
    """Alarm is live HID, not CMS memory — never restore Báo động after process restart."""
    value = (persisted or "ok").strip().lower() or "ok"
    if value == "alarm":
        return "ok"
    return value


def _parse_last_seen(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _format_last_seen(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def startup_connection(usb_mock_mode: bool) -> tuple[str, str | None]:
    """Connection state after process restart (USB sessions do not survive)."""
    if usb_mock_mode:
        return "mock", None
    return "disconnected", None


async def load_panels_into_bus(bus: Any, *, write_back: bool = True) -> None:
    """Restore declared panels and config from DB into in-memory PanelBus."""
    from app.core.config import get_settings
    from app.iot_core.panel_bus import PanelState

    settings = get_settings()
    boot_connection, boot_usb_path = startup_connection(settings.usb_mock_mode)

    bus._persist = False  # type: ignore[attr-defined]
    try:
        async with SessionLocal() as session:
            panel_rows = (
                await session.execute(select(PanelRecord).order_by(PanelRecord.panel_id))
            ).scalars().all()
            if not panel_rows:
                return

            for row in panel_rows:
                panel = PanelState(
                    panel_id=row.panel_id,
                    display_name=row.display_name or row.panel_id,
                    connection=boot_connection,
                    usb_path=boot_usb_path,
                    armed_state=row.armed_state or "disarmed",
                    stream_code=getattr(row, "stream_code", "") or "",
                    last_seen_at=_format_last_seen(row.last_seen_at),
                )
                bus.panels[row.panel_id] = panel
                bus._ensure_worker(row.panel_id)

            zone_rows = (await session.execute(select(ZoneRecord))).scalars().all()
            for row in zone_rows:
                panel = bus.panels.get(row.panel_id)
                if panel is None:
                    continue
                panel.zones[row.zone_id] = {
                    "zone_id": row.zone_id,
                    "panel_id": row.panel_id,
                    "name": row.name,
                    "section_num": row.section_num,
                    "armed_state": row.armed_state or "disarmed",
                    "keypad_alarm": False,
                }

            user_rows = (await session.execute(select(PanelUserRecord))).scalars().all()
            for row in user_rows:
                panel = bus.panels.get(row.panel_id)
                if panel is None:
                    continue
                try:
                    permissions = json.loads(row.permissions_json or "[]")
                except json.JSONDecodeError:
                    permissions = []
                panel.users[row.user_id] = {
                    "user_id": row.user_id,
                    "panel_id": row.panel_id,
                    "name": row.name,
                    "code_label": row.code_label or "",
                    "permissions": permissions if isinstance(permissions, list) else [],
                }

            pg_rows = (await session.execute(select(PgRecord))).scalars().all()
            for row in pg_rows:
                panel = bus.panels.get(row.panel_id)
                if panel is None:
                    continue
                panel.pgs[row.pg_id] = {
                    "pg_id": row.pg_id,
                    "panel_id": row.panel_id,
                    "pg_num": row.pg_num,
                    "label": row.label or "",
                    "zone_id": row.zone_id,
                    "mode": row.mode or "pulse",
                    "state": row.state or "off",
                }

            device_rows = (await session.execute(select(DeviceRecord))).scalars().all()
            for row in device_rows:
                panel = bus.panels.get(row.panel_id)
                if panel is None:
                    continue
                try:
                    _, device_token = parse_global_id(row.global_id)
                    device_num = int(device_token.removeprefix("DEV_"))
                except (ValueError, AttributeError):
                    continue
                size = getattr(row, "map_icon_size", None)
                try:
                    map_icon_size = float(size) if size is not None else 2.0
                except (TypeError, ValueError):
                    map_icon_size = 2.0
                panel.devices[row.global_id] = {
                    "global_id": row.global_id,
                    "panel_id": row.panel_id,
                    "device_id": row.device_id,
                    "device_num": device_num,
                    "device_type": row.device_type or "sensor",
                    "label": row.label or row.global_id,
                    "model": getattr(row, "model", None) or "",
                    "link": getattr(row, "link", None) or "",
                    "state": runtime_state_for_boot(row.state),
                    "disable": getattr(row, "disable", None) or "none",
                    "reaction": getattr(row, "reaction", None) or "instant",
                    "zone_id": row.zone_id,
                    "map_id": row.map_id,
                    "map_x": row.map_x,
                    "map_y": row.map_y,
                    "map_icon": getattr(row, "map_icon", None) or "",
                    "map_icon_size": max(0.5, min(5.0, map_icon_size)),
                }
    finally:
        bus._persist = True  # type: ignore[attr-defined]
        if write_back:
            for panel in bus.panels.values():
                await save_panel(panel)


async def reload_panels_from_db(bus: Any) -> None:
    """Replace in-memory panel config from SQLite after a backup restore."""
    live = {
        pid: (p.connection, p.usb_path)
        for pid, p in list(bus.panels.items())
        if (p.connection or "") in ("usb", "mock")
    }
    lock = getattr(bus, "_lock", None)
    if lock is not None:
        async with lock:
            bus.panels.clear()
    else:
        bus.panels.clear()
    await load_panels_into_bus(bus, write_back=False)
    for pid, panel in bus.panels.items():
        prev = live.get(pid)
        if prev:
            panel.connection, panel.usb_path = prev
    workers = getattr(bus, "_workers", {})
    queues = getattr(bus, "_queues", {})
    for pid in list(workers):
        if pid in bus.panels:
            continue
        worker = workers.pop(pid, None)
        queues.pop(pid, None)
        if worker is not None and not worker.done():
            worker.cancel()


async def save_panel(panel: Any) -> None:
    async with SessionLocal() as session:
        row = (
            await session.execute(select(PanelRecord).where(PanelRecord.panel_id == panel.panel_id))
        ).scalar_one_or_none()
        if row is None:
            row = PanelRecord(panel_id=panel.panel_id)
            session.add(row)
        row.display_name = panel.display_name
        row.connection = panel.connection
        row.usb_path = panel.usb_path
        row.armed_state = panel.armed_state
        if hasattr(row, "stream_code"):
            row.stream_code = getattr(panel, "stream_code", "") or ""
        row.last_seen_at = _parse_last_seen(panel.last_seen_at)
        await session.commit()


async def delete_panel_record(panel_id: str) -> None:
    async with SessionLocal() as session:
        await session.execute(delete(PanelRecord).where(PanelRecord.panel_id == panel_id))
        await session.execute(delete(DeviceRecord).where(DeviceRecord.panel_id == panel_id))
        await session.execute(delete(ZoneRecord).where(ZoneRecord.panel_id == panel_id))
        await session.execute(delete(PanelUserRecord).where(PanelUserRecord.panel_id == panel_id))
        await session.execute(delete(PgRecord).where(PgRecord.panel_id == panel_id))
        await session.commit()


async def save_device(device: dict[str, Any]) -> None:
    global_id = device["global_id"]
    async with SessionLocal() as session:
        row = (
            await session.execute(select(DeviceRecord).where(DeviceRecord.global_id == global_id))
        ).scalar_one_or_none()
        if row is None:
            row = DeviceRecord(global_id=global_id, panel_id=device["panel_id"], device_id=device["device_id"])
            session.add(row)
        row.panel_id = device["panel_id"]
        row.device_id = device["device_id"]
        row.device_type = device.get("device_type") or "sensor"
        row.label = device.get("label") or global_id
        if hasattr(row, "model"):
            row.model = device.get("model") or ""
        if hasattr(row, "link"):
            row.link = device.get("link") or ""
        row.state = device.get("state") or "ok"
        if hasattr(row, "disable"):
            row.disable = device.get("disable") or "none"
        if hasattr(row, "reaction"):
            row.reaction = device.get("reaction") or "instant"
        row.zone_id = device.get("zone_id")
        row.map_id = device.get("map_id")
        row.map_x = device.get("map_x")
        row.map_y = device.get("map_y")
        if hasattr(row, "map_icon"):
            row.map_icon = device.get("map_icon") or ""
        if hasattr(row, "map_icon_size"):
            try:
                size = float(device.get("map_icon_size") if device.get("map_icon_size") is not None else 2.0)
            except (TypeError, ValueError):
                size = 2.0
            row.map_icon_size = max(0.5, min(5.0, size))
        await session.commit()


async def delete_device_record(global_id: str) -> None:
    async with SessionLocal() as session:
        await session.execute(delete(DeviceRecord).where(DeviceRecord.global_id == global_id))
        await session.commit()


async def save_zone(zone: dict[str, Any]) -> None:
    zone_id = zone["zone_id"]
    async with SessionLocal() as session:
        row = (
            await session.execute(select(ZoneRecord).where(ZoneRecord.zone_id == zone_id))
        ).scalar_one_or_none()
        if row is None:
            row = ZoneRecord(zone_id=zone_id, panel_id=zone["panel_id"])
            session.add(row)
        row.panel_id = zone["panel_id"]
        row.name = zone.get("name") or zone_id
        row.section_num = int(zone["section_num"])
        row.armed_state = zone.get("armed_state") or "disarmed"
        await session.commit()


async def delete_zone_record(zone_id: str) -> None:
    async with SessionLocal() as session:
        await session.execute(delete(ZoneRecord).where(ZoneRecord.zone_id == zone_id))
        await session.commit()


async def save_user(user: dict[str, Any]) -> None:
    user_id = user["user_id"]
    async with SessionLocal() as session:
        row = (
            await session.execute(select(PanelUserRecord).where(PanelUserRecord.user_id == user_id))
        ).scalar_one_or_none()
        if row is None:
            row = PanelUserRecord(user_id=user_id, panel_id=user["panel_id"])
            session.add(row)
        row.panel_id = user["panel_id"]
        row.name = user.get("name") or user_id
        row.code_label = user.get("code_label") or ""
        row.permissions_json = json.dumps(user.get("permissions") or [], ensure_ascii=False)
        await session.commit()


async def delete_user_record(user_id: str) -> None:
    async with SessionLocal() as session:
        await session.execute(delete(PanelUserRecord).where(PanelUserRecord.user_id == user_id))
        await session.commit()


async def save_pg(pg: dict[str, Any]) -> None:
    pg_id = pg["pg_id"]
    async with SessionLocal() as session:
        row = (await session.execute(select(PgRecord).where(PgRecord.pg_id == pg_id))).scalar_one_or_none()
        if row is None:
            row = PgRecord(pg_id=pg_id, panel_id=pg["panel_id"])
            session.add(row)
        row.panel_id = pg["panel_id"]
        row.pg_num = int(pg["pg_num"])
        row.label = pg.get("label") or ""
        row.zone_id = pg.get("zone_id")
        row.mode = pg.get("mode") or "pulse"
        row.state = pg.get("state") or "off"
        await session.commit()


async def delete_pg_record(pg_id: str) -> None:
    async with SessionLocal() as session:
        await session.execute(delete(PgRecord).where(PgRecord.pg_id == pg_id))
        await session.commit()
