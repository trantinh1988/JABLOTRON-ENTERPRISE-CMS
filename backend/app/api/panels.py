from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from app.core.deps import RequireWriteLicense
from app.core.config import get_settings
from app.iot_core.panel_bus import get_panel_bus
from app.iot_core.device_id import make_panel_id
from app.schemas.common import (
    DeviceBulkCreateIn,
    DeviceBulkCreateOut,
    DeviceBulkDeleteIn,
    DeviceBulkDeleteOut,
    DeviceCreateIn,
    DeviceOut,
    DeviceUpdateIn,
    GroupActionIn,
    GroupActionOut,
    PanelCreateIn,
    PanelOut,
    PanelUpdateIn,
    PanelUserCreateIn,
    PanelUserOut,
    PanelUserUpdateIn,
    PgOutputCreateIn,
    PgOutputOut,
    PgOutputUpdateIn,
    ZoneCreateIn,
    ZoneOut,
    ZoneUpdateIn,
)

router = APIRouter(prefix="/api/panels", tags=["panels"])


def _panel_out(bus, panel) -> PanelOut:
    data = {
        "panel_id": panel.panel_id,
        "display_name": panel.display_name,
        "connection": panel.connection,
        "usb_path": panel.usb_path,
        "armed_state": panel.armed_state,
        "last_seen_at": panel.last_seen_at,
        "device_count": len(panel.devices),
        "zone_count": len(panel.zones),
        "user_count": len(panel.users),
        "pg_count": len(panel.pgs),
    }
    return PanelOut.model_validate(data)


def _require_panel(bus, panel_id: str):
    if panel_id not in bus.panels:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tủ: {panel_id}")
    return bus.panels[panel_id]


@router.get("", response_model=list[PanelOut])
async def list_panels() -> list[PanelOut]:
    bus = get_panel_bus()
    return [_panel_out(bus, p) for p in bus.panels.values()]


@router.get("/{panel_id}", response_model=PanelOut)
async def get_panel(panel_id: str) -> PanelOut:
    bus = get_panel_bus()
    panel = _require_panel(bus, panel_id)
    return _panel_out(bus, panel)


@router.post("", response_model=PanelOut, status_code=201)
async def create_panel(body: PanelCreateIn, _: RequireWriteLicense) -> PanelOut:
    """Khai báo tủ trung tâm thủ công (khi chưa kết nối USB)."""
    bus = get_panel_bus()
    if body.panel_id:
        panel_id = body.panel_id.strip().upper()
    elif body.panel_index is not None:
        panel_id = make_panel_id(body.panel_index)
    else:
        used = set()
        for p in bus.panels:
            if p.startswith("PANEL_"):
                try:
                    used.add(int(p.removeprefix("PANEL_")))
                except ValueError:
                    pass
        nxt = 1
        while nxt in used:
            nxt += 1
        panel_id = make_panel_id(nxt)

    if panel_id in bus.panels:
        raise HTTPException(status_code=409, detail=f"Tủ đã tồn tại: {panel_id}")

    display = body.display_name.strip() or f"Tủ Jablotron {panel_id.removeprefix('PANEL_')}"
    default_conn = "mock" if get_settings().usb_mock_mode else "disconnected"
    panel = await bus.ensure_panel(panel_id, display_name=display, connection=default_conn)
    await bus.event_hub.publish(
        {
            "type": "panel_declared",
            "panel_id": panel_id,
            "detail": display,
        }
    )
    return _panel_out(bus, panel)


@router.patch("/{panel_id}", response_model=PanelOut)
async def update_panel(panel_id: str, body: PanelUpdateIn, _: RequireWriteLicense) -> PanelOut:
    bus = get_panel_bus()
    if panel_id not in bus.panels:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tủ: {panel_id}")
    panel = await bus.ensure_panel(panel_id, display_name=body.display_name)
    await bus.event_hub.publish(
        {
            "type": "panel_updated",
            "panel_id": panel_id,
            "detail": panel.display_name,
        }
    )
    return _panel_out(bus, panel)


@router.delete("/{panel_id}", status_code=204, response_class=Response)
async def delete_panel(panel_id: str, _: RequireWriteLicense) -> Response:
    bus = get_panel_bus()
    if panel_id not in bus.panels:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tủ: {panel_id}")
    device_count = len(bus.panels[panel_id].devices)
    ok = await bus.delete_panel(panel_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tủ: {panel_id}")
    await bus.event_hub.publish(
        {
            "type": "panel_deleted",
            "panel_id": panel_id,
            "detail": f"Đã xóa tủ và {device_count} thiết bị",
        }
    )
    return Response(status_code=204)


@router.get("/{panel_id}/devices", response_model=list[DeviceOut])
async def list_devices(
    panel_id: str,
    zone_id: str | None = Query(None),
) -> list[DeviceOut]:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    devices = bus.list_devices(panel_id)
    if zone_id:
        devices = [d for d in devices if d.get("zone_id") == zone_id]
    return [DeviceOut.model_validate(d) for d in devices]


@router.get("/{panel_id}/zones", response_model=list[ZoneOut])
async def list_zones(panel_id: str) -> list[ZoneOut]:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    return [ZoneOut.model_validate(z) for z in bus.list_zones(panel_id)]


@router.post("/{panel_id}/zones", response_model=ZoneOut, status_code=201)
async def create_zone(panel_id: str, body: ZoneCreateIn, _: RequireWriteLicense) -> ZoneOut:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    try:
        zone = await bus.create_zone(panel_id, name=body.name, section_num=body.section_num)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return ZoneOut.model_validate(zone)


@router.patch("/{panel_id}/zones/{zone_id}", response_model=ZoneOut)
async def update_zone(
    panel_id: str,
    zone_id: str,
    body: ZoneUpdateIn,
    _: RequireWriteLicense,
) -> ZoneOut:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    try:
        zone = await bus.update_zone(panel_id, zone_id, **body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if not zone:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy vùng: {zone_id}")
    return ZoneOut.model_validate(zone)


@router.delete("/{panel_id}/zones/{zone_id}", status_code=204, response_class=Response)
async def delete_zone(panel_id: str, zone_id: str, _: RequireWriteLicense) -> Response:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    ok = await bus.delete_zone(panel_id, zone_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy vùng: {zone_id}")
    return Response(status_code=204)


@router.get("/{panel_id}/users", response_model=list[PanelUserOut])
async def list_users(panel_id: str) -> list[PanelUserOut]:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    return [PanelUserOut.model_validate(u) for u in bus.list_users(panel_id)]


@router.post("/{panel_id}/users", response_model=PanelUserOut, status_code=201)
async def create_user(panel_id: str, body: PanelUserCreateIn, _: RequireWriteLicense) -> PanelUserOut:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    user = await bus.create_user(
        panel_id,
        name=body.name,
        code_label=body.code_label,
        permissions=list(body.permissions),
    )
    return PanelUserOut.model_validate(user)


@router.patch("/{panel_id}/users/{user_id}", response_model=PanelUserOut)
async def update_user(
    panel_id: str,
    user_id: str,
    body: PanelUserUpdateIn,
    _: RequireWriteLicense,
) -> PanelUserOut:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    user = await bus.update_user(panel_id, user_id, **body.model_dump(exclude_unset=True))
    if not user:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy user: {user_id}")
    return PanelUserOut.model_validate(user)


@router.delete("/{panel_id}/users/{user_id}", status_code=204, response_class=Response)
async def delete_user(panel_id: str, user_id: str, _: RequireWriteLicense) -> Response:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    ok = await bus.delete_user(panel_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy user: {user_id}")
    return Response(status_code=204)


@router.get("/{panel_id}/pgs", response_model=list[PgOutputOut])
async def list_pgs(panel_id: str) -> list[PgOutputOut]:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    return [PgOutputOut.model_validate(p) for p in bus.list_pgs(panel_id)]


@router.post("/{panel_id}/pgs", response_model=PgOutputOut, status_code=201)
async def create_pg(panel_id: str, body: PgOutputCreateIn, _: RequireWriteLicense) -> PgOutputOut:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    try:
        pg = await bus.create_pg(
            panel_id,
            pg_num=body.pg_num,
            label=body.label,
            zone_id=body.zone_id,
            mode=body.mode,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return PgOutputOut.model_validate(pg)


@router.patch("/{panel_id}/pgs/{pg_id}", response_model=PgOutputOut)
async def update_pg(
    panel_id: str,
    pg_id: str,
    body: PgOutputUpdateIn,
    _: RequireWriteLicense,
) -> PgOutputOut:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    try:
        pg = await bus.update_pg(panel_id, pg_id, **body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if not pg:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy PG: {pg_id}")
    return PgOutputOut.model_validate(pg)


@router.delete("/{panel_id}/pgs/{pg_id}", status_code=204, response_class=Response)
async def delete_pg(panel_id: str, pg_id: str, _: RequireWriteLicense) -> Response:
    bus = get_panel_bus()
    _require_panel(bus, panel_id)
    ok = await bus.delete_pg(panel_id, pg_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy PG: {pg_id}")
    return Response(status_code=204)


@router.post("/group-action", response_model=GroupActionOut)
async def group_action(
    body: GroupActionIn,
    _: RequireWriteLicense,
) -> GroupActionOut:
    bus = get_panel_bus()
    result = await bus.group_action(body.panel_ids, body.action)
    return GroupActionOut.model_validate(result)


# --- Devices (cross-panel) ---

devices_router = APIRouter(prefix="/api/devices", tags=["devices"])


@devices_router.get("", response_model=list[DeviceOut])
async def list_all_devices(
    panel_id: str | None = Query(None),
    zone_id: str | None = Query(None),
    map_id: int | None = Query(None),
    state: str | None = Query(None),
) -> list[DeviceOut]:
    bus = get_panel_bus()
    devices = bus.list_all_devices()
    if panel_id:
        devices = [d for d in devices if d["panel_id"] == panel_id]
    if zone_id:
        devices = [d for d in devices if d.get("zone_id") == zone_id]
    if map_id is not None:
        devices = [d for d in devices if d.get("map_id") == map_id]
    if state:
        devices = [d for d in devices if d.get("state") == state]
    return [DeviceOut.model_validate(d) for d in devices]


@devices_router.post("", response_model=DeviceOut, status_code=201)
async def create_device(body: DeviceCreateIn, _: RequireWriteLicense) -> DeviceOut:
    bus = get_panel_bus()
    global_id = f"{body.panel_id}_DEV_{body.device_num:02d}"
    if bus.get_device(global_id):
        raise HTTPException(status_code=409, detail=f"Thiết bị đã tồn tại: {global_id}")
    try:
        device = await bus.upsert_device(
            body.panel_id,
            body.device_num,
            device_type=body.device_type,
            label=body.label or None,
            zone_id=body.zone_id,
            update_zone=body.zone_id is not None,
            map_id=body.map_id,
            map_x=body.map_x,
            map_y=body.map_y,
            update_map=body.map_id is not None or body.map_x is not None,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await bus.event_hub.publish(
        {
            "type": "device_declared",
            "panel_id": body.panel_id,
            "device_id": device["global_id"],
            "detail": body.label or device["global_id"],
        }
    )
    return DeviceOut.model_validate(device)


@devices_router.post("/bulk-delete", response_model=DeviceBulkDeleteOut)
async def delete_devices_bulk(body: DeviceBulkDeleteIn, _: RequireWriteLicense) -> DeviceBulkDeleteOut:
    bus = get_panel_bus()
    missing = [gid for gid in body.global_ids if not bus.get_device(gid)]
    deleted = await bus.delete_devices([gid for gid in body.global_ids if gid not in missing])
    if deleted:
        await bus.event_hub.publish(
            {
                "type": "device_deleted",
                "detail": f"Xóa {len(deleted)} thiết bị",
            }
        )
    return DeviceBulkDeleteOut(
        deleted=deleted,
        deleted_count=len(deleted),
        missing=missing,
    )


@devices_router.post("/bulk", response_model=DeviceBulkCreateOut, status_code=201)
async def create_devices_bulk(body: DeviceBulkCreateIn, _: RequireWriteLicense) -> DeviceBulkCreateOut:
    """Khai báo một dải địa chỉ (vd. 1→80) trong một lần gọi."""
    if body.to_num < body.from_num:
        raise HTTPException(status_code=422, detail="to_num phải >= from_num")
    bus = get_panel_bus()
    await bus.ensure_panel(body.panel_id)
    created: list[DeviceOut] = []
    skipped: list[str] = []
    prefix = body.label_prefix.strip()
    for num in range(body.from_num, body.to_num + 1):
        global_id = f"{body.panel_id}_DEV_{num:02d}"
        if bus.get_device(global_id):
            skipped.append(global_id)
            continue
        label = f"{prefix} {num}".strip() if prefix else f"Địa chỉ {num}"
        device = await bus.upsert_device(
            body.panel_id,
            num,
            device_type=body.device_type,
            label=label,
        )
        created.append(DeviceOut.model_validate(device))
    if created:
        await bus.event_hub.publish(
            {
                "type": "device_declared",
                "panel_id": body.panel_id,
                "detail": f"Khai báo {len(created)} thiết bị ({body.from_num}→{body.to_num})",
            }
        )
    return DeviceBulkCreateOut(
        created=created,
        skipped=skipped,
        created_count=len(created),
        skipped_count=len(skipped),
    )


@devices_router.get("/{global_id}", response_model=DeviceOut)
async def get_device(global_id: str) -> DeviceOut:
    bus = get_panel_bus()
    device = bus.get_device(global_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy thiết bị: {global_id}")
    return DeviceOut.model_validate(device)


@devices_router.patch("/{global_id}", response_model=DeviceOut)
async def update_device(global_id: str, body: DeviceUpdateIn, _: RequireWriteLicense) -> DeviceOut:
    bus = get_panel_bus()
    if not bus.get_device(global_id):
        raise HTTPException(status_code=404, detail=f"Không tìm thấy thiết bị: {global_id}")
    fields = body.model_dump(exclude_unset=True)
    clear_map = fields.pop("clear_map", False)
    clear_zone = fields.pop("clear_zone", False)
    update_map = clear_map or "map_id" in fields or "map_x" in fields or "map_y" in fields
    update_zone = clear_zone or "zone_id" in fields
    try:
        device = await bus.update_device(
            global_id,
            device_type=fields.get("device_type"),
            label=fields.get("label"),
            zone_id=fields.get("zone_id"),
            update_zone=update_zone and not clear_zone,
            clear_zone=clear_zone,
            map_id=fields.get("map_id"),
            map_x=fields.get("map_x"),
            map_y=fields.get("map_y"),
            update_map=update_map and not clear_map,
            clear_map=clear_map,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    assert device is not None
    await bus.event_hub.publish(
        {
            "type": "device_updated",
            "panel_id": device["panel_id"],
            "device_id": device["global_id"],
            "detail": device.get("label") or device["global_id"],
        }
    )
    return DeviceOut.model_validate(device)


@devices_router.delete("/{global_id}", status_code=204, response_class=Response)
async def delete_device(global_id: str, _: RequireWriteLicense) -> Response:
    bus = get_panel_bus()
    device = bus.get_device(global_id)
    if not device:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy thiết bị: {global_id}")
    panel_id = device["panel_id"]
    await bus.delete_device(global_id)
    await bus.event_hub.publish(
        {
            "type": "device_deleted",
            "panel_id": panel_id,
            "device_id": global_id,
        }
    )
    return Response(status_code=204)
