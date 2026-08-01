from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from app.core.deps import RequireWriteLicense
from app.db.models import FloorMapRecord
from app.db.session import SessionLocal
from app.iot_core.panel_bus import get_panel_bus
from app.schemas.common import FloorMapCreateIn, FloorMapOut, FloorMapUpdateIn
from sqlalchemy import select

router = APIRouter(prefix="/api/maps", tags=["maps"])


def _iso(dt) -> str | None:  # type: ignore[no-untyped-def]
    if dt is None:
        return None
    return dt.isoformat().replace("+00:00", "Z")


def _to_out(row: FloorMapRecord, device_count: int = 0) -> FloorMapOut:
    return FloorMapOut(
        id=row.id,
        name=row.name,
        description=row.description or "",
        width=row.width,
        height=row.height,
        background_url=row.background_url,
        device_count=device_count,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


@router.get("", response_model=list[FloorMapOut])
async def list_maps() -> list[FloorMapOut]:
    bus = get_panel_bus()
    async with SessionLocal() as session:
        result = await session.execute(select(FloorMapRecord).order_by(FloorMapRecord.id.asc()))
        rows = list(result.scalars().all())
    return [_to_out(r, len(bus.devices_on_map(r.id))) for r in rows]


@router.post("", response_model=FloorMapOut, status_code=201)
async def create_map(body: FloorMapCreateIn, _: RequireWriteLicense) -> FloorMapOut:
    async with SessionLocal() as session:
        row = FloorMapRecord(
            name=body.name.strip(),
            description=body.description.strip(),
            width=body.width,
            height=body.height,
            background_url=body.background_url,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return _to_out(row, 0)


@router.get("/{map_id}", response_model=FloorMapOut)
async def get_map(map_id: int) -> FloorMapOut:
    bus = get_panel_bus()
    async with SessionLocal() as session:
        row = await session.get(FloorMapRecord, map_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy bản đồ: {map_id}")
        return _to_out(row, len(bus.devices_on_map(row.id)))


@router.patch("/{map_id}", response_model=FloorMapOut)
async def update_map(map_id: int, body: FloorMapUpdateIn, _: RequireWriteLicense) -> FloorMapOut:
    bus = get_panel_bus()
    async with SessionLocal() as session:
        row = await session.get(FloorMapRecord, map_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy bản đồ: {map_id}")
        data = body.model_dump(exclude_unset=True)
        for key, value in data.items():
            if key == "name" and isinstance(value, str):
                value = value.strip()
            if key == "description" and isinstance(value, str):
                value = value.strip()
            setattr(row, key, value)
        await session.commit()
        await session.refresh(row)
        return _to_out(row, len(bus.devices_on_map(row.id)))


@router.delete("/{map_id}", status_code=204, response_class=Response)
async def delete_map(map_id: int, _: RequireWriteLicense) -> Response:
    bus = get_panel_bus()
    async with SessionLocal() as session:
        row = await session.get(FloorMapRecord, map_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy bản đồ: {map_id}")
        await session.delete(row)
        await session.commit()
    await bus.clear_map_placements(map_id)
    return Response(status_code=204)
