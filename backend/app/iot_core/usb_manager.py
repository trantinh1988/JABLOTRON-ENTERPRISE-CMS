from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Any

from app.core.config import Settings, get_settings
from app.iot_core.device_id import make_device_global_id, make_panel_id
from app.iot_core.event_hub import EventHub, get_event_hub
from app.iot_core.jablotron_protocol import (
    ParsedUpdates,
    build_init_sequence,
    build_poll_sequence,
    pad_hid_packet,
    parse_packet,
    split_packets,
    strip_hid_report_id,
)
from app.iot_core.panel_bus import PanelBus, get_panel_bus
from app.iot_core import panel_store

try:
    import hid  # type: ignore
except Exception:  # noqa: BLE001
    hid = None


@dataclass
class _HidSession:
    panel_id: str
    usb_path: str
    device: Any
    opened_at: float = field(default_factory=time.monotonic)
    last_enable_states_at: float = 0.0


class UsbDeviceManager:
    """
    Background service that discovers Jablotron HID devices and streams events.

    CMS_USB_MOCK_MODE=false: quét USB thật (VID/PID Jablotron), đọc trạng thái HID.
    CMS_USB_MOCK_MODE=true: mô phỏng ngẫu nhiên (dev/demo).
    """

    def __init__(
        self,
        settings: Settings | None = None,
        panel_bus: PanelBus | None = None,
        event_hub: EventHub | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.panel_bus = panel_bus or get_panel_bus()
        self.event_hub = event_hub or get_event_hub()
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._path_to_panel: dict[str, str] = {}
        self._sessions: dict[str, _HidSession] = {}
        self._hid_available: bool = hid is not None
        self._devices_found: int = 0
        self._last_error: str | None = None
        self.panel_bus.set_command_sender(self)

    def get_status(self) -> dict[str, Any]:
        connected = sum(1 for p in self.panel_bus.panels.values() if p.connection == "usb")
        return {
            "hid_available": self._hid_available,
            "devices_found": self._devices_found,
            "panels_usb_connected": connected,
            "last_error": self._last_error,
            "hint": self._connection_hint(),
        }

    def _connection_hint(self) -> str | None:
        if self.settings.usb_mock_mode:
            return None
        if not self._hid_available:
            return "Chưa cài hidapi. Cài: pip install hidapi"
        if self._devices_found > 0:
            return None
        if os.path.exists("/.dockerenv"):
            return (
                "Backend đang chạy trong Docker — không thấy USB. "
                "Chạy: .\\scripts\\start-backend-usb.ps1 rồi docker compose -f docker-compose.usb-host.yml up -d"
            )
        return (
            "Không phát hiện Jablotron Link (VID 16D6 / PID 0008). "
            "Kiểm tra cáp USB, driver và chỉ có một phần mềm truy cập HID."
        )

    def _set_usb_error(self, detail: str) -> None:
        self._last_error = detail

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        if self.settings.usb_mock_mode:
            if not self.panel_bus.panels:
                await self.panel_bus.seed_mock_panels()
        self._task = asyncio.create_task(self._run(), name="usb-device-manager")

    async def stop(self) -> None:
        self._stop.set()
        for session in list(self._sessions.values()):
            self._close_session(session)
        self._sessions.clear()
        if self._task:
            await asyncio.wait([self._task], timeout=3)

    async def send_action(self, panel_id: str, action: str) -> tuple[bool, str]:
        panel = self.panel_bus.panels.get(panel_id)
        if panel is None:
            return False, "panel_not_found"

        if self.settings.usb_mock_mode:
            await asyncio.sleep(0.05)
            return True, f"mock_action:{action}"

        session = self._sessions.get(panel_id)
        if session is None or hid is None:
            return False, "panel_not_connected_usb"

        # Arm/disarm qua USB thật cần UI control + mã PIN — sẽ bổ sung sau.
        return False, "usb_action_not_implemented_use_panel_keypad"

    async def _run(self) -> None:
        if self.settings.usb_mock_mode:
            await self._run_mock()
        else:
            await self._run_hid_real()

    async def _run_mock(self) -> None:
        import random

        states = ["ok", "open", "alarm"]
        while not self._stop.is_set():
            panels = list(self.panel_bus.panels.keys())
            if panels:
                panel_id = random.choice(panels)
                panel = self.panel_bus.panels[panel_id]
                if panel.devices:
                    device = random.choice(list(panel.devices.values()))
                    await self.panel_bus.set_device_state(panel_id, device["device_num"], random.choice(states))
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.settings.mock_event_interval_sec)
            except asyncio.TimeoutError:
                continue

    async def _run_hid_real(self) -> None:
        next_index = 1
        while not self._stop.is_set():
            if hid is None:
                self._devices_found = 0
                self._set_usb_error("Chưa cài hidapi. Cài: pip install hidapi")
                await self.event_hub.publish(
                    {
                        "type": "usb_error",
                        "detail": self._last_error,
                    }
                )
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=self.settings.usb_scan_interval_sec)
                except asyncio.TimeoutError:
                    continue
                continue

            found_paths: set[str] = set()
            try:
                for info in hid.enumerate(
                    self.settings.jablotron_vendor_id,
                    self.settings.jablotron_product_id,
                ):
                    path_str = self._path_str(info.get("path"))
                    if not path_str:
                        continue
                    found_paths.add(path_str)
                    panel_id = await self._ensure_panel_for_path(path_str, next_index)
                    if path_str not in self._path_to_panel.values() and panel_id.startswith("PANEL_"):
                        try:
                            next_index = max(next_index, int(panel_id.removeprefix("PANEL_")) + 1)
                        except ValueError:
                            next_index += 1
                    await self._ensure_session(panel_id, path_str)
                    await self._poll_session(panel_id)
                self._devices_found = len(found_paths)
                if found_paths:
                    self._last_error = None
            except Exception as exc:  # noqa: BLE001
                self._devices_found = 0
                self._set_usb_error(str(exc))
                await self.event_hub.publish({"type": "usb_error", "detail": str(exc)})

            for panel_id, session in list(self._sessions.items()):
                if session.usb_path not in found_paths:
                    self._close_session(session)
                    self._sessions.pop(panel_id, None)
                    panel = self.panel_bus.panels.get(panel_id)
                    if panel:
                        panel.connection = "disconnected"
                        panel.usb_path = None
                        if self.panel_bus._persist:
                            await panel_store.save_panel(panel)
                        await self.event_hub.publish(
                            {"type": "panel_disconnected", "panel_id": panel_id}
                        )

            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.settings.usb_scan_interval_sec)
            except asyncio.TimeoutError:
                continue

    async def _ensure_panel_for_path(self, path_str: str, next_index: int) -> str:
        if path_str in self._path_to_panel:
            panel_id = self._path_to_panel[path_str]
            await self.panel_bus.ensure_panel(panel_id, connection="usb", usb_path=path_str)
            return panel_id

        # Gắn USB vào tủ khai báo thủ công (disconnected) nếu chỉ có một tủ chờ kết nối.
        waiting = [
            p.panel_id
            for p in self.panel_bus.panels.values()
            if p.connection in ("disconnected", "mock") and not p.usb_path
        ]
        if len(waiting) == 1:
            panel_id = waiting[0]
        else:
            panel_id = make_panel_id(next_index)
            await self.panel_bus.ensure_panel(
                panel_id,
                display_name=f"Tủ Jablotron {panel_id.removeprefix('PANEL_')}",
                connection="usb",
                usb_path=path_str,
            )

        self._path_to_panel[path_str] = panel_id
        await self.panel_bus.ensure_panel(panel_id, connection="usb", usb_path=path_str)
        await self.event_hub.publish(
            {"type": "panel_connected", "panel_id": panel_id, "usb_path": path_str}
        )
        return panel_id

    async def _ensure_session(self, panel_id: str, path_str: str) -> None:
        existing = self._sessions.get(panel_id)
        if existing and existing.usb_path == path_str:
            return
        if existing:
            self._close_session(existing)
        device = hid.device()
        device.open_path(path_str.encode("utf-8") if isinstance(path_str, str) else path_str)
        session = _HidSession(panel_id=panel_id, usb_path=path_str, device=device)
        self._sessions[panel_id] = session
        for pkt in build_init_sequence():
            self._hid_write(session, pkt)
            await asyncio.sleep(0.05)
        session.last_enable_states_at = time.monotonic()

    async def _poll_session(self, panel_id: str) -> None:
        session = self._sessions.get(panel_id)
        if not session:
            return

        now = time.monotonic()
        if now - session.last_enable_states_at > 240:
            for pkt in build_init_sequence():
                self._hid_write(session, pkt)
                await asyncio.sleep(0.03)
            session.last_enable_states_at = now
        else:
            for pkt in build_poll_sequence():
                self._hid_write(session, pkt)
                await asyncio.sleep(0.03)

        for _ in range(8):
            raw = self._hid_read(session)
            if not raw:
                break
            for packet in split_packets(raw):
                updates = parse_packet(packet)
                await self._apply_updates(panel_id, updates)

    async def _apply_updates(self, panel_id: str, updates: ParsedUpdates) -> None:
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return

        if updates.panel_armed and panel.armed_state != updates.panel_armed:
            panel.armed_state = updates.panel_armed
            if self.panel_bus._persist:
                await panel_store.save_panel(panel)
            await self.event_hub.publish(
                {
                    "type": "panel_armed",
                    "panel_id": panel_id,
                    "armed_state": updates.panel_armed,
                }
            )

        for section_num, armed in updates.section_states.items():
            for zone in panel.zones.values():
                if zone.get("section_num") == section_num and zone.get("armed_state") != armed:
                    zone["armed_state"] = armed
                    if self.panel_bus._persist:
                        await panel_store.save_zone(zone)
                    await self.event_hub.publish(
                        {
                            "type": "zone_armed",
                            "panel_id": panel_id,
                            "zone_id": zone["zone_id"],
                            "armed_state": armed,
                        }
                    )

        if updates.device_states:
            await self._apply_device_states(panel_id, updates.device_states)

        for pg_num, pg_state in updates.pg_states.items():
            for pg in panel.pgs.values():
                if pg.get("pg_num") == pg_num and pg.get("state") != pg_state:
                    await self.panel_bus.update_pg(panel_id, pg["pg_id"], state=pg_state)

    async def _apply_device_states(self, panel_id: str, device_states: dict[int, str]) -> None:
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return

        updates: dict[str, str] = {}
        for device_num, state in device_states.items():
            global_id = make_device_global_id(panel_id, device_num)
            if global_id not in panel.devices:
                continue
            device = panel.devices[global_id]
            if device.get("state") == state:
                continue
            device["state"] = state
            updates[global_id] = state
            if self.panel_bus._persist:
                asyncio.create_task(panel_store.save_device(device))

        if len(updates) == 1:
            global_id, state = next(iter(updates.items()))
            await self.event_hub.publish(
                {
                    "type": "device_state",
                    "panel_id": panel_id,
                    "device_id": global_id,
                    "state": state,
                }
            )
        elif updates:
            await self.event_hub.publish(
                {
                    "type": "devices_state_batch",
                    "panel_id": panel_id,
                    "updates": updates,
                }
            )

    def _hid_write(self, session: _HidSession, packet: bytes) -> None:
        padded = pad_hid_packet(packet)
        try:
            session.device.write(b"\x00" + padded)
        except Exception:
            try:
                session.device.write(padded)
            except Exception:
                pass

    def _hid_read(self, session: _HidSession) -> bytes:
        try:
            data = session.device.read(64, timeout_ms=80)
            if not data:
                return b""
            return strip_hid_report_id(bytes(data))
        except Exception:
            return b""

    def _close_session(self, session: _HidSession) -> None:
        try:
            session.device.close()
        except Exception:
            pass

    @staticmethod
    def _path_str(path: Any) -> str:
        if isinstance(path, bytes):
            return path.decode("utf-8", errors="replace")
        return str(path) if path else ""

    def read_raw_hex(self, panel_id: str, size: int = 64) -> str | None:
        session = self._sessions.get(panel_id)
        if not session:
            panel = self.panel_bus.panels.get(panel_id)
            if not panel or not panel.usb_path or hid is None:
                return None
            try:
                device = hid.device()
                device.open_path(
                    panel.usb_path.encode("utf-8")
                    if isinstance(panel.usb_path, str)
                    else panel.usb_path
                )
                data = device.read(size, timeout_ms=100)
                device.close()
                return bytes(data).hex() if data else ""
            except Exception:
                return None
        data = self._hid_read(session)
        return data.hex() if data else ""


_usb_manager: UsbDeviceManager | None = None


def get_usb_manager() -> UsbDeviceManager:
    global _usb_manager
    if _usb_manager is None:
        _usb_manager = UsbDeviceManager()
    return _usb_manager
