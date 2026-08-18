"""IF → THEN automation: match EventHub events, fire one action, cooldown."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select

from app.core.config import BACKEND_ROOT
from app.db.models import AutomationRuleRecord, AutomationSnapRecord, CameraRecord
from app.db.session import SessionLocal
from app.iot_core.camera_service import CameraCaptureError, capture_camera_snapshot, save_camera_thumb
from app.iot_core.device_reaction import reaction_alarms_when_disarmed
from app.iot_core.event_hub import get_event_hub
from app.iot_core.panel_bus import get_panel_bus

log = logging.getLogger(__name__)

SNAP_DIR = BACKEND_ROOT / "data" / "alarm_snaps"
MAX_SNAPS = 40
SKIP_TYPES = frozenset(
    {
        "panel_live",
        "devices_state_snapshot",
        "connected",
        "devices_disable_batch",
        "device_disable",
        "automation_fired",
    }
)
DEVICE_IF_TYPES = frozenset({"device_alarm", "device_open", "tamper", "loss", "device_fault"})
ARMED_STATES = frozenset({"armed", "partial"})


@dataclass(frozen=True, slots=True)
class Trigger:
    if_type: str
    panel_id: str | None = None
    device_id: str | None = None
    zone_id: str | None = None
    map_id: int | None = None
    state: str | None = None
    armed: bool = False
    always: bool = False


def ensure_alarm_snap_dir() -> Path:
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    return SNAP_DIR


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_armed(state: Any) -> bool:
    return str(state or "").lower() in ARMED_STATES


def _lookup_device(
    device_id: str | None, panel_id: str | None
) -> tuple[str | None, str | None, int | None, bool, bool]:
    """Return (panel_id, zone_id, map_id, armed, always)."""
    if not device_id:
        return panel_id, None, None, False, False
    bus = get_panel_bus()
    panel = bus.panels.get(panel_id) if panel_id else None
    if panel is None or device_id not in panel.devices:
        for candidate in bus.panels.values():
            if device_id in candidate.devices:
                panel = candidate
                break
    if panel is None:
        return panel_id, None, None, False, False
    device = panel.devices.get(device_id) or {}
    zone_id = device.get("zone_id") or None
    map_id = _int_or_none(device.get("map_id"))
    zone = panel.zones.get(zone_id) if zone_id else None
    armed = _is_armed(zone.get("armed_state") if zone else None) or _is_armed(panel.armed_state)
    always = reaction_alarms_when_disarmed(device.get("reaction"))
    return panel.panel_id, zone_id, map_id, armed, always


def _device_trigger(if_type: str, event: dict[str, Any], device_id: str | None, state: str) -> Trigger:
    panel_id = event.get("panel_id")
    live_panel, zone_id, map_id, armed, always = _lookup_device(device_id, panel_id)
    return Trigger(
        if_type=if_type,
        panel_id=live_panel or panel_id,
        device_id=device_id,
        zone_id=zone_id,
        map_id=_int_or_none(event.get("map_id")) if event.get("map_id") is not None else map_id,
        state=state,
        armed=armed,
        always=always,
    )


def _device_if_from_state(state: str) -> str | None:
    if state == "alarm":
        return None
    if state == "open":
        return "device_open"
    if state == "fault":
        return "device_fault"
    if state in {"tamper", "loss"}:
        return state
    return None


def extract_triggers(event: dict[str, Any]) -> list[Trigger]:
    etype = str(event.get("type") or "")
    if etype in SKIP_TYPES:
        return []
    panel_id = event.get("panel_id")
    if etype == "device_alarm_trigger":
        return [_device_trigger("device_alarm", event, event.get("device_id"), "alarm")]
    if etype == "device_state":
        if_type = _device_if_from_state(str(event.get("state") or ""))
        if not if_type:
            return []
        return [_device_trigger(if_type, event, event.get("device_id"), str(event.get("state") or ""))]
    if etype == "devices_state_batch":
        updates = event.get("updates") or {}
        if not isinstance(updates, dict):
            return []
        out: list[Trigger] = []
        for device_id, state in updates.items():
            if_type = _device_if_from_state(str(state or ""))
            if not if_type:
                continue
            out.append(_device_trigger(if_type, event, str(device_id), str(state or "")))
        return out
    if etype == "zone_armed":
        armed = str(event.get("armed_state") or "")
        out: list[Trigger] = []
        if armed in ARMED_STATES:
            out.append(
                Trigger(if_type="section_armed", panel_id=panel_id, zone_id=event.get("zone_id"), state=armed, armed=True)
            )
        elif armed == "disarmed":
            out.append(
                Trigger(
                    if_type="section_disarmed",
                    panel_id=panel_id,
                    zone_id=event.get("zone_id"),
                    state=armed,
                    armed=False,
                )
            )
        if event.get("keypad_alarm"):
            out.append(
                Trigger(
                    if_type="keypad_alarm",
                    panel_id=panel_id,
                    zone_id=event.get("zone_id"),
                    state=armed,
                    armed=_is_armed(armed),
                )
            )
        return out
    if etype == "panel_armed":
        armed = str(event.get("armed_state") or "")
        if armed in ARMED_STATES:
            return [Trigger(if_type="panel_armed", panel_id=panel_id, state=armed, armed=True)]
        if armed == "disarmed":
            return [Trigger(if_type="panel_disarmed", panel_id=panel_id, state=armed, armed=False)]
    return []


def _if_type_matches(rule_type: str, trigger: Trigger) -> bool:
    if rule_type == "armed_alarm":
        # Instant khi armed; 24h/Fire báo cả khi phân khu tắt.
        return trigger.if_type == "device_alarm" and (trigger.armed or trigger.always)
    return rule_type == trigger.if_type


def rule_matches(rule: dict[str, Any], trigger: Trigger) -> bool:
    if not rule.get("enabled", True):
        return False
    if not _if_type_matches(str(rule.get("if_type") or ""), trigger):
        return False
    if rule.get("if_panel_id") and rule["if_panel_id"] != trigger.panel_id:
        return False
    if trigger.if_type in DEVICE_IF_TYPES:
        if rule.get("if_device_id") and rule["if_device_id"] != trigger.device_id:
            return False
        if rule.get("if_floor_id") is not None and rule["if_floor_id"] != trigger.map_id:
            return False
        if rule.get("if_zone_id") and rule["if_zone_id"] != trigger.zone_id:
            return False
        if rule.get("if_type") != "armed_alarm" and rule.get("if_require_armed") and not trigger.armed:
            return False
    if trigger.if_type in {"section_armed", "section_disarmed", "keypad_alarm"}:
        if rule.get("if_zone_id") and rule["if_zone_id"] != trigger.zone_id:
            return False
    return True


def _rule_dict(row: AutomationRuleRecord) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "enabled": bool(row.enabled),
        "if_type": row.if_type,
        "if_panel_id": row.if_panel_id or None,
        "if_device_id": row.if_device_id or None,
        "if_zone_id": row.if_zone_id or None,
        "if_floor_id": row.if_floor_id,
        "if_require_armed": bool(getattr(row, "if_require_armed", False)),
        "then_type": row.then_type,
        "then_camera_id": row.then_camera_id or None,
        "cooldown_sec": int(row.cooldown_sec or 30),
    }


class AutomationEngine:
    def __init__(self) -> None:
        self._rules: list[dict[str, Any]] = []
        self._last_fire: dict[str, float] = {}
        self._registered = False

    async def reload(self) -> None:
        async with SessionLocal() as session:
            result = await session.execute(select(AutomationRuleRecord))
            rows = list(result.scalars().all())
        self._rules = [_rule_dict(r) for r in rows if r.enabled]

    def _cooling(self, rule_id: str, cooldown_sec: int) -> bool:
        last = self._last_fire.get(rule_id)
        if last is None:
            return False
        return (time.monotonic() - last) < max(5, cooldown_sec)

    async def handle_event(self, event: dict[str, Any]) -> None:
        triggers = extract_triggers(event)
        if not triggers or not self._rules:
            return
        for trigger in triggers:
            for rule in list(self._rules):
                if not rule_matches(rule, trigger):
                    continue
                if self._cooling(rule["id"], int(rule.get("cooldown_sec") or 30)):
                    continue
                self._last_fire[rule["id"]] = time.monotonic()
                asyncio.create_task(self._run_action(rule, trigger))

    async def fire_now(self, rule_id: str, device_id: str | None = None) -> dict[str, Any]:
        async with SessionLocal() as session:
            row = await session.get(AutomationRuleRecord, rule_id)
            if row is None:
                raise KeyError(rule_id)
            rule = _rule_dict(row)
        trigger = Trigger(if_type=rule["if_type"], device_id=device_id or rule.get("if_device_id"))
        self._last_fire[rule["id"]] = time.monotonic()
        return await self._run_action(rule, trigger)

    async def _run_action(self, rule: dict[str, Any], trigger: Trigger) -> dict[str, Any]:
        then_type = rule.get("then_type") or "notify"
        image_url: str | None = None
        camera_name = ""
        error = ""
        ok = True
        try:
            if then_type == "camera_snapshot":
                image_url, camera_name = await self._snapshot(rule, trigger)
            await self._mark_fire(rule["id"], error="")
        except Exception as exc:
            ok = False
            error = str(exc)[:256]
            log.warning("Automation %s failed: %s", rule.get("id"), error)
            await self._mark_fire(rule["id"], error=error)

        payload = {
            "type": "automation_fired",
            "rule_id": rule["id"],
            "rule_name": rule.get("name") or "",
            "then_type": then_type,
            "camera_id": rule.get("then_camera_id"),
            "camera_name": camera_name or None,
            "device_id": trigger.device_id,
            "panel_id": trigger.panel_id,
            "map_id": trigger.map_id,
            "image_url": image_url,
            "ok": ok,
            "detail": error or None,
        }
        await get_event_hub().publish(payload)
        return payload

    async def _snapshot(self, rule: dict[str, Any], trigger: Trigger) -> tuple[str, str]:
        camera_id = rule.get("then_camera_id")
        if not camera_id:
            raise RuntimeError("Luật chưa chọn camera.")
        async with SessionLocal() as session:
            camera = await session.get(CameraRecord, camera_id)
            if camera is None or not camera.is_active:
                raise RuntimeError("Camera không tồn tại hoặc đang tắt.")
            camera_name = camera.name
        try:
            result = await capture_camera_snapshot(camera)
        except CameraCaptureError as exc:
            raise RuntimeError(exc.message) from exc
        ensure_alarm_snap_dir()
        stamp = _now().strftime("%Y%m%d_%H%M%S")
        filename = f"{rule['id'][:8]}_{stamp}_{camera_id[:8]}.jpg"
        path = SNAP_DIR / filename
        path.write_bytes(result.image_bytes)
        save_camera_thumb(camera_id, result.image_bytes)
        image_url = f"/media/alarm-snaps/{filename}"
        snap = AutomationSnapRecord(
            id=str(uuid.uuid4()),
            rule_id=rule["id"],
            camera_id=camera_id,
            camera_name=camera_name,
            device_id=trigger.device_id,
            image_url=image_url,
        )
        async with SessionLocal() as session:
            session.add(snap)
            await session.commit()
        await _prune_snaps()
        return image_url, camera_name

    async def _mark_fire(self, rule_id: str, *, error: str) -> None:
        async with SessionLocal() as session:
            row = await session.get(AutomationRuleRecord, rule_id)
            if row is None:
                return
            row.last_fired_at = _now()
            row.last_error = error
            row.fire_count = int(row.fire_count or 0) + 1
            await session.commit()


async def _prune_snaps() -> None:
    async with SessionLocal() as session:
        result = await session.execute(
            select(AutomationSnapRecord).order_by(AutomationSnapRecord.created_at.desc())
        )
        rows = list(result.scalars().all())
        extra = rows[MAX_SNAPS:]
        for row in extra:
            name = Path(row.image_url).name
            if name and name not in {".", ".."}:
                try:
                    (SNAP_DIR / name).unlink(missing_ok=True)
                except OSError:
                    pass
            await session.delete(row)
        if extra:
            await session.commit()


async def delete_rule_snaps(rule_id: str) -> None:
    async with SessionLocal() as session:
        result = await session.execute(
            select(AutomationSnapRecord).where(AutomationSnapRecord.rule_id == rule_id)
        )
        rows = list(result.scalars().all())
        for row in rows:
            name = Path(row.image_url).name
            if name and name not in {".", ".."}:
                try:
                    (SNAP_DIR / name).unlink(missing_ok=True)
                except OSError:
                    pass
        await session.execute(delete(AutomationSnapRecord).where(AutomationSnapRecord.rule_id == rule_id))
        await session.commit()


_engine: AutomationEngine | None = None


def get_automation_engine() -> AutomationEngine:
    global _engine
    if _engine is None:
        _engine = AutomationEngine()
    return _engine


def register_automation_engine() -> None:
    engine = get_automation_engine()
    if engine._registered:
        return
    get_event_hub().add_handler(engine.handle_event)
    engine._registered = True
