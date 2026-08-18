from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.core.deps import RequireWriteLicense
from app.db.models import AutomationRuleRecord, AutomationSnapRecord, CameraRecord
from app.db.session import SessionLocal
from app.iot_core.automation_engine import delete_rule_snaps, get_automation_engine
from app.schemas.common import AutomationRuleIn, AutomationRuleOut, AutomationSnapOut

router = APIRouter(prefix="/api/automation", tags=["automation"])

IF_LABELS = {
    "armed_alarm": "Bật bảo vệ + ACT",
    "device_alarm": "Thiết bị ACT",
    "device_open": "Thiết bị Open",
    "tamper": "Sabotage",
    "loss": "Mất liên lạc",
    "device_fault": "Lỗi thiết bị",
    "section_armed": "Bật bảo vệ phân khu",
    "section_disarmed": "Tắt bảo vệ phân khu",
    "panel_armed": "Bật bảo vệ toàn tủ",
    "panel_disarmed": "Tắt bảo vệ toàn tủ",
    "keypad_alarm": "Báo động bàn phím",
}
THEN_LABELS = {
    "camera_snapshot": "Chụp camera",
    "notify": "Thông báo",
}


def _iso(dt) -> str | None:  # type: ignore[no-untyped-def]
    if dt is None:
        return None
    text = dt.isoformat()
    if text.endswith("+00:00"):
        return text.replace("+00:00", "Z")
    # SQLite naive UTC — gắn Z để frontend không lệch múi giờ.
    if dt.tzinfo is None and "T" in text and not text.endswith("Z"):
        return f"{text}Z"
    return text


def _default_name(body: AutomationRuleIn) -> str:
    left = IF_LABELS.get(body.if_type, body.if_type)
    right = THEN_LABELS.get(body.then_type, body.then_type)
    return f"{left} → {right}"


def _clean(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def _validate(body: AutomationRuleIn) -> None:
    if body.then_type == "camera_snapshot" and not _clean(body.then_camera_id):
        raise HTTPException(status_code=400, detail="Chọn camera cho hành động chụp snapshot.")


async def _to_out(row: AutomationRuleRecord, camera_name: str | None = None) -> AutomationRuleOut:
    return AutomationRuleOut(
        id=row.id,
        name=row.name,
        enabled=bool(row.enabled),
        if_type=row.if_type,
        if_panel_id=row.if_panel_id,
        if_device_id=row.if_device_id,
        if_zone_id=row.if_zone_id,
        if_floor_id=row.if_floor_id,
        if_require_armed=bool(getattr(row, "if_require_armed", False)),
        then_type=row.then_type,
        then_camera_id=row.then_camera_id,
        then_camera_name=camera_name,
        cooldown_sec=int(row.cooldown_sec or 30),
        last_fired_at=_iso(row.last_fired_at),
        last_error=row.last_error or "",
        fire_count=int(row.fire_count or 0),
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


async def _camera_names(ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    async with SessionLocal() as session:
        result = await session.execute(select(CameraRecord).where(CameraRecord.id.in_(ids)))
        return {row.id: row.name for row in result.scalars().all()}


def _apply(row: AutomationRuleRecord, body: AutomationRuleIn) -> None:
    row.name = body.name.strip() or _default_name(body)
    row.enabled = body.enabled
    row.if_type = body.if_type
    row.if_panel_id = _clean(body.if_panel_id)
    row.if_device_id = _clean(body.if_device_id)
    row.if_zone_id = _clean(body.if_zone_id)
    row.if_floor_id = body.if_floor_id
    row.if_require_armed = bool(body.if_require_armed)
    row.then_type = body.then_type
    row.then_camera_id = _clean(body.then_camera_id)
    row.cooldown_sec = body.cooldown_sec


@router.get("/rules", response_model=list[AutomationRuleOut])
async def list_rules() -> list[AutomationRuleOut]:
    async with SessionLocal() as session:
        result = await session.execute(select(AutomationRuleRecord).order_by(AutomationRuleRecord.created_at.desc()))
        rows = list(result.scalars().all())
    names = await _camera_names({r.then_camera_id for r in rows if r.then_camera_id})
    return [await _to_out(r, names.get(r.then_camera_id) if r.then_camera_id else None) for r in rows]


@router.post("/rules", response_model=AutomationRuleOut, status_code=201)
async def create_rule(body: AutomationRuleIn, _: RequireWriteLicense) -> AutomationRuleOut:
    _validate(body)
    row = AutomationRuleRecord(id=str(uuid.uuid4()))
    _apply(row, body)
    async with SessionLocal() as session:
        session.add(row)
        await session.commit()
        await session.refresh(row)
        camera_name = None
        if row.then_camera_id:
            cam = await session.get(CameraRecord, row.then_camera_id)
            camera_name = cam.name if cam else None
    await get_automation_engine().reload()
    return await _to_out(row, camera_name)


@router.put("/rules/{rule_id}", response_model=AutomationRuleOut)
async def update_rule(rule_id: str, body: AutomationRuleIn, _: RequireWriteLicense) -> AutomationRuleOut:
    _validate(body)
    async with SessionLocal() as session:
        row = await session.get(AutomationRuleRecord, rule_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy luật Automation.")
        _apply(row, body)
        await session.commit()
        await session.refresh(row)
        camera_name = None
        if row.then_camera_id:
            cam = await session.get(CameraRecord, row.then_camera_id)
            camera_name = cam.name if cam else None
        out = await _to_out(row, camera_name)
    await get_automation_engine().reload()
    return out


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: str, _: RequireWriteLicense) -> None:
    async with SessionLocal() as session:
        row = await session.get(AutomationRuleRecord, rule_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy luật Automation.")
        await session.delete(row)
        await session.commit()
    await delete_rule_snaps(rule_id)
    await get_automation_engine().reload()


@router.post("/rules/{rule_id}/test")
async def test_rule(rule_id: str, _: RequireWriteLicense) -> dict:
    try:
        return await get_automation_engine().fire_now(rule_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Không tìm thấy luật Automation.") from None


@router.get("/snaps", response_model=list[AutomationSnapOut])
async def list_snaps(limit: int = Query(20, ge=1, le=300)) -> list[AutomationSnapOut]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(AutomationSnapRecord).order_by(AutomationSnapRecord.created_at.desc()).limit(limit)
        )
        rows = list(result.scalars().all())
    return [
        AutomationSnapOut(
            id=r.id,
            rule_id=r.rule_id,
            camera_id=r.camera_id,
            camera_name=r.camera_name,
            device_id=r.device_id,
            image_url=r.image_url,
            created_at=_iso(r.created_at),
        )
        for r in rows
    ]
