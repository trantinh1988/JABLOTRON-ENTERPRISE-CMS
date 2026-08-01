from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class LicenseStatusOut(BaseModel):
    status: str
    mode: str
    hwid: str
    app_code: str
    expires_at: str | None = None
    issued_at: str | None = None
    features: list[str] = Field(default_factory=list)
    customer: str | None = None
    reason: str | None = None


class LicenseImportResult(BaseModel):
    ok: bool
    license: LicenseStatusOut


class ExportReqQuery(BaseModel):
    customer: str | None = None


class PanelOut(BaseModel):
    panel_id: str
    display_name: str
    connection: str
    usb_path: str | None = None
    armed_state: str
    last_seen_at: str | None = None
    device_count: int = 0
    zone_count: int = 0
    user_count: int = 0
    pg_count: int = 0


class PanelCreateIn(BaseModel):
    """Khai báo tủ trung tâm. panel_index → PANEL_{n}; hoặc truyền panel_id tường minh."""

    panel_index: int | None = Field(None, ge=1, le=999)
    panel_id: str | None = Field(None, min_length=1, max_length=64)
    display_name: str = Field("", max_length=128)


class PanelUpdateIn(BaseModel):
    display_name: str | None = None


class DeviceOut(BaseModel):
    global_id: str
    panel_id: str
    device_id: str
    device_num: int | None = None
    device_type: str = "sensor"
    label: str = ""
    state: str = "ok"
    zone_id: str | None = None
    map_id: int | None = None
    map_x: float | None = None
    map_y: float | None = None


class DeviceCreateIn(BaseModel):
    panel_id: str
    device_num: int = Field(..., ge=0, le=99)
    device_type: str = "sensor"
    label: str = ""
    zone_id: str | None = None
    map_id: int | None = None
    map_x: float | None = None
    map_y: float | None = None


class DeviceBulkCreateIn(BaseModel):
    """Khai báo hàng loạt địa chỉ Jablotron (vd. 1→80) trong một lần."""

    panel_id: str
    from_num: int = Field(..., ge=0, le=99)
    to_num: int = Field(..., ge=0, le=99)
    device_type: str = "sensor"
    label_prefix: str = ""


class DeviceBulkCreateOut(BaseModel):
    created: list[DeviceOut] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    created_count: int = 0
    skipped_count: int = 0


class DeviceBulkDeleteIn(BaseModel):
    global_ids: list[str] = Field(..., min_length=1)


class DeviceBulkDeleteOut(BaseModel):
    deleted: list[str] = Field(default_factory=list)
    deleted_count: int = 0
    missing: list[str] = Field(default_factory=list)


class DeviceUpdateIn(BaseModel):
    device_type: str | None = None
    label: str | None = None
    zone_id: str | None = None
    clear_zone: bool = False
    map_id: int | None = None
    map_x: float | None = None
    map_y: float | None = None
    clear_map: bool = False


class ZoneOut(BaseModel):
    zone_id: str
    panel_id: str
    name: str
    section_num: int
    armed_state: str = "disarmed"


class ZoneCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    section_num: int = Field(..., ge=1, le=32)


class ZoneUpdateIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    section_num: int | None = Field(None, ge=1, le=32)
    armed_state: str | None = None


PanelPermission = Literal["arm", "disarm", "partial", "pg_control", "bypass", "admin"]


class PanelUserOut(BaseModel):
    user_id: str
    panel_id: str
    name: str
    code_label: str = ""
    permissions: list[str] = Field(default_factory=list)


class PanelUserCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    code_label: str = Field("", max_length=64)
    permissions: list[PanelPermission] = Field(default_factory=list)


class PanelUserUpdateIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    code_label: str | None = Field(None, max_length=64)
    permissions: list[PanelPermission] | None = None


PgMode = Literal["pulse", "latched", "timed"]
PgState = Literal["off", "on"]


class PgOutputOut(BaseModel):
    pg_id: str
    panel_id: str
    pg_num: int
    label: str = ""
    zone_id: str | None = None
    mode: str = "pulse"
    state: str = "off"


class PgOutputCreateIn(BaseModel):
    pg_num: int = Field(..., ge=1, le=128)
    label: str = ""
    zone_id: str | None = None
    mode: PgMode = "pulse"


class PgOutputUpdateIn(BaseModel):
    pg_num: int | None = Field(None, ge=1, le=128)
    label: str | None = None
    zone_id: str | None = None
    mode: PgMode | None = None
    state: PgState | None = None


class GroupActionIn(BaseModel):
    panel_ids: list[str] = Field(..., min_length=1)
    action: Literal["arm", "disarm", "partial"]


class GroupActionOut(BaseModel):
    action: str
    results: list[dict[str, Any]]


class HealthOut(BaseModel):
    status: str
    app: str
    license_mode: str
    usb_mock_mode: bool


class FloorMapOut(BaseModel):
    id: int
    name: str
    description: str = ""
    width: float = 100.0
    height: float = 70.0
    background_url: str | None = None
    device_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class FloorMapCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    width: float = Field(100.0, gt=0, le=1000)
    height: float = Field(70.0, gt=0, le=1000)
    background_url: str | None = None


class FloorMapUpdateIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    description: str | None = None
    width: float | None = Field(None, gt=0, le=1000)
    height: float | None = Field(None, gt=0, le=1000)
    background_url: str | None = None


class EventOut(BaseModel):
    id: int
    type: str
    panel_id: str | None = None
    device_id: str | None = None
    state: str | None = None
    armed_state: str | None = None
    detail: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    ts: str | None = None
