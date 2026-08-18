from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class PanelRecord(Base):
    __tablename__ = "panels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    panel_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    connection: Mapped[str] = mapped_column(String(32), default="disconnected")  # usb|mock|disconnected
    usb_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    armed_state: Mapped[str] = mapped_column(String(32), default="disarmed")  # armed|disarmed|partial
    # Admin/Service PIN used only to enable HID device-state stream (0x55/0xd8). Never returned by API.
    stream_code: Mapped[str] = mapped_column(String(32), default="")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FloorMapRecord(Base):
    __tablename__ = "floor_maps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    description: Mapped[str] = mapped_column(String(512), default="")
    width: Mapped[float] = mapped_column(Float, default=100.0)
    height: Mapped[float] = mapped_column(Float, default=70.0)
    background_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DeviceRecord(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    global_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # PANEL_1_DEV_05
    panel_id: Mapped[str] = mapped_column(String(64), index=True)
    device_id: Mapped[str] = mapped_column(String(32))
    device_type: Mapped[str] = mapped_column(String(64), default="sensor")
    label: Mapped[str] = mapped_column(String(128), default="")
    # Manual or unique HID SKU (JA-118M). Empty when HID cannot identify (byte 0x04).
    model: Mapped[str] = mapped_column(String(64), default="")
    # bus | rf from GET_DEVICE_STATUS length; empty until probed.
    link: Mapped[str] = mapped_column(String(8), default="")
    state: Mapped[str] = mapped_column(String(32), default="ok")  # ok|open|alarm|tamper|loss|fault
    # F-Link Disable column: none|input|device|tamper
    disable: Mapped[str] = mapped_column(String(16), default="none")
    # F-Link Reaction (zone type): instant|24h|fire|panic_silent|…
    reaction: Mapped[str] = mapped_column(String(32), default="instant")
    zone_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    map_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    map_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    map_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Icon key from CMS library (alarm/cctv/network/…); empty → fall back to device_type
    map_icon: Mapped[str] = mapped_column(String(64), default="")
    # Map marker size in floor-map units (typical 0.5–5.0)
    map_icon_size: Mapped[float] = mapped_column(Float, default=2.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ZoneRecord(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    zone_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    panel_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    section_num: Mapped[int] = mapped_column(Integer)
    armed_state: Mapped[str] = mapped_column(String(32), default="disarmed")


class PanelUserRecord(Base):
    __tablename__ = "panel_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    panel_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    code_label: Mapped[str] = mapped_column(String(128), default="")
    permissions_json: Mapped[str] = mapped_column(Text, default="[]")


class PgRecord(Base):
    __tablename__ = "pg_outputs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pg_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    panel_id: Mapped[str] = mapped_column(String(64), index=True)
    pg_num: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(128), default="")
    zone_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mode: Mapped[str] = mapped_column(String(32), default="pulse")
    state: Mapped[str] = mapped_column(String(32), default="off")


class EventRecord(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    panel_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LicenseRecord(Base):
    __tablename__ = "licenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hwid: Mapped[str] = mapped_column(String(128), index=True)
    app_code: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[str] = mapped_column(Text)
    signature: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="active")
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CameraRecord(Base):
    """IP camera registry — snapshot URL first; RTSP is optional fallback."""

    __tablename__ = "cameras"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    brand: Mapped[str] = mapped_column(String(32), default="generic")
    snapshot_url: Mapped[str] = mapped_column(Text, default="")
    rtsp_url: Mapped[str] = mapped_column(Text, default="")
    username_enc: Mapped[str] = mapped_column(Text, default="")
    password_enc: Mapped[str] = mapped_column(Text, default="")
    floor_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(String(256), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AutomationRuleRecord(Base):
    """IF → THEN rule. Matched in-process from EventHub (no polling)."""

    __tablename__ = "automation_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    if_type: Mapped[str] = mapped_column(String(32), index=True)
    if_panel_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    if_device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    if_zone_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    if_floor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    if_require_armed: Mapped[bool] = mapped_column(Boolean, default=False)
    then_type: Mapped[str] = mapped_column(String(32), default="camera_snapshot")
    then_camera_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    cooldown_sec: Mapped[int] = mapped_column(Integer, default=30)
    last_fired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(String(256), default="")
    fire_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AutomationSnapRecord(Base):
    __tablename__ = "automation_snaps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    rule_id: Mapped[str] = mapped_column(String(36), index=True)
    camera_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    camera_name: Mapped[str] = mapped_column(String(128), default="")
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    image_url: Mapped[str] = mapped_column(String(256), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
