from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.core.config import Settings, get_settings
from app.iot_core.device_id import make_device_global_id, make_panel_id
from app.iot_core.event_hub import EventHub, get_event_hub
from app.iot_core.jablotron_protocol import (
    PROBLEM_DEVICE_STATES,
    ParsedUpdates,
    build_arm_sequence,
    build_init_sequence,
    build_poll_sequence,
    empty_updates,
    inventory_hints_from_updates,
    is_login_error_packet,
    merge_updates,
    pad_hid_packet,
    parse_packet,
    packet_sort_key,
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
    last_live_publish_at: float = 0.0
    last_snapshot_publish_at: float = 0.0
    last_packet_at: float = 0.0


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
        self._scanned_devices: list[dict[str, Any]] = []
        self._last_scan_log_at: float = 0.0
        self.panel_bus.set_command_sender(self)

    def _enumerate_hid_devices(self) -> list[dict[str, Any]]:
        if hid is None:
            return []
        vid = self.settings.jablotron_vendor_id
        pid = self.settings.jablotron_product_id
        seen_paths: set[str] = set()
        results: list[dict[str, Any]] = []

        def add(info: dict[str, Any]) -> None:
            path_str = self._path_str(info.get("path"))
            if not path_str or path_str in seen_paths:
                return
            seen_paths.add(path_str)
            results.append(
                {
                    "path": path_str,
                    "vendor_id": info.get("vendor_id"),
                    "product_id": info.get("product_id"),
                    "vendor_hex": f"0x{int(info.get('vendor_id', 0)):04X}",
                    "product_hex": f"0x{int(info.get('product_id', 0)):04X}",
                    "product_string": info.get("product_string") or "",
                    "manufacturer_string": info.get("manufacturer_string") or "",
                }
            )

        for info in hid.enumerate(vid, pid):
            add(info)
        if not results and pid:
            for info in hid.enumerate(vid, 0):
                add(info)
        if not results:
            for info in hid.enumerate(0, 0):
                if int(info.get("vendor_id", 0)) == vid:
                    add(info)
        return results

    def get_status(self) -> dict[str, Any]:
        connected = sum(1 for p in self.panel_bus.panels.values() if p.connection == "usb")
        return {
            "hid_available": self._hid_available,
            "devices_found": self._devices_found,
            "panels_usb_connected": connected,
            "last_error": self._last_error,
            "hint": self._connection_hint(),
            "scanned_devices": list(self._scanned_devices),
            "active_sessions": list(self._sessions.keys()),
        }

    def _connection_hint(self) -> str | None:
        if self.settings.usb_mock_mode:
            return None
        if not self._hid_available:
            return "Chưa cài hidapi. Cài: pip install hidapi"
        if self._sessions or self._devices_found > 0:
            return None
        if self._scanned_devices:
            return None
        connected = sum(1 for p in self.panel_bus.panels.values() if p.connection == "usb")
        if connected > 0:
            return None
        if os.path.exists("/.dockerenv"):
            return (
                "Backend đang chạy trong Docker — không thấy USB. "
                "Linux: bash scripts/stop-cms.sh && bash scripts/deploy-usb-linux.sh "
                "(backend native port 8010, không dùng docker compose up). "
                "Windows: .\\scripts\\start-backend-usb.ps1"
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

    async def send_action(
        self,
        panel_id: str,
        action: str,
        *,
        code: str | None = None,
        section_num: int | None = None,
    ) -> tuple[bool, str]:
        panel = self.panel_bus.panels.get(panel_id)
        if panel is None:
            return False, "panel_not_found"

        if action not in ("arm", "disarm", "partial"):
            return False, "invalid_action"

        if self.settings.usb_mock_mode:
            await asyncio.sleep(0.05)
            return True, f"mock_action:{action}"

        session = self._sessions.get(panel_id)
        if session is None or hid is None:
            return False, "panel_not_connected_usb"

        pin = (code or "").strip()
        if not pin:
            return False, "pin_required"

        if section_num is not None:
            sections = [int(section_num)]
        elif panel.zones:
            sections = sorted({int(z["section_num"]) for z in panel.zones.values()})
        else:
            sections = [1]

        try:
            packets = build_arm_sequence(action, pin, sections)
        except ValueError as exc:
            return False, str(exc) or "invalid_pin_code"

        return await asyncio.to_thread(self._send_arm_packets, session, packets)

    def _send_arm_packets(self, session: _HidSession, packets: list[bytes]) -> tuple[bool, str]:
        try:
            for idx, pkt in enumerate(packets):
                self._hid_write(session, pkt, raise_on_error=True)
                # Auth ACK / login-error window after authorisation code packet.
                if idx == 1:
                    deadline = time.monotonic() + 1.2
                    while time.monotonic() < deadline:
                        raw = self._hid_read(session)
                        if not raw:
                            continue
                        for packet in split_packets(raw):
                            if is_login_error_packet(packet):
                                return False, "wrong_pin_code"
                else:
                    time.sleep(0.08)
            return True, "usb_action_ok"
        except Exception as exc:  # noqa: BLE001
            return False, f"usb_write_failed:{exc}"

    async def _run(self) -> None:
        if self.settings.usb_mock_mode:
            await self._run_mock()
        else:
            await self._run_hid_real()

    async def _run_mock(self) -> None:
        import random

        states = ["ok", "open", "alarm", "tamper"]
        while not self._stop.is_set():
            panels = list(self.panel_bus.panels.keys())
            if panels:
                panel_id = random.choice(panels)
                panel = self.panel_bus.panels[panel_id]
                panel.connection = "mock"
                panel.last_seen_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if panel.devices:
                    # Flip a few devices each tick so UI can verify realtime WS
                    sample = list(panel.devices.values())
                    random.shuffle(sample)
                    for device in sample[: min(3, len(sample))]:
                        await self.panel_bus.set_device_state(
                            panel_id,
                            device["device_num"],
                            random.choice(states),
                        )
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.settings.mock_event_interval_sec)
            except asyncio.TimeoutError:
                continue

    async def _run_hid_real(self) -> None:
        """Scan USB for hot-plug (slow) + poll HID states for realtime WS (fast)."""
        next_index = 1
        last_scan_at = 0.0
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

            now = time.monotonic()
            need_scan = (
                not self._sessions
                or (now - last_scan_at) >= self.settings.usb_scan_interval_sec
            )
            if need_scan:
                next_index = await self._scan_usb_sessions(next_index)
                last_scan_at = time.monotonic()

            if self._sessions:
                for panel_id in list(self._sessions.keys()):
                    try:
                        await self._poll_session(panel_id, intensive=False)
                    except Exception as exc:  # noqa: BLE001
                        msg = f"Lỗi poll HID {panel_id}: {exc}"
                        self._set_usb_error(msg)
                        await self.event_hub.publish({"type": "usb_error", "detail": msg})
                try:
                    await asyncio.wait_for(
                        self._stop.wait(),
                        timeout=max(0.15, float(self.settings.usb_poll_interval_sec)),
                    )
                except asyncio.TimeoutError:
                    continue
            else:
                try:
                    await asyncio.wait_for(
                        self._stop.wait(),
                        timeout=self.settings.usb_scan_interval_sec,
                    )
                except asyncio.TimeoutError:
                    continue

    async def _scan_usb_sessions(self, next_index: int) -> int:
        """Enumerate Link devices, open sessions, drop stale paths."""
        self._fix_hidraw_permissions()
        found_paths: set[str] = set()
        try:
            scanned = self._enumerate_hid_devices()
            self._scanned_devices = scanned
            for dev in scanned:
                path_str = dev["path"]
                found_paths.add(path_str)
                try:
                    panel_id = await self._ensure_panel_for_path(path_str, next_index)
                    if path_str not in self._path_to_panel.values() and panel_id.startswith("PANEL_"):
                        try:
                            next_index = max(next_index, int(panel_id.removeprefix("PANEL_")) + 1)
                        except ValueError:
                            next_index += 1
                    await self._ensure_session(panel_id, path_str)
                except Exception as exc:  # noqa: BLE001
                    msg = f"Không mở được USB {path_str}: {exc}"
                    self._set_usb_error(msg)
                    await self.event_hub.publish({"type": "usb_error", "detail": msg})
            # HID đang mở thì enumerate() thường trả rỗng — giữ session, không ngắt nhầm
            for session in self._sessions.values():
                found_paths.add(session.usb_path)
            self._devices_found = max(len(found_paths), len(self._sessions), len(scanned))
            if found_paths and not self._sessions:
                self._set_usb_error(
                    "Thấy thiết bị USB nhưng không mở được HID — kiểm tra quyền (plugdev/udev) "
                    "hoặc tắt phần mềm Jablotron khác đang chiếm cổng."
                )
            elif found_paths:
                self._last_error = None
            elif time.monotonic() - self._last_scan_log_at > 30:
                import logging

                logging.getLogger("uvicorn.error").warning(
                    "USB scan: 0 thiết bị Jablotron (VID=0x%04X PID=0x%04X). "
                    "Host: lsusb | grep -i 16d6 — nếu host thấy mà container không: "
                    "dùng ./scripts/start-backend-usb.sh + docker-compose.usb-host.yml",
                    self.settings.jablotron_vendor_id,
                    self.settings.jablotron_product_id,
                )
                self._last_scan_log_at = time.monotonic()
        except Exception as exc:  # noqa: BLE001
            self._devices_found = 0
            self._scanned_devices = []
            self._set_usb_error(str(exc))
            await self.event_hub.publish({"type": "usb_error", "detail": str(exc)})
            return next_index

        for panel_id, session in list(self._sessions.items()):
            if session.usb_path not in found_paths:
                self._close_session(session)
                self._sessions.pop(panel_id, None)
                stale_paths = [p for p, pid in self._path_to_panel.items() if pid == panel_id]
                for stale in stale_paths:
                    del self._path_to_panel[stale]
                panel = self.panel_bus.panels.get(panel_id)
                if panel:
                    panel.connection = "disconnected"
                    panel.usb_path = None
                    if self.panel_bus._persist:
                        await panel_store.save_panel(panel)
                    await self.event_hub.publish(
                        {"type": "panel_disconnected", "panel_id": panel_id}
                    )
        return next_index

    def _fix_hidraw_permissions(self) -> None:
        """Hot-plug hidraw nodes often get root-only perms; fix each scan."""
        import glob

        for path in glob.glob("/dev/hidraw*"):
            try:
                os.chmod(path, 0o666)
            except OSError:
                pass

    def _clear_path_mappings(self, panel_id: str) -> None:
        stale = [p for p, pid in self._path_to_panel.items() if pid == panel_id]
        for path in stale:
            del self._path_to_panel[path]

    async def _notify_panel_connected(self, panel_id: str, path_str: str) -> None:
        await self.event_hub.publish(
            {"type": "panel_connected", "panel_id": panel_id, "usb_path": path_str}
        )

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
            self._clear_path_mappings(panel_id)
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
        return panel_id

    async def _ensure_session(self, panel_id: str, path_str: str) -> None:
        existing = self._sessions.get(panel_id)
        if existing and existing.usb_path == path_str:
            return
        needs_connected_event = existing is None or existing.usb_path != path_str
        if existing:
            self._close_session(existing)
        device = hid.device()
        path_arg: bytes | str = path_str
        if isinstance(path_str, str):
            path_arg = path_str.encode("utf-8")
        try:
            device.open_path(path_arg)
        except Exception:
            device.open_path(path_str)
        session = _HidSession(panel_id=panel_id, usb_path=path_str, device=device)
        self._sessions[panel_id] = session
        for pkt in build_init_sequence():
            self._hid_write(session, pkt)
            await asyncio.sleep(0.08)
        session.last_enable_states_at = time.monotonic()
        await asyncio.sleep(0.2)
        await self._initial_sync(panel_id)
        if needs_connected_event:
            await self._notify_panel_connected(panel_id, path_str)

    async def sync_panel(self, panel_id: str) -> dict[str, Any]:
        """Đọc HID và đẩy trạng thái thiết bị đã khai báo lên UI."""
        if self.settings.usb_mock_mode:
            return {"ok": True, "mode": "mock"}
        if panel_id not in self._sessions:
            return {"ok": False, "error": "panel_not_connected_usb"}

        session = self._sessions[panel_id]
        # Force re-enable device-state packets (0x55 / 0xd8) before snapshot poll.
        for pkt in build_init_sequence():
            self._hid_write(session, pkt)
            await asyncio.sleep(0.05)
        session.last_enable_states_at = time.monotonic()
        await asyncio.sleep(0.15)

        applied_total = 0
        seen_nums: set[int] = set()
        for _ in range(14):
            part = await self._poll_session(panel_id, intensive=True)
            applied_total += len(part.device_states)
            seen_nums.update(part.device_states.keys())
            await asyncio.sleep(0.12)
        count = await self._publish_declared_states_snapshot(panel_id)
        panel = self.panel_bus.panels.get(panel_id)
        states = {
            d["global_id"]: d.get("state", "ok")
            for d in (panel.devices.values() if panel else [])
        }
        declared = set(panel.devices.keys()) if panel else set()
        matched = {
            make_device_global_id(panel_id, n)
            for n in seen_nums
            if make_device_global_id(panel_id, n) in declared
        }
        return {
            "ok": True,
            "synced": count,
            "hid_device_updates": applied_total,
            "hid_device_nums": sorted(seen_nums),
            "matched_declared": len(matched),
            "states": states,
        }

    async def probe_config(self, panel_id: str) -> dict[str, Any]:
        """Đọc packet trạng thái HID để suy ra số section / device / PG (gợi ý)."""
        if self.settings.usb_mock_mode:
            return {
                "ok": True,
                "mode": "mock",
                "section_nums": [1],
                "section_count_hint": 1,
                "device_count_hint": 12,
                "pg_count_hint": 8,
                "user_count_hint": None,
                "note": "mock_defaults",
            }
        if panel_id not in self._sessions:
            return {"ok": False, "error": "panel_not_connected_usb"}

        merged = empty_updates()
        for _ in range(12):
            part = await self._poll_session(panel_id, intensive=True)
            merge_updates(merged, part)
            await asyncio.sleep(0.12)

        hints = inventory_hints_from_updates(merged)
        return {
            "ok": True,
            "mode": "usb",
            "section_nums": hints.section_nums,
            "section_count_hint": len(hints.section_nums) if hints.section_nums else None,
            "device_count_hint": hints.device_count_hint,
            "pg_count_hint": hints.pg_count_hint,
            "user_count_hint": None,
            "note": "hid_state_hints",
        }

    async def import_config(
        self,
        panel_id: str,
        *,
        section_count: int | None = None,
        device_count: int | None = None,
        user_count: int | None = None,
        pg_count: int | None = None,
        device_type: str = "sensor",
        create_sections: bool = True,
        create_devices: bool = True,
        create_users: bool = True,
        create_pgs: bool = True,
        assign_devices_to_first_zone: bool = True,
    ) -> dict[str, Any]:
        """Tạo zone/device/user/PG placeholder từ số lượng (probe HID khi thiếu)."""
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return {"ok": False, "error": "panel_not_found"}

        probed: dict[str, Any] | None = None
        need_probe = (
            section_count is None
            or device_count is None
            or pg_count is None
        )
        can_probe = self.settings.usb_mock_mode or panel_id in self._sessions
        if need_probe and can_probe:
            probed = await self.probe_config(panel_id)
            if not probed.get("ok"):
                return probed

        def _resolve(explicit: int | None, hint_key: str, default: int) -> int:
            if explicit is not None:
                return explicit
            if probed and probed.get(hint_key) is not None:
                return int(probed[hint_key])
            return default

        resolved_sections = _resolve(section_count, "section_count_hint", 1 if can_probe else 0)
        resolved_devices = _resolve(device_count, "device_count_hint", 0)
        resolved_pgs = _resolve(pg_count, "pg_count_hint", 0)
        resolved_users = user_count if user_count is not None else 0

        if need_probe and not can_probe and (
            section_count is None or device_count is None or pg_count is None
        ):
            return {"ok": False, "error": "import_counts_required"}

        if resolved_sections < 1 and create_sections:
            resolved_sections = 1

        sections_created = 0
        sections_skipped = 0
        devices_created = 0
        devices_skipped = 0
        users_created = 0
        users_skipped = 0
        pgs_created = 0
        pgs_skipped = 0

        existing_section_nums = {
            int(z.get("section_num"))
            for z in panel.zones.values()
            if z.get("section_num") is not None
        }

        if create_sections and resolved_sections >= 1:
            for num in range(1, resolved_sections + 1):
                if num in existing_section_nums:
                    sections_skipped += 1
                    continue
                await self.panel_bus.create_zone(
                    panel_id,
                    name=f"Section {num}",
                    section_num=num,
                )
                sections_created += 1
                existing_section_nums.add(num)

        first_zone_id: str | None = None
        if assign_devices_to_first_zone:
            for z in sorted(panel.zones.values(), key=lambda x: int(x.get("section_num") or 999)):
                if int(z.get("section_num") or 0) == 1:
                    first_zone_id = z["zone_id"]
                    break
            if first_zone_id is None and panel.zones:
                first_zone_id = sorted(
                    panel.zones.values(), key=lambda x: int(x.get("section_num") or 999)
                )[0]["zone_id"]

        if create_devices and resolved_devices >= 1:
            for num in range(1, min(resolved_devices, 99) + 1):
                global_id = make_device_global_id(panel_id, num)
                if global_id in panel.devices:
                    devices_skipped += 1
                    continue
                await self.panel_bus.upsert_device(
                    panel_id,
                    num,
                    device_type=device_type or "sensor",
                    label=f"Địa chỉ {num}",
                    zone_id=first_zone_id,
                    update_zone=first_zone_id is not None,
                )
                devices_created += 1

        if create_pgs and resolved_pgs >= 1:
            existing_pg_nums = {int(p.get("pg_num")) for p in panel.pgs.values()}
            for num in range(1, min(resolved_pgs, 128) + 1):
                if num in existing_pg_nums:
                    pgs_skipped += 1
                    continue
                await self.panel_bus.create_pg(
                    panel_id,
                    pg_num=num,
                    label=f"PG {num}",
                    zone_id=first_zone_id,
                    mode="pulse",
                )
                pgs_created += 1

        if create_users and resolved_users >= 1:
            existing_user_count = len(panel.users)
            to_create = max(0, resolved_users - existing_user_count)
            users_skipped = min(existing_user_count, resolved_users)
            for i in range(existing_user_count + 1, existing_user_count + to_create + 1):
                await self.panel_bus.create_user(
                    panel_id,
                    name=f"User {i}",
                    code_label="",
                    permissions=["arm", "disarm"],
                )
                users_created += 1

        sync_result: dict[str, Any] | None = None
        if panel_id in self._sessions or self.settings.usb_mock_mode:
            sync_result = await self.sync_panel(panel_id)

        await self.event_hub.publish(
            {
                "type": "panel_config_imported",
                "panel_id": panel_id,
                "detail": (
                    f"Import: +{sections_created} vùng, +{devices_created} thiết bị, "
                    f"+{users_created} user, +{pgs_created} PG"
                ),
            }
        )

        return {
            "ok": True,
            "sections_created": sections_created,
            "devices_created": devices_created,
            "users_created": users_created,
            "pgs_created": pgs_created,
            "sections_skipped": sections_skipped,
            "devices_skipped": devices_skipped,
            "users_skipped": users_skipped,
            "pgs_skipped": pgs_skipped,
            "used": {
                "section_count": resolved_sections if create_sections else 0,
                "device_count": resolved_devices if create_devices else 0,
                "user_count": resolved_users if create_users else 0,
                "pg_count": resolved_pgs if create_pgs else 0,
            },
            "probed": probed,
            "synced": (sync_result or {}).get("synced"),
            "note": (
                "Tạo placeholder theo số lượng. Nhãn/loại thiết bị/PIN user cần chỉnh tay "
                "(HID không đọc được cấu hình chi tiết như F-Link)."
            ),
        }

    async def _initial_sync(self, panel_id: str) -> None:
        for _ in range(8):
            await self._poll_session(panel_id, intensive=True)
            await asyncio.sleep(0.1)
        await self._publish_declared_states_snapshot(panel_id)

    async def _publish_declared_states_snapshot(
        self,
        panel_id: str,
        *,
        event_type: str = "devices_state_batch",
    ) -> int:
        panel = self.panel_bus.panels.get(panel_id)
        if not panel or not panel.devices:
            return 0
        updates = {
            gid: str(dev.get("state") or "ok")
            for gid, dev in panel.devices.items()
        }
        await self.event_hub.publish(
            {
                "type": event_type,
                "panel_id": panel_id,
                "updates": updates,
            }
        )
        return len(updates)

    async def _poll_session(self, panel_id: str, *, intensive: bool = False) -> ParsedUpdates:
        collected = empty_updates()
        session = self._sessions.get(panel_id)
        if not session:
            return collected

        # 1) Drain anything already queued (async 0x55/0xd8 between polls).
        batch: list[bytes] = []
        batch.extend(await self._drain_hid(session, rounds=8 if intensive else 6, timeout_ms=20))

        now = time.monotonic()
        # Re-enable device-state stream often enough for JA-100 push packets.
        if now - session.last_enable_states_at > 60:
            for pkt in build_init_sequence():
                self._hid_write(session, pkt)
                await asyncio.sleep(0.02)
            session.last_enable_states_at = now
        else:
            for pkt in build_poll_sequence():
                self._hid_write(session, pkt)
                await asyncio.sleep(0.015 if not intensive else 0.03)

        await asyncio.sleep(0.03 if not intensive else 0.05)
        # 2) Read responses (sections/PG + any device-state packets).
        batch.extend(
            await self._drain_hid(
                session,
                rounds=36 if intensive else 18,
                timeout_ms=40 if intensive else 25,
            )
        )

        # Activity bitmap first, then 0x55 events (TMP/alarm override ACT/OK).
        # Apply once from merged view so one WS batch is emitted per poll.
        for packet in sorted(batch, key=packet_sort_key):
            merge_updates(collected, parse_packet(packet))
        if (
            collected.device_states
            or collected.section_states
            or collected.pg_states
            or collected.panel_armed
        ):
            await self._apply_updates(panel_id, collected)

        panel = self.panel_bus.panels.get(panel_id)
        if batch:
            session.last_packet_at = time.monotonic()
            if panel:
                panel.last_seen_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if panel.connection != "usb":
                    panel.connection = "usb"

        await self._publish_live_signals(panel_id, session, collected, packet_count=len(batch))
        return collected

    async def _drain_hid(
        self,
        session: _HidSession,
        *,
        rounds: int,
        timeout_ms: int,
    ) -> list[bytes]:
        out: list[bytes] = []
        empty_streak = 0
        for _ in range(rounds):
            raw = self._hid_read(session, timeout_ms=timeout_ms)
            if not raw:
                empty_streak += 1
                if empty_streak >= 2:
                    break
                await asyncio.sleep(0.005)
                continue
            empty_streak = 0
            out.extend(split_packets(raw))
        return out

    async def _publish_live_signals(
        self,
        panel_id: str,
        session: _HidSession,
        collected: ParsedUpdates,
        *,
        packet_count: int,
    ) -> None:
        """Heartbeat + periodic snapshot so UI stays realtime even when states are stable."""
        now = time.monotonic()
        heartbeat_sec = max(0.5, float(self.settings.usb_live_heartbeat_sec))
        snapshot_sec = max(1.0, float(self.settings.usb_snapshot_interval_sec))

        if (now - session.last_live_publish_at) >= heartbeat_sec:
            session.last_live_publish_at = now
            receiving = packet_count > 0 or (
                session.last_packet_at > 0 and (now - session.last_packet_at) < 5.0
            )
            await self.event_hub.publish(
                {
                    "type": "panel_live",
                    "panel_id": panel_id,
                    "receiving": receiving,
                    "packet_count": packet_count,
                    "device_updates": len(collected.device_states),
                    "section_updates": len(collected.section_states),
                    "pg_updates": len(collected.pg_states),
                    "last_seen_at": (
                        self.panel_bus.panels[panel_id].last_seen_at
                        if panel_id in self.panel_bus.panels
                        else None
                    ),
                }
            )

        if (now - session.last_snapshot_publish_at) >= snapshot_sec:
            session.last_snapshot_publish_at = now
            # Quiet reconcile — UI applies states without row-flash spam.
            await self._publish_declared_states_snapshot(
                panel_id,
                event_type="devices_state_snapshot",
            )

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
            await self._apply_device_states(
                panel_id,
                updates.device_states,
                force_nums=updates.device_state_force,
            )

        for pg_num, pg_state in updates.pg_states.items():
            for pg in panel.pgs.values():
                if pg.get("pg_num") == pg_num and pg.get("state") != pg_state:
                    await self.panel_bus.update_pg(panel_id, pg["pg_id"], state=pg_state)

    async def _apply_device_states(
        self,
        panel_id: str,
        device_states: dict[int, str],
        *,
        force_nums: set[int] | None = None,
    ) -> None:
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return

        force_nums = force_nums or set()
        updates: dict[str, str] = {}
        for device_num, state in device_states.items():
            global_id = make_device_global_id(panel_id, device_num)
            if global_id not in panel.devices:
                continue
            device = panel.devices[global_id]
            current = str(device.get("state") or "ok")
            if current == state:
                continue
            # Activity bitmap (0xd8) must not wipe TMP/fault/alarm from 0x55.
            if (
                device_num not in force_nums
                and current in PROBLEM_DEVICE_STATES
                and state in ("ok", "open")
            ):
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

    def _hid_write(self, session: _HidSession, packet: bytes, *, raise_on_error: bool = False) -> None:
        padded = pad_hid_packet(packet)
        try:
            session.device.write(b"\x00" + padded)
            return
        except Exception as first:  # noqa: BLE001
            try:
                session.device.write(padded)
                return
            except Exception as second:  # noqa: BLE001
                if raise_on_error:
                    raise second from first

    def _hid_read(self, session: _HidSession, timeout_ms: int = 150) -> bytes:
        try:
            data = session.device.read(64, timeout_ms=max(1, int(timeout_ms)))
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
