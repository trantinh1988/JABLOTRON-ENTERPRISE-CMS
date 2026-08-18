from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import select

from app.core.config import BACKEND_ROOT
from app.core.deps import RequireWriteLicense
from app.db.models import FloorMapRecord
from app.db.session import SessionLocal
from app.iot_core.event_hub import get_event_hub
from app.iot_core.panel_bus import get_panel_bus
from app.schemas.common import FloorMapCreateIn, FloorMapOut, FloorMapUpdateIn, MapTrailSnapOut

router = APIRouter(prefix="/api/maps", tags=["maps"])
log = logging.getLogger(__name__)

MAP_BG_DIR = BACKEND_ROOT / "data" / "map_backgrounds"
MAP_SNAP_DIR = BACKEND_ROOT / "data" / "map_snaps"
ALLOWED_BG_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_BG_BYTES = 12 * 1024 * 1024
MAX_TRAIL_SNAP_BYTES = 4 * 1024 * 1024
MAX_TRAIL_SNAPS = 80
JPEG_MAGIC = b"\xff\xd8"


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


def ensure_map_bg_dir() -> Path:
    MAP_BG_DIR.mkdir(parents=True, exist_ok=True)
    return MAP_BG_DIR


def ensure_map_snap_dir() -> Path:
    MAP_SNAP_DIR.mkdir(parents=True, exist_ok=True)
    return MAP_SNAP_DIR


def _prune_map_snaps() -> None:
    files = sorted(
        [p for p in MAP_SNAP_DIR.glob("*.jpg") if p.is_file()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for stale in files[MAX_TRAIL_SNAPS:]:
        try:
            stale.unlink()
        except OSError as exc:
            log.warning("Could not prune map snap %s: %s", stale, exc)


def _unlink_local_bg(url: str | None) -> None:
    if not url or not url.startswith("/media/map-backgrounds/"):
        return
    name = Path(url).name
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        return
    path = MAP_BG_DIR / name
    try:
        if path.is_file():
            path.unlink()
    except OSError as exc:
        log.warning("Could not remove map background %s: %s", path, exc)


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
        old_bg = row.background_url
        for key, value in data.items():
            if key == "name" and isinstance(value, str):
                value = value.strip()
            if key == "description" and isinstance(value, str):
                value = value.strip()
            setattr(row, key, value)
        await session.commit()
        await session.refresh(row)
        if "background_url" in data and data["background_url"] != old_bg:
            _unlink_local_bg(old_bg)
        return _to_out(row, len(bus.devices_on_map(row.id)))


@router.post("/{map_id}/background", response_model=FloorMapOut)
async def upload_map_background(
    map_id: int,
    _: RequireWriteLicense,
    file: UploadFile = File(...),
) -> FloorMapOut:
    """Upload ảnh mặt bằng (JPEG/PNG/WebP/GIF) và gắn làm nền bản đồ."""
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    ext = ALLOWED_BG_TYPES.get(content_type)
    if not ext:
        raise HTTPException(
            status_code=400,
            detail="Chỉ hỗ trợ ảnh JPEG, PNG, WebP hoặc GIF.",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File ảnh trống.")
    if len(raw) > MAX_BG_BYTES:
        raise HTTPException(status_code=400, detail="Ảnh vượt quá 12MB.")

    ensure_map_bg_dir()
    filename = f"map_{map_id}_{uuid.uuid4().hex}{ext}"
    dest = MAP_BG_DIR / filename
    dest.write_bytes(raw)
    public_url = f"/media/map-backgrounds/{filename}"

    bus = get_panel_bus()
    async with SessionLocal() as session:
        row = await session.get(FloorMapRecord, map_id)
        if not row:
            dest.unlink(missing_ok=True)
            raise HTTPException(status_code=404, detail=f"Không tìm thấy bản đồ: {map_id}")
        old_bg = row.background_url
        row.background_url = public_url
        await session.commit()
        await session.refresh(row)
        _unlink_local_bg(old_bg)
        return _to_out(row, len(bus.devices_on_map(row.id)))


@router.post("/{map_id}/trail-snap", response_model=MapTrailSnapOut)
async def upload_map_trail_snap(
    map_id: int,
    _: RequireWriteLicense,
    file: UploadFile = File(...),
    point_count: int | None = Form(None),
    seqs: str | None = Form(None),
    device_ids: str | None = Form(None),
) -> MapTrailSnapOut:
    """Lưu ảnh chụp bản đồ khi truy vết và ghi sự kiện Lịch sử."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File ảnh trống.")
    if len(raw) > MAX_TRAIL_SNAP_BYTES:
        raise HTTPException(status_code=400, detail="Ảnh vượt quá 4MB.")
    if not raw.startswith(JPEG_MAGIC):
        raise HTTPException(status_code=400, detail="Chỉ nhận ảnh JPEG.")

    async with SessionLocal() as session:
        row = await session.get(FloorMapRecord, map_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy bản đồ: {map_id}")
        map_name = row.name

    ensure_map_snap_dir()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"map_{map_id}_{stamp}_{uuid.uuid4().hex[:8]}.jpg"
    dest = MAP_SNAP_DIR / filename
    dest.write_bytes(raw)
    public_url = f"/media/map-snaps/{filename}"
    _prune_map_snaps()

    count = point_count if point_count is not None and point_count > 0 else None
    seq_list = [s.strip() for s in (seqs or "").split(",") if s.strip()]
    id_list = [s.strip() for s in (device_ids or "").split(",") if s.strip()]
    detail = f"Truy vết {count} điểm · {map_name}" if count else f"Chụp truy vết · {map_name}"
    await get_event_hub().publish(
        {
            "type": "map_trail_snap",
            "map_id": map_id,
            "map_name": map_name,
            "image_url": public_url,
            "camera_name": map_name,
            "detail": detail,
            "point_count": count,
            "seqs": seq_list,
            "device_ids": id_list,
        }
    )
    return MapTrailSnapOut(ok=True, map_id=map_id, map_name=map_name, image_url=public_url)


@router.delete("/{map_id}/background", response_model=FloorMapOut)
async def clear_map_background(map_id: int, _: RequireWriteLicense) -> FloorMapOut:
    bus = get_panel_bus()
    async with SessionLocal() as session:
        row = await session.get(FloorMapRecord, map_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy bản đồ: {map_id}")
        old_bg = row.background_url
        row.background_url = None
        await session.commit()
        await session.refresh(row)
        _unlink_local_bg(old_bg)
        return _to_out(row, len(bus.devices_on_map(row.id)))


@router.delete("/{map_id}", status_code=204, response_class=Response)
async def delete_map(map_id: int, _: RequireWriteLicense) -> Response:
    bus = get_panel_bus()
    async with SessionLocal() as session:
        row = await session.get(FloorMapRecord, map_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy bản đồ: {map_id}")
        old_bg = row.background_url
        await session.delete(row)
        await session.commit()
    _unlink_local_bg(old_bg)
    await bus.clear_map_placements(map_id)
    return Response(status_code=204)
