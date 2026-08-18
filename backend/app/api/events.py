from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from app.iot_core.event_store import is_history_page_event, list_events
from app.schemas.common import EventOut

router = APIRouter(prefix="/api/events", tags=["events"])

_VN = timezone(timedelta(hours=7))


def _as_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _parse_bound(value: str | None, *, end: bool) -> datetime | None:
    if not value or not value.strip():
        return None
    raw = value.strip()
    try:
        if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
            dt = datetime.fromisoformat(raw)
            if end:
                dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=_VN)
            return dt.astimezone(timezone.utc)
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_VN)
        return dt.astimezone(timezone.utc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Mốc thời gian không hợp lệ: {raw}") from exc


@router.get("", response_model=list[EventOut])
async def get_event_history(
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    panel_id: str | None = Query(None),
    event_type: str | None = Query(None),
    since: str | None = Query(None, description="ISO hoặc YYYY-MM-DD (GMT+7)"),
    until: str | None = Query(None, description="ISO hoặc YYYY-MM-DD (GMT+7)"),
    history_page: bool = Query(False, description="Chỉ Báo động / TMP / Lỗi / truy vết / cập nhật tủ"),
) -> list[EventOut]:
    rows = await list_events(
        limit=limit,
        offset=offset,
        panel_id=panel_id,
        event_type=event_type,
        since=_parse_bound(since, end=False),
        until=_parse_bound(until, end=True),
        history_page=history_page,
    )
    out: list[EventOut] = []
    for row in rows:
        try:
            payload = json.loads(row.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        if history_page and not is_history_page_event({**payload, "type": row.event_type}):
            continue
        out.append(
            EventOut(
                id=row.id,
                type=row.event_type,
                panel_id=row.panel_id or payload.get("panel_id"),
                device_id=row.device_id or payload.get("device_id"),
                state=payload.get("state"),
                armed_state=payload.get("armed_state"),
                zone_id=str(payload["zone_id"]) if payload.get("zone_id") not in (None, "") else None,
                section_num=_as_int(payload.get("section_num")),
                detail=payload.get("detail"),
                payload=payload,
                ts=payload.get("ts")
                or (row.created_at.isoformat().replace("+00:00", "Z") if row.created_at else None),
            )
        )
    return out
