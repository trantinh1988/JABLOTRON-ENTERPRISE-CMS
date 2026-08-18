from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.iot_core.device_reaction import DEFAULT_DEVICE_REACTION, REACTION_PATTERN


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
    has_stream_code: bool = False
    device_stream_ok: bool = False


class PanelCreateIn(BaseModel):
    """Khai báo tủ trung tâm. panel_index → PANEL_{n}; hoặc truyền panel_id tường minh."""

    panel_index: int | None = Field(None, ge=1, le=999)
    panel_id: str | None = Field(None, min_length=1, max_length=64)
    display_name: str = Field("", max_length=128)


class PanelUpdateIn(BaseModel):
    display_name: str | None = None
    # Admin/Service PIN to enable realtime device states (0x55/0xd8). Empty clears.
    stream_code: str | None = Field(None, max_length=32)


class PanelProbeConfigOut(BaseModel):
    ok: bool
    mode: str | None = None
    section_nums: list[int] = Field(default_factory=list)
    section_count_hint: int | None = None
    device_count_hint: int | None = None
    pg_count_hint: int | None = None
    user_count_hint: int | None = None
    note: str | None = None
    error: str | None = None


class PanelImportConfigIn(BaseModel):
    """Nhập cấu hình placeholder từ tủ (số lượng như F-Link Initial setup)."""

    section_count: int | None = Field(None, ge=1, le=32)
    device_count: int | None = Field(None, ge=0, le=99)
    user_count: int | None = Field(None, ge=0, le=300)
    pg_count: int | None = Field(None, ge=0, le=128)
    device_type: str = "sensor"
    create_sections: bool = True
    create_devices: bool = True
    create_users: bool = True
    create_pgs: bool = True
    assign_devices_to_first_zone: bool = True


class PanelImportConfigOut(BaseModel):
    ok: bool
    sections_created: int = 0
    devices_created: int = 0
    users_created: int = 0
    pgs_created: int = 0
    sections_skipped: int = 0
    devices_skipped: int = 0
    users_skipped: int = 0
    pgs_skipped: int = 0
    used: dict[str, Any] = Field(default_factory=dict)
    probed: dict[str, Any] | None = None
    synced: int | None = None
    note: str | None = None
    error: str | None = None


class DeviceOut(BaseModel):
    global_id: str
    panel_id: str
    device_id: str
    device_num: int | None = None
    device_type: str = "sensor"
    label: str = ""
    model: str = ""
    # bus | rf | "" (HID length 9 = rf)
    link: str = ""
    state: str = "ok"
    # F-Link Disable: none | input | device | tamper
    disable: str = "none"
    # F-Link Reaction (zone type)
    reaction: str = DEFAULT_DEVICE_REACTION
    zone_id: str | None = None
    map_id: int | None = None
    map_x: float | None = None
    map_y: float | None = None
    map_icon: str = ""
    map_icon_size: float = 2.0


class DeviceCreateIn(BaseModel):
    panel_id: str
    device_num: int = Field(..., ge=0, le=99)
    device_type: str = "sensor"
    label: str = ""
    model: str | None = None
    link: str | None = Field(None, pattern="^(bus|rf|)$")
    zone_id: str | None = None
    map_id: int | None = None
    map_x: float | None = None
    map_y: float | None = None
    map_icon: str | None = Field(None, max_length=64)
    map_icon_size: float | None = Field(None, ge=0.5, le=5.0)
    disable: str | None = Field(None, pattern="^(none|input|device|tamper)$")
    reaction: str | None = Field(None, pattern=REACTION_PATTERN)


class DeviceBulkCreateIn(BaseModel):
    """Khai báo hàng loạt địa chỉ Jablotron (vd. 1→80) trong một lần."""

    panel_id: str
    from_num: int = Field(..., ge=0, le=99)
    to_num: int = Field(..., ge=0, le=99)
    device_type: str = "sensor"
    model: str | None = None
    link: str | None = Field(None, pattern="^(bus|rf|)$")
    label_prefix: str = ""
    zone_id: str | None = None
    map_icon: str | None = Field(None, max_length=64)
    map_icon_size: float | None = Field(None, ge=0.5, le=5.0)
    disable: str | None = Field(None, pattern="^(none|input|device|tamper)$")
    reaction: str | None = Field(None, pattern=REACTION_PATTERN)


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


class AckAlwaysAlarmIn(BaseModel):
    global_ids: list[str] | None = None
    code: str | None = None


class AckAlwaysAlarmOut(BaseModel):
    ok: bool = True
    silenced: list[int] = Field(default_factory=list)
    states: dict[str, str] = Field(default_factory=dict)


class DeviceUpdateIn(BaseModel):
    device_type: str | None = None
    label: str | None = None
    model: str | None = None
    link: str | None = Field(None, pattern="^(bus|rf|)$")
    zone_id: str | None = None
    clear_zone: bool = False
    map_id: int | None = None
    map_x: float | None = None
    map_y: float | None = None
    clear_map: bool = False
    map_icon: str | None = Field(None, max_length=64)
    map_icon_size: float | None = Field(None, ge=0.5, le=5.0)
    disable: str | None = Field(None, pattern="^(none|input|device|tamper)$")
    reaction: str | None = Field(None, pattern=REACTION_PATTERN)


class ZoneOut(BaseModel):
    zone_id: str
    panel_id: str
    name: str
    section_num: int
    armed_state: str = "disarmed"
    keypad_alarm: bool = False


class ZoneCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    section_num: int = Field(..., ge=1, le=32)


class ZoneUpdateIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    section_num: int | None = Field(None, ge=1, le=32)
    armed_state: str | None = None
    detail: str | None = Field(None, max_length=256)


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
    detail: str | None = Field(None, max_length=256)
    code: str | None = Field(None, min_length=4, max_length=10, pattern=r"^\d{4,10}$")
    section_num: int | None = Field(None, ge=1, le=32)


class GroupActionOut(BaseModel):
    action: str
    results: list[dict[str, Any]]


class HealthOut(BaseModel):
    status: str
    app: str
    license_mode: str
    usb_mock_mode: bool
    usb_hid_available: bool = False
    usb_devices_found: int = 0
    usb_panels_connected: int = 0
    usb_last_error: str | None = None
    usb_hint: str | None = None


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


class MapTrailSnapOut(BaseModel):
    ok: bool = True
    map_id: int
    map_name: str
    image_url: str


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
    zone_id: str | None = None
    section_num: int | None = None
    detail: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    ts: str | None = None


CameraBrand = Literal["hikvision", "dahua", "kbvision", "ezviz", "onvif", "generic"]


class CameraOut(BaseModel):
    id: str
    name: str
    brand: str = "generic"
    snapshot_url: str = ""
    rtsp_url: str = ""
    username: str = ""
    has_password: bool = False
    floor_id: int | None = None
    floor_name: str | None = None
    is_active: bool = True
    last_ok_at: str | None = None
    last_checked_at: str | None = None
    last_error: str = ""
    thumbnail_url: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class CameraCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    brand: CameraBrand = "generic"
    snapshot_url: str = Field("", max_length=1024)
    rtsp_url: str = Field("", max_length=1024)
    username: str = Field("", max_length=128)
    password: str = Field("", max_length=256)
    floor_id: int | None = None
    is_active: bool = True


class CameraUpdateIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    brand: CameraBrand | None = None
    snapshot_url: str | None = Field(None, max_length=1024)
    rtsp_url: str | None = Field(None, max_length=1024)
    username: str | None = Field(None, max_length=128)
    password: str | None = Field(None, max_length=256)
    floor_id: int | None = None
    clear_floor: bool = False
    is_active: bool | None = None


class CameraTestIn(BaseModel):
    camera_id: str | None = None
    snapshot_url: str = Field("", max_length=1024)
    rtsp_url: str = Field("", max_length=1024)
    username: str = Field("", max_length=128)
    password: str = Field("", max_length=256)
    brand: CameraBrand = "generic"


class CameraTestOut(BaseModel):
    ok: bool
    source: str | None = None
    content_type: str | None = None
    image_base64: str | None = None
    latency_ms: int | None = None
    error_code: str | None = None
    error: str | None = None
    captured_at: str | None = None


AutomationIfType = Literal[
    "armed_alarm",
    "device_alarm",
    "device_open",
    "tamper",
    "loss",
    "device_fault",
    "section_armed",
    "section_disarmed",
    "panel_armed",
    "panel_disarmed",
    "keypad_alarm",
]
AutomationThenType = Literal["camera_snapshot", "notify"]


class AutomationRuleOut(BaseModel):
    id: str
    name: str
    enabled: bool = True
    if_type: str
    if_panel_id: str | None = None
    if_device_id: str | None = None
    if_zone_id: str | None = None
    if_floor_id: int | None = None
    if_require_armed: bool = False
    then_type: str = "camera_snapshot"
    then_camera_id: str | None = None
    then_camera_name: str | None = None
    cooldown_sec: int = 30
    last_fired_at: str | None = None
    last_error: str = ""
    fire_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class AutomationRuleIn(BaseModel):
    name: str = Field("", max_length=128)
    enabled: bool = True
    if_type: AutomationIfType
    if_panel_id: str | None = Field(None, max_length=64)
    if_device_id: str | None = Field(None, max_length=64)
    if_zone_id: str | None = Field(None, max_length=64)
    if_floor_id: int | None = None
    if_require_armed: bool = False
    then_type: AutomationThenType = "camera_snapshot"
    then_camera_id: str | None = Field(None, max_length=36)
    cooldown_sec: int = Field(30, ge=5, le=3600)


class AutomationSnapOut(BaseModel):
    id: str
    rule_id: str
    camera_id: str | None = None
    camera_name: str = ""
    device_id: str | None = None
    image_url: str = ""
    created_at: str | None = None
