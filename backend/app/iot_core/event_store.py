"""Persist EventHub messages into SQLite for audit / history."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select

from app.db.models import EventRecord
from app.db.session import SessionLocal
from app.iot_core.event_hub import get_event_hub


async def persist_event(event: dict[str, Any]) -> None:
    async with SessionLocal() as session:
        record = EventRecord(
            event_type=str(event.get("type") or "unknown"),
            panel_id=event.get("panel_id"),
            device_id=event.get("device_id"),
            payload_json=json.dumps(event, ensure_ascii=False),
        )
        session.add(record)
        await session.commit()


def register_event_persistence() -> None:
    hub = get_event_hub()
    hub.add_handler(persist_event)


async def list_events(
    *,
    limit: int = 100,
    offset: int = 0,
    panel_id: str | None = None,
    event_type: str | None = None,
) -> list[EventRecord]:
    async with SessionLocal() as session:
        stmt = select(EventRecord).order_by(EventRecord.id.desc()).offset(offset).limit(limit)
        if panel_id:
            stmt = stmt.where(EventRecord.panel_id == panel_id)
        if event_type:
            stmt = stmt.where(EventRecord.event_type == event_type)
        result = await session.execute(stmt)
        return list(result.scalars().all())
