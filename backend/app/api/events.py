from __future__ import annotations

import json

from fastapi import APIRouter, Query

from app.iot_core.event_store import list_events
from app.schemas.common import EventOut

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=list[EventOut])
async def get_event_history(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    panel_id: str | None = Query(None),
    event_type: str | None = Query(None),
) -> list[EventOut]:
    rows = await list_events(limit=limit, offset=offset, panel_id=panel_id, event_type=event_type)
    out: list[EventOut] = []
    for row in rows:
        try:
            payload = json.loads(row.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        out.append(
            EventOut(
                id=row.id,
                type=row.event_type,
                panel_id=row.panel_id or payload.get("panel_id"),
                device_id=row.device_id or payload.get("device_id"),
                state=payload.get("state"),
                armed_state=payload.get("armed_state"),
                detail=payload.get("detail"),
                payload=payload,
                ts=payload.get("ts")
                or (row.created_at.isoformat().replace("+00:00", "Z") if row.created_at else None),
            )
        )
    return out
