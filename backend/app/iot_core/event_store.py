"""Persist EventHub messages into SQLite for audit / history."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from typing import Any

log = logging.getLogger(__name__)

from sqlalchemy import and_, delete, func, or_, select

from app.db.models import EventRecord
from app.db.session import SessionLocal
from app.iot_core.event_hub import get_event_hub


# High-frequency reconcile / heartbeat — keep out of audit history.
_SKIP_PERSIST_TYPES = frozenset(
    {
        "panel_live",
        "devices_state_snapshot",
        "connected",
        "devices_disable_batch",
    }
)

# History page: Báo động / TMP / Lỗi (Fault) / chụp truy vết / cập nhật tủ.
# OK, ACT, Loss, armed… belong on Trạng thái, not Lịch sử.
_HISTORY_PAGE_TYPES = frozenset(
    {
        "device_alarm_trigger",
        "map_trail_snap",
        "panel_updated",
    }
)
_HISTORY_PAGE_STATES = frozenset({"alarm", "tamper", "fault"})

# Same device/status (or map/panel) within this window is one activation, not two rows.
_DEDUP_SEC = 3.0
# Ring buffer: newest 1_000_000 rows; older events are overwritten (deleted).
MAX_HISTORY_EVENTS = 1_000_000
_recent_audit: dict[str, float] = {}


def reset_audit_dedup() -> None:
    _recent_audit.clear()


def _audit_key(event: dict[str, Any]) -> str:
    event_type = str(event.get("type") or "")
    panel_id = str(event.get("panel_id") or "")
    device_id = str(event.get("device_id") or "")
    if event_type == "device_alarm_trigger":
        return "|".join(["device", panel_id, device_id, "alarm"])
    if event_type == "device_state":
        return "|".join(["device", panel_id, device_id, str(event.get("state") or "").lower()])
    if event_type == "map_trail_snap":
        return "|".join(["map_trail", str(event.get("map_id") or "")])
    if event_type == "panel_updated":
        return "|".join(["panel_updated", panel_id])
    return "|".join(
        [
            event_type,
            panel_id,
            str(event.get("zone_id") or ""),
            device_id,
            str(event.get("map_id") or ""),
            str(event.get("armed_state") or event.get("state") or ""),
        ]
    )


def _dedup_ok(event: dict[str, Any]) -> bool:
    key = _audit_key(event)
    now = time.monotonic()
    stale = [k for k, at in _recent_audit.items() if now - at > _DEDUP_SEC]
    for k in stale:
        _recent_audit.pop(k, None)
    last = _recent_audit.get(key)
    if last is not None and now - last < _DEDUP_SEC:
        return False
    _recent_audit[key] = now
    return True


def is_history_page_event(event: dict[str, Any]) -> bool:
    event_type = str(event.get("type") or "")
    if event_type in _HISTORY_PAGE_TYPES:
        return True
    if event_type == "device_state":
        return str(event.get("state") or "").lower() in _HISTORY_PAGE_STATES
    return False


def _history_page_sql():
    state = func.lower(func.json_extract(EventRecord.payload_json, "$.state"))
    return or_(
        EventRecord.event_type.in_(tuple(_HISTORY_PAGE_TYPES)),
        and_(EventRecord.event_type == "device_state", state.in_(tuple(_HISTORY_PAGE_STATES))),
    )


def audit_records(event: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize an EventHub message into 0..n history rows."""
    if event.get("history") is False or event.get("derived") is True:
        return []
    event_type = str(event.get("type") or "unknown")
    if event_type in _SKIP_PERSIST_TYPES:
        return []
    if event_type == "devices_state_batch":
        updates = event.get("updates")
        if not isinstance(updates, dict) or not updates:
            return []
        rows: list[dict[str, Any]] = []
        for device_id, state in updates.items():
            row = {
                "type": "device_state",
                "panel_id": event.get("panel_id"),
                "device_id": device_id,
                "state": state,
                "ts": event.get("ts"),
                "clear_alarm": device_id in (event.get("clear_alarm_ids") or []),
            }
            if not is_history_page_event(row):
                continue
            if _dedup_ok(row):
                rows.append(row)
        return rows
    if not is_history_page_event(event):
        return []
    if not _dedup_ok(event):
        return []
    return [event]


def history_overwrite_cutoff(max_id: int | None, keep: int = MAX_HISTORY_EVENTS) -> int | None:
    """Oldest id (inclusive) to delete so at most ``keep`` newest rows remain."""
    if max_id is None or keep <= 0 or max_id <= keep:
        return None
    return max_id - keep


async def _trim_history(session: Any, keep: int = MAX_HISTORY_EVENTS) -> int:
    max_id = await session.scalar(select(func.max(EventRecord.id)))
    cutoff = history_overwrite_cutoff(int(max_id) if max_id is not None else None, keep)
    if cutoff is None:
        return 0
    result = await session.execute(delete(EventRecord).where(EventRecord.id <= cutoff))
    return int(result.rowcount or 0)


async def trim_history_events(keep: int = MAX_HISTORY_EVENTS) -> int:
    """Drop oldest history rows until at most ``keep`` remain."""
    try:
        async with SessionLocal() as session:
            deleted = await _trim_history(session, keep)
            if deleted:
                await session.commit()
                log.info("Lịch sử overwrite: đã xóa %s sự kiện cũ (giữ %s).", deleted, keep)
            return deleted
    except Exception:
        log.exception("Không trim được sự kiện lịch sử")
        return 0


async def persist_event(event: dict[str, Any]) -> None:
    rows = audit_records(event)
    if not rows:
        return
    try:
        async with SessionLocal() as session:
            for row in rows:
                session.add(
                    EventRecord(
                        event_type=str(row.get("type") or "unknown"),
                        panel_id=row.get("panel_id"),
                        device_id=row.get("device_id"),
                        payload_json=json.dumps(row, ensure_ascii=False),
                    )
                )
            await session.flush()
            await _trim_history(session)
            await session.commit()
    except Exception:
        log.exception("Không ghi được sự kiện lịch sử: %s", event.get("type"))


def register_event_persistence() -> None:
    hub = get_event_hub()
    hub.add_handler(persist_event)


async def list_events(
    *,
    limit: int = 100,
    offset: int = 0,
    panel_id: str | None = None,
    event_type: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    history_page: bool = False,
) -> list[EventRecord]:
    async with SessionLocal() as session:
        stmt = select(EventRecord).order_by(EventRecord.id.desc()).offset(offset).limit(limit)
        if panel_id:
            stmt = stmt.where(EventRecord.panel_id == panel_id)
        if event_type:
            stmt = stmt.where(EventRecord.event_type == event_type)
        if since is not None:
            stmt = stmt.where(EventRecord.created_at >= since)
        if until is not None:
            stmt = stmt.where(EventRecord.created_at <= until)
        if history_page:
            stmt = stmt.where(_history_page_sql())
        result = await session.execute(stmt)
        return list(result.scalars().all())
