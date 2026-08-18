from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.core.deps import RequireWriteLicense
from app.db.models import CameraRecord, FloorMapRecord
from app.db.session import SessionLocal
from app.iot_core.camera_service import (
    CameraCaptureError,
    camera_thumb_url,
    capture_camera_snapshot,
    decrypt_secret,
    encrypt_secret,
    save_camera_thumb,
    probe_camera_connection,
    unlink_camera_thumb,
    validate_http_url,
    validate_rtsp_url,
)
from app.schemas.common import CameraCreateIn, CameraOut, CameraTestIn, CameraTestOut, CameraUpdateIn

router = APIRouter(prefix="/api/cameras", tags=["cameras"])
log = logging.getLogger(__name__)


def _iso(dt) -> str | None:  # type: ignore[untyped-def]
    if dt is None:
        return None
    return dt.isoformat().replace("+00:00", "Z")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _validate_urls(snapshot_url: str, rtsp_url: str) -> tuple[str, str]:
    try:
        snap = validate_http_url(snapshot_url)
        rtsp = validate_rtsp_url(rtsp_url)
    except CameraCaptureError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    if not snap and not rtsp:
        raise HTTPException(status_code=400, detail="Cần ít nhất Snapshot URL hoặc RTSP URL.")
    return snap, rtsp


async def _floor_names(floor_ids: set[int]) -> dict[int, str]:
    if not floor_ids:
        return {}
    async with SessionLocal() as session:
        result = await session.execute(select(FloorMapRecord).where(FloorMapRecord.id.in_(floor_ids)))
        return {row.id: row.name for row in result.scalars().all()}


def _to_out(row: CameraRecord, floor_name: str | None = None) -> CameraOut:
    return CameraOut(
        id=row.id,
        name=row.name,
        brand=row.brand or "generic",
        snapshot_url=row.snapshot_url or "",
        rtsp_url=row.rtsp_url or "",
        username=decrypt_secret(row.username_enc),
        has_password=bool(row.password_enc),
        floor_id=row.floor_id,
        floor_name=floor_name,
        is_active=bool(row.is_active),
        last_ok_at=_iso(row.last_ok_at),
        last_checked_at=_iso(row.last_checked_at),
        last_error=row.last_error or "",
        thumbnail_url=camera_thumb_url(row.id),
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def _test_out_ok(result) -> CameraTestOut:  # type: ignore[no-untyped-def]
    return CameraTestOut(
        ok=True,
        source=result.source,
        content_type=result.content_type,
        image_base64=result.to_base64(),
        latency_ms=result.latency_ms,
        captured_at=result.captured_at,
    )


def _test_out_err(exc: CameraCaptureError) -> CameraTestOut:
    return CameraTestOut(ok=False, error_code=exc.code, error=exc.message)


async def _apply_check(row: CameraRecord, ok: bool, error: str = "") -> None:
    row.last_checked_at = _now()
    if ok:
        row.last_ok_at = row.last_checked_at
        row.last_error = ""
    else:
        row.last_error = (error or "failed")[:256]


@router.get("", response_model=list[CameraOut])
async def list_cameras(floor_id: int | None = Query(None)) -> list[CameraOut]:
    async with SessionLocal() as session:
        stmt = select(CameraRecord).order_by(CameraRecord.created_at.desc())
        if floor_id is not None:
            stmt = stmt.where(CameraRecord.floor_id == floor_id)
        result = await session.execute(stmt)
        rows = list(result.scalars().all())
    names = await _floor_names({r.floor_id for r in rows if r.floor_id is not None})
    return [_to_out(r, names.get(r.floor_id) if r.floor_id is not None else None) for r in rows]


@router.post("/test-connection", response_model=CameraTestOut)
async def test_connection(body: CameraTestIn, _: RequireWriteLicense) -> CameraTestOut:
    payload = body.model_dump()
    if body.camera_id:
        async with SessionLocal() as session:
            row = await session.get(CameraRecord, body.camera_id)
        if row is not None:
            if not payload.get("snapshot_url"):
                payload["snapshot_url"] = row.snapshot_url
            if not payload.get("rtsp_url"):
                payload["rtsp_url"] = row.rtsp_url
            if not payload.get("username"):
                payload["username"] = decrypt_secret(row.username_enc)
            if not payload.get("password"):
                payload["password"] = decrypt_secret(row.password_enc)
    try:
        result = await probe_camera_connection(payload)
        return _test_out_ok(result)
    except CameraCaptureError as exc:
        return _test_out_err(exc)


@router.post("", response_model=CameraOut, status_code=201)
async def create_camera(body: CameraCreateIn, _: RequireWriteLicense) -> CameraOut:
    snap, rtsp = _validate_urls(body.snapshot_url, body.rtsp_url)
    row = CameraRecord(
        id=str(uuid.uuid4()),
        name=body.name.strip(),
        brand=body.brand,
        snapshot_url=snap,
        rtsp_url=rtsp,
        username_enc=encrypt_secret(body.username.strip()),
        password_enc=encrypt_secret(body.password),
        floor_id=body.floor_id,
        is_active=body.is_active,
    )
    async with SessionLocal() as session:
        session.add(row)
        await session.commit()
        await session.refresh(row)
        floor_name = None
        if row.floor_id is not None:
            floor = await session.get(FloorMapRecord, row.floor_id)
            floor_name = floor.name if floor else None
        return _to_out(row, floor_name)


@router.get("/{camera_id}", response_model=CameraOut)
async def get_camera(camera_id: str) -> CameraOut:
    async with SessionLocal() as session:
        row = await session.get(CameraRecord, camera_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy camera.")
        floor_name = None
        if row.floor_id is not None:
            floor = await session.get(FloorMapRecord, row.floor_id)
            floor_name = floor.name if floor else None
        return _to_out(row, floor_name)


@router.put("/{camera_id}", response_model=CameraOut)
async def update_camera(camera_id: str, body: CameraUpdateIn, _: RequireWriteLicense) -> CameraOut:
    async with SessionLocal() as session:
        row = await session.get(CameraRecord, camera_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy camera.")
        if body.name is not None:
            row.name = body.name.strip()
        if body.brand is not None:
            row.brand = body.brand
        snap = body.snapshot_url if body.snapshot_url is not None else row.snapshot_url
        rtsp = body.rtsp_url if body.rtsp_url is not None else row.rtsp_url
        snap, rtsp = _validate_urls(snap or "", rtsp or "")
        row.snapshot_url = snap
        row.rtsp_url = rtsp
        if body.username is not None:
            row.username_enc = encrypt_secret(body.username.strip())
        if body.password is not None:
            row.password_enc = encrypt_secret(body.password)
        if body.clear_floor:
            row.floor_id = None
        elif body.floor_id is not None:
            row.floor_id = body.floor_id
        if body.is_active is not None:
            row.is_active = body.is_active
        await session.commit()
        await session.refresh(row)
        floor_name = None
        if row.floor_id is not None:
            floor = await session.get(FloorMapRecord, row.floor_id)
            floor_name = floor.name if floor else None
        return _to_out(row, floor_name)


@router.delete("/{camera_id}", status_code=204)
async def delete_camera(camera_id: str, _: RequireWriteLicense) -> None:
    async with SessionLocal() as session:
        row = await session.get(CameraRecord, camera_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy camera.")
        await session.delete(row)
        await session.commit()
    unlink_camera_thumb(camera_id)


@router.post("/{camera_id}/snapshot", response_model=CameraTestOut)
async def snapshot_camera(camera_id: str, _: RequireWriteLicense) -> CameraTestOut:
    async with SessionLocal() as session:
        row = await session.get(CameraRecord, camera_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy camera.")
        try:
            result = await capture_camera_snapshot(row)
            await _apply_check(row, True)
            save_camera_thumb(row.id, result.image_bytes)
            await session.commit()
            return _test_out_ok(result)
        except CameraCaptureError as exc:
            await _apply_check(row, False, exc.message)
            await session.commit()
            return _test_out_err(exc)
