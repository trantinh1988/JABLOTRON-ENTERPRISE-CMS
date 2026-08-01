from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
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
    state: Mapped[str] = mapped_column(String(32), default="ok")  # ok|open|alarm
    zone_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    map_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    map_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    map_y: Mapped[float | None] = mapped_column(Float, nullable=True)
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
