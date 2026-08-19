from __future__ import annotations

import asyncio
import json
import os
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import partial
from typing import Any

# Pulse ACT (DEV_09 / JA-110P Instant): keep ACT long enough for Map/Devices UI.
# EventFeed already logs Instant ON; without this hold the UI often jumps straight to OK.
# Applied to all declared devices except level contacts (door magnets).
PULSE_ACT_SECONDS = 2.0
PIR_PULSE_ACT_SECONDS = PULSE_ACT_SECONDS  # backward-compatible alias

# Bus type/conn bytes that hold continuous ACT while the contact is open.
_LEVEL_CONTACT_BUS_TYPES = frozenset({0x0C, 0x0E})
_LEVEL_CONTACT_DEVICE_TYPES = frozenset({"door", "magnet"})

from app.core.config import BACKEND_ROOT, Settings, get_settings
from app.iot_core.device_catalog import is_generic_model_hint, is_unrefined_device_type
from app.iot_core.device_id import make_device_global_id, make_panel_id
from app.iot_core.device_reaction import (
    hid_reaction_overrides,
    normalize_reaction,
    reaction_alarms_when_disarmed,
)
from app.iot_core.event_hub import EventHub, get_event_hub
from app.iot_core.jablotron_protocol import (
    PROBLEM_DEVICE_STATES,
    ParsedUpdates,
    build_arm_sequence,
    build_device_stream_keepalive,
    build_get_device_status_packet,
    build_get_devices_sections_packet,
    build_init_sequence,
    build_poll_sequence,
    build_sections_poll_sequence,
    empty_updates,
    inventory_hints_from_updates,
    is_device_state_heartbeat,
    is_login_error_packet,
    SYSTEM_DEVICE_MOBILE,
    SYSTEM_DEVICE_RESERVED_MIN,
    SYSTEM_DEVICE_USB,
    merge_updates,
    pad_hid_packet,
    parse_packet,
    packet_sort_key,
    should_replace_device_state,
    flink_status_from_state_disable,
    split_packets,
    strip_hid_report_id,
    _parse_device_number,
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
    last_sections_poll_at: float = 0.0
    last_live_publish_at: float = 0.0
    last_snapshot_publish_at: float = 0.0
    last_packet_at: float = 0.0
    last_device_state_at: float = 0.0
    force_stream_refresh: bool = True
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    packet_type_counts: Counter = field(default_factory=Counter)
    recent_device_packets: list[str] = field(default_factory=list)
    # Last raw 0x55 hex per device_num (for Disable decode refinement)
    last_55_by_device: dict[int, str] = field(default_factory=dict)
    last_status_probe_at: float = 0.0
    status_probe_cursor: int = 0
    # JA-110P TMP from GET_DEVICE_STATUS type 0x14. Instant 0x55/0xd8
    # keep reporting ACT while the cover is open — sticky until 0x8a clears TMP.
    sticky_tmp_nums: set[int] = field(default_factory=set)
    # Cover open while Disable=Tamper (0x8a flag 0x11) → F-Link Status OK.
    physical_tmp_nums: set[int] = field(default_factory=set)
    # Latest 0xd8 activity bit per device (F-Link Status source of truth for ACT/OK).
    last_d8_states: dict[int, str] = field(default_factory=dict)
    # 0x8a type/conn byte per address (used to classify pulse vs level ACT).
    bus_type_by_device: dict[int, int] = field(default_factory=dict)
    # Monotonic deadline: keep pulse ACT until this time (refreshed on Instant ON).
    pulse_act_until: dict[int, float] = field(default_factory=dict)
    last_tmp_probe: dict[str, str] = field(default_factory=dict)


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
        self._poll_pause_depth: int = 0
        self._auto_stream_tasks: dict[str, asyncio.Task[None]] = {}
        # hidapi read() can block the asyncio loop (Windows often ignores timeout) → nginx 502.
        self._hid_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="jablotron-hid")
        self.panel_bus.set_command_sender(self)
        # 24h/Fire đã «Tắt báo động» — không promote lại cho đến Instant OFF.
        self._acked_always_nums: dict[str, set[int]] = {}

    async def _hid_call(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        """Run HID I/O on one worker thread so HTTP/WS stay responsive."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._hid_pool, partial(fn, *args, **kwargs))

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
            "device_stream": {
                pid: {
                    "ok": self.is_device_stream_ok(pid),
                    "has_stream_code": bool(
                        getattr(self.panel_bus.panels.get(pid), "stream_code", "")
                    ),
                    "last_device_state_age_sec": (
                        round(time.monotonic() - sess.last_device_state_at, 2)
                        if sess.last_device_state_at
                        else None
                    ),
                }
                for pid, sess in self._sessions.items()
            },
        }

    def is_device_stream_ok(self, panel_id: str) -> bool:
        """Healthy only after Admin/Service PIN is known and 0x55/0xd8 arrived recently."""
        session = self._sessions.get(panel_id)
        panel = self.panel_bus.panels.get(panel_id)
        if not session or not session.last_device_state_at:
            return False
        if not (getattr(panel, "stream_code", "") or "").strip():
            return False
        return (time.monotonic() - session.last_device_state_at) < 15.0

    async def request_device_stream_refresh(self, panel_id: str) -> None:
        session = self._sessions.get(panel_id)
        if session:
            session.force_stream_refresh = True
            session.last_enable_states_at = 0.0

    def _next_panel_index(self) -> int:
        n = 1
        for pid in self.panel_bus.panels:
            if pid.startswith("PANEL_"):
                try:
                    n = max(n, int(pid.removeprefix("PANEL_")) + 1)
                except ValueError:
                    pass
        return n

    def _schedule_auto_stream(self, panel_id: str) -> None:
        """Re-auth stored Admin/Service PIN after USB connect — no UI click."""
        panel = self.panel_bus.panels.get(panel_id)
        if not (getattr(panel, "stream_code", "") or "").strip():
            return
        old = self._auto_stream_tasks.get(panel_id)
        if old and not old.done():
            old.cancel()
        self._auto_stream_tasks[panel_id] = asyncio.create_task(
            self._auto_activate_stream(panel_id),
            name=f"auto-stream:{panel_id}",
        )

    async def _auto_activate_stream(self, panel_id: str) -> None:
        try:
            for delay in (0.4, 2.0, 6.0):
                if self._stop.is_set() or panel_id not in self._sessions:
                    return
                panel = self.panel_bus.panels.get(panel_id)
                code = (getattr(panel, "stream_code", "") or "").strip() if panel else ""
                if not code:
                    return
                if self.is_device_stream_ok(panel_id):
                    return
                await self.activate_device_stream(panel_id, code, persist=False)
                await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        except Exception:
            return

    async def reconnect_hid(self) -> dict[str, Any]:
        """Close HID sessions and rescan — used from the System page."""
        if self.settings.usb_mock_mode:
            return {"ok": True, "mode": "mock", **self.get_status()}
        for panel_id, session in list(self._sessions.items()):
            try:
                await self._hid_call(self._close_session, session)
            except Exception:
                pass
            self._sessions.pop(panel_id, None)
        await self._scan_usb_sessions(self._next_panel_index())
        for panel_id in list(self._sessions.keys()):
            self._schedule_auto_stream(panel_id)
        return {"ok": True, **self.get_status()}

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
                "Windows: .\\scripts\\stop-cms.ps1 && .\\scripts\\deploy-usb-windows.ps1"
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
        self._load_acked_always()
        if self.settings.usb_mock_mode:
            if not self.panel_bus.panels:
                await self.panel_bus.seed_mock_panels()
        self._task = asyncio.create_task(self._run(), name="usb-device-manager")

    async def stop(self) -> None:
        self._stop.set()
        for task in list(self._auto_stream_tasks.values()):
            task.cancel()
        self._auto_stream_tasks.clear()
        if self._task:
            await asyncio.wait([self._task], timeout=3)
        for session in list(self._sessions.values()):
            try:
                await asyncio.wait_for(self._hid_call(self._close_session, session), timeout=1)
            except Exception:
                try:
                    self._close_session(session)
                except Exception:
                    pass
        self._sessions.clear()
        self._hid_pool.shutdown(wait=False, cancel_futures=True)

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

        async with session.lock:
            ok, detail = await self._hid_call(self._send_arm_packets, session, packets)
        if ok:
            # Stream activation is slow (HID + poll). Do not block arm/disarm ACK —
            # UI and zone_armed events should return as soon as packets are accepted.
            pin_for_stream = pin
            asyncio.create_task(
                self.activate_device_stream(panel_id, pin_for_stream, persist=True),
                name=f"device-stream:{panel_id}",
            )
            # Optimistic zone/panel disarm in PanelBus races ahead of HID section
            # packets — just_disarmed in _apply_updates is then skipped. Clear sticky
            # Báo động here so Map/UI match F-Link after Tắt bảo vệ.
            if action == "disarm":
                asyncio.create_task(
                    self.clear_alarms_after_disarm(
                        panel_id,
                        section_num=int(section_num) if section_num is not None else None,
                    ),
                    name=f"clear-alarms:{panel_id}",
                )
        return ok, detail

    async def clear_alarms_after_disarm(
        self,
        panel_id: str,
        *,
        section_num: int | None = None,
    ) -> None:
        """Wipe sticky alarm/ACT after a successful disarm command (CMS or HID)."""
        if section_num is not None:
            await self._clear_alarms_on_disarm(panel_id, section_nums={int(section_num)})
        else:
            await self._clear_alarms_on_disarm(panel_id, whole_panel=True)
        sess = self._sessions.get(panel_id)
        if sess is not None:
            sess.force_stream_refresh = True

    async def ack_always_alarms(
        self,
        panel_id: str,
        *,
        device_nums: list[int] | None = None,
        code: str | None = None,
    ) -> dict[str, Any]:
        """Tắt Báo động 24h/Fire: CMS + gửi PIN xuống tủ (cùng thao tác bàn phím).

        Cửa còn mở → ACT. Cửa đóng → OK. Instant OFF (sau ack) xóa ack; lần mở sau báo lại.
        """
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return {"ok": False, "silenced": [], "error": "panel_not_found"}
        wanted = set(device_nums) if device_nums is not None else None
        to_apply: dict[int, str] = {}
        section_nums: set[int] = set()
        session = self._sessions.get(panel_id)
        for device in panel.devices.values():
            try:
                n = int(device.get("device_num"))
            except (TypeError, ValueError):
                continue
            if wanted is not None and n not in wanted:
                continue
            if not reaction_alarms_when_disarmed(device.get("reaction")):
                continue
            if str(device.get("state") or "ok") != "alarm":
                continue
            real = self._bitmap_act_or_ok(session, n)
            # Ack chỉ chặn ĐÚNG lần kích đang diễn ra: cảm biến còn ACT thì ghi ack,
            # đã về OK (cửa đóng) thì bỏ ack để lần kích sau báo động lại ngay.
            if real == "open":
                self._ack_always_add(panel_id, n)
            else:
                self._ack_always_discard(panel_id, n)
            to_apply[n] = real
            try:
                zid = device.get("zone_id")
                zone = panel.zones.get(zid) if zid else None
                if zone and zone.get("section_num") is not None:
                    section_nums.add(int(zone["section_num"]))
            except (TypeError, ValueError):
                pass
        pin = (code or "").strip()
        if pin and to_apply and not self.settings.usb_mock_mode:
            await self._send_physical_alarm_ack(panel_id, pin, section_nums)
        if to_apply:
            self._save_acked_always()
            await self._apply_device_states(
                panel_id,
                to_apply,
                force_nums=set(to_apply),
                clear_alarm=True,
            )
            await self._clear_zone_keypad_alarm_leds(panel_id, section_nums or None)
        return {
            "ok": True,
            "silenced": sorted(to_apply),
            "states": {str(n): st for n, st in to_apply.items()},
        }

    async def _send_physical_alarm_ack(
        self,
        panel_id: str,
        code: str,
        section_nums: set[int],
    ) -> None:
        """PIN UI → tủ: authorize + unset lại phân khu (xóa còi / alarm memory)."""
        session = self._sessions.get(panel_id)
        if session is None or hid is None:
            return
        sections = sorted(section_nums) or [1]
        try:
            packets = build_arm_sequence("disarm", code, sections)
        except ValueError:
            return
        async with session.lock:
            await self._hid_call(self._send_arm_packets, session, packets)

    async def activate_device_stream(
        self,
        panel_id: str,
        pin: str,
        *,
        persist: bool = False,
    ) -> dict[str, Any]:
        """Authorize + enable 0x55/0xd8, then poll states into CMS."""
        panel = self.panel_bus.panels.get(panel_id)
        session = self._sessions.get(panel_id)
        if panel is None or session is None:
            return {"ok": False, "error": "panel_not_connected_usb"}

        code = (pin or "").strip()
        if not code:
            return {"ok": False, "error": "pin_required"}

        if persist and panel.stream_code != code:
            panel.stream_code = code
            if self.panel_bus._persist:
                await panel_store.save_panel(panel)

        try:
            async with session.lock:
                for pkt in build_device_stream_keepalive(code):
                    await self._hid_call(self._hid_write, session, pkt, raise_on_error=True)
                    await asyncio.sleep(0.06)
                session.last_enable_states_at = time.monotonic()
                session.force_stream_refresh = False
        except ValueError as exc:
            return {"ok": False, "error": str(exc) or "invalid_pin_code"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"usb_write_failed:{exc}"}

        # Do not invent/clear device Status here (ACT must stay ACT after arm).
        # Live 0x55/0xd8 from the following poll is the source of truth.

        self._poll_pause_depth += 1
        try:
            seen: set[int] = set()
            for _ in range(10):
                part = await self._poll_session(panel_id, intensive=True)
                seen.update(part.device_states.keys())
                await asyncio.sleep(0.08)
            await self._publish_declared_states_snapshot(panel_id)
        finally:
            self._poll_pause_depth = max(0, self._poll_pause_depth - 1)

        await self.event_hub.publish(
            {
                "type": "panel_updated",
                "panel_id": panel_id,
                "detail": "device_stream_activated",
            }
        )
        return {
            "ok": True,
            "device_nums": sorted(seen),
            "device_stream_ok": self.is_device_stream_ok(panel_id),
            "has_stream_code": bool(panel.stream_code),
        }

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
                if self._poll_pause_depth > 0:
                    try:
                        await asyncio.wait_for(self._stop.wait(), timeout=0.2)
                    except asyncio.TimeoutError:
                        continue
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
            scanned = await self._hid_call(self._enumerate_hid_devices)
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
                    "Linux: deploy-usb-linux.sh | Windows: deploy-usb-windows.ps1 "
                    "(backend native :8010 + Docker UI, không đặt backend trong container).",
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
                await self._hid_call(self._close_session, session)
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
            await self._hid_call(self._close_session, existing)
        device = await self._hid_call(self._open_hid_path, path_str)
        session = _HidSession(panel_id=panel_id, usb_path=path_str, device=device)
        self._sessions[panel_id] = session
        panel = self.panel_bus.panels.get(panel_id)
        stream_code = (getattr(panel, "stream_code", "") or "").strip() if panel else ""
        # Prefer Admin/Service auth so 0x55/0xd8 starts without arm/disarm.
        if stream_code:
            try:
                for pkt in build_device_stream_keepalive(stream_code):
                    await self._hid_call(self._hid_write, session, pkt)
                    await asyncio.sleep(0.06)
            except ValueError:
                for pkt in build_init_sequence():
                    await self._hid_call(self._hid_write, session, pkt)
                    await asyncio.sleep(0.08)
        else:
            for pkt in build_init_sequence():
                await self._hid_call(self._hid_write, session, pkt)
                await asyncio.sleep(0.08)
        # Force first poll(s) to re-auth+enable — do not skip after init write.
        session.last_enable_states_at = 0.0
        session.force_stream_refresh = True
        await asyncio.sleep(0.25)
        await self._initial_sync(panel_id)
        if needs_connected_event:
            await self._notify_panel_connected(panel_id, path_str)
        if stream_code:
            self._schedule_auto_stream(panel_id)

    async def sync_panel(self, panel_id: str) -> dict[str, Any]:
        """Đọc HID và đẩy trạng thái thiết bị đã khai báo lên UI."""
        if self.settings.usb_mock_mode:
            return {"ok": True, "mode": "mock"}
        if panel_id not in self._sessions:
            return {"ok": False, "error": "panel_not_connected_usb"}

        session = self._sessions[panel_id]
        # Force auth+enable (if PIN set) before intensive snapshot poll.
        session.force_stream_refresh = True
        session.last_enable_states_at = 0.0

        self._poll_pause_depth += 1
        probe_disables: dict[str, str] = {}
        inventory_acc = empty_updates()
        try:
            applied_total = 0
            seen_nums: set[int] = set()
            session.packet_type_counts.clear()
            session.recent_device_packets.clear()
            # Keep last_55_by_device across sync (helps Disable decode) — do not clear.
            # One auth+enable, then drain-only reads (HA receives 0x55/0xd8 asynchronously).
            part = await self._poll_session(panel_id, intensive=True)
            applied_total += len(part.device_states)
            seen_nums.update(part.device_states.keys())
            # Probe devices-sections + per-device status (may carry Disable config).
            confirmed_problem_nums: set[int] = set()
            saw_activity_bitmap = False
            seen_status: set[int] = set()
            async with session.lock:
                await self._hid_call(self._hid_write, session, build_get_devices_sections_packet())
                await asyncio.sleep(0.08)
                panel_probe = self.panel_bus.panels.get(panel_id)
                probe_nums = sorted(
                    {
                        int(d.get("device_num"))
                        for d in (panel_probe.devices.values() if panel_probe else [])
                        if d.get("device_num") is not None
                    }
                )[:20]
                # Reset Disable from 0x8a only this sync (drop sticky false positives).
                for n in probe_nums:
                    part.device_disable[n] = "none"
                tmp_from_probe: dict[int, str] = {}
                for _pass in range(2):
                    for n in probe_nums:
                        if n in seen_status and _pass > 0:
                            continue
                        await self._hid_call(self._hid_write, session, build_get_device_status_packet(n))
                        await asyncio.sleep(0.025)
                    probe_batch = await self._drain_hid(session, rounds=40, timeout_ms=40)
                    for packet in sorted(probe_batch, key=packet_sort_key):
                        if not packet:
                            continue
                        session.packet_type_counts[f"0x{packet[0]:02x}"] += 1
                        parsed = parse_packet(packet)
                        self._annotate_keypad_auth(session, panel_probe, packet, parsed)
                        self._note_status_bus_type(session, packet)
                        if packet[:1] == b"\xd8":
                            saw_activity_bitmap = True
                            self._remember_activity_bitmap(session, parsed)
                        if packet[:1] == b"\x52" and len(packet) >= 4 and packet[2:3] == b"\x8a":
                            seen_status.add(int(packet[3]))
                            session.recent_device_packets.append(f"{packet.hex()}#probe")
                        elif packet[:1] in (b"\x3b", b"\x90", b"\x55", b"\x5f", b"\x94"):
                            session.recent_device_packets.append(f"{packet.hex()}#probe")
                            if packet[:1] == b"\x55" and len(packet) >= 6:
                                dnum = _parse_device_number(packet)
                                if 1 <= dnum <= 99:
                                    session.last_55_by_device[dnum] = packet.hex()
                        self._track_tmp_sticky(session, parsed)
                        for dnum, st in parsed.device_states.items():
                            if dnum in parsed.device_state_force and st in PROBLEM_DEVICE_STATES:
                                confirmed_problem_nums.add(dnum)
                            if st == "tamper" and dnum in parsed.device_state_force:
                                tmp_from_probe[dnum] = st
                        merge_updates(part, parsed)
                        merge_updates(inventory_acc, parsed)
                self._reconcile_instant_with_bitmap(session, panel_id, part)
                # Prefer sticky TMP from 0x8a over Instant ACT — unless Disable Tamper.
                for n in list(session.sticky_tmp_nums):
                    if part.device_disable.get(n) == "tamper":
                        session.sticky_tmp_nums.discard(n)
                        part.device_tmp_clear.add(n)
                        continue
                    part.device_states[n] = "tamper"
                    part.device_state_force.add(n)
                    part.device_tmp_clear.discard(n)
                    tmp_from_probe[n] = "tamper"
                # F-Link Status: flag 0x11 cover-open + Tamper bypass → OK (mask Instant),
                # but NOT while section armed — keep Instant/ACTIVITY for promote (Dev_09).
                panel_for_mask = self.panel_bus.panels.get(panel_id)
                for n, st in list(part.device_states.items()):
                    if (
                        st == "open"
                        and panel_for_mask is not None
                        and self._device_section_armed(panel_for_mask, n)
                        and (
                            n in part.device_alarm_events
                            or n in part.device_state_force
                        )
                    ):
                        continue
                    bypass = part.device_disable.get(n, "none")
                    cover_open = n in session.physical_tmp_nums
                    if (
                        bypass == "tamper"
                        and st == "ok"
                        and n in part.device_state_force
                        and n not in part.device_tmp_clear
                    ):
                        cover_open = True
                        session.physical_tmp_nums.add(n)
                    shown = flink_status_from_state_disable(
                        st, bypass, cover_open_tmp=cover_open
                    )
                    if shown != st:
                        part.device_states[n] = shown
                        if shown != "tamper":
                            session.sticky_tmp_nums.discard(n)
                            tmp_from_probe.pop(n, None)
                if part.device_states or part.device_disable:
                    await self._apply_updates(panel_id, part)
                    applied_total += len(part.device_states)
                    seen_nums.update(part.device_states.keys())
                # Keep Disable from probe (Tamper bypass required for Status OK).
                if part.device_disable:
                    await self._apply_device_disable(panel_id, part.device_disable)
                probe_disables = {str(n): part.device_disable.get(n, "none") for n in probe_nums}
                session.last_tmp_probe = {str(k): v for k, v in tmp_from_probe.items()}
            await asyncio.sleep(0.35)
            for _ in range(24):
                part = await self._drain_session_only(panel_id)
                applied_total += len(part.device_states)
                seen_nums.update(part.device_states.keys())
                for dnum, st in part.device_states.items():
                    if dnum in part.device_state_force and st in PROBLEM_DEVICE_STATES:
                        confirmed_problem_nums.add(dnum)
                if _ % 6 == 5:
                    # Occasional heartbeat so the panel keeps the session alive.
                    await self._poll_session(panel_id, intensive=False)
                await asyncio.sleep(0.08)
            # Re-assert sticky TMP after Instant/0xd8 — skip addresses with Disable Tamper.
            panel_sticky = self.panel_bus.panels.get(panel_id)
            sticky_apply: dict[int, str] = {}
            for n in session.sticky_tmp_nums:
                gid = make_device_global_id(panel_id, n)
                dev = (panel_sticky.devices.get(gid) if panel_sticky else None) or {}
                if (dev.get("disable") or "none") == "tamper":
                    session.sticky_tmp_nums.discard(n)
                    continue
                sticky_apply[n] = "tamper"
            if sticky_apply:
                await self._apply_device_states(
                    panel_id,
                    sticky_apply,
                    force_nums=set(sticky_apply),
                )
            # Auto-clear mis-mapped alarm / ACT lỗi thời while disarmed.
            # When armed, alarm sticks until Tắt bảo vệ.
            panel_for_clear = self.panel_bus.panels.get(panel_id)
            if (
                panel_for_clear
                and str(panel_for_clear.armed_state or "disarmed") == "disarmed"
                and self.is_device_stream_ok(panel_id)
                and (saw_activity_bitmap or confirmed_problem_nums or seen_status)
            ):
                await self._clear_stale_problem_states(
                    panel_id,
                    confirmed_problem_nums=confirmed_problem_nums,
                    only_states=frozenset({"alarm", "fault"}),
                )
                if saw_activity_bitmap and session is not None:
                    stale_open: dict[int, str] = {}
                    for device in panel_for_clear.devices.values():
                        try:
                            n = int(device.get("device_num"))
                        except (TypeError, ValueError):
                            continue
                        if str(device.get("state") or "ok") != "open":
                            continue
                        if session.last_d8_states.get(n) == "open":
                            continue
                        stale_open[n] = "ok"
                    if stale_open:
                        await self._apply_device_states(
                            panel_id,
                            stale_open,
                            force_nums=set(stale_open),
                            clear_alarm=True,
                        )
            count = await self._publish_declared_states_snapshot(panel_id)
        finally:
            self._poll_pause_depth = max(0, self._poll_pause_depth - 1)

        inventory = await self._apply_device_inventory(panel_id, inventory_acc)

        panel = self.panel_bus.panels.get(panel_id)
        states = {
            d["global_id"]: d.get("state", "ok")
            for d in (panel.devices.values() if panel else [])
        }
        disables = {
            d["global_id"]: d.get("disable") or "none"
            for d in (panel.devices.values() if panel else [])
        }
        models = {
            d["global_id"]: d.get("model") or ""
            for d in (panel.devices.values() if panel else [])
        }
        zones = {
            d["global_id"]: d.get("zone_id")
            for d in (panel.devices.values() if panel else [])
        }
        declared = set(panel.devices.keys()) if panel else set()
        matched = {
            make_device_global_id(panel_id, n)
            for n in seen_nums
            if make_device_global_id(panel_id, n) in declared
        }
        stream_code = bool(getattr(panel, "stream_code", "") if panel else "")
        return {
            "ok": True,
            "synced": count,
            "hid_device_updates": applied_total,
            "hid_device_nums": sorted(seen_nums),
            "matched_declared": len(matched),
            "has_stream_code": stream_code,
            "device_stream_ok": self.is_device_stream_ok(panel_id),
            "needs_stream_code": not stream_code and applied_total == 0,
            "packet_types": dict(session.packet_type_counts),
            "recent_device_packets": list(session.recent_device_packets[-40:]),
            "last_55_by_device": {
                str(k): v for k, v in sorted(session.last_55_by_device.items())
            },
            "disable_probe": probe_disables,
            "tmp_probe": dict(session.last_tmp_probe),
            "sticky_tmp_nums": sorted(session.sticky_tmp_nums),
            "states": states,
            "disables": disables,
            "models": models,
            "zones": zones,
            "inventory": inventory,
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
                perms = ["admin", "arm", "disarm"] if i == 1 else ["arm", "disarm"]
                await self.panel_bus.create_user(
                    panel_id,
                    name=f"User {i}",
                    code_label="",
                    permissions=perms,
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
                "Đã tạo theo số lượng; đồng bộ HID gán Section (0x3b), họ thiết bị và Bus/RF (0x8a). "
                "SKU F-Link chọn tay — byte 0x04 không bịa model. Name F-Link chưa đọc được qua USB."
            ),
        }

    async def _apply_device_inventory(
        self, panel_id: str, updates: ParsedUpdates
    ) -> dict[str, Any]:
        """Apply HID section map (0x3b) + family/link (0x8a) onto declared devices.

        Unique SKU (JA-118M) is applied only when the stored model is empty/generic.
        Byte 0x04 never invents a SKU — placeholder models like JA-bus are cleared.
        Manual types (pir/door/…) and manual SKUs are not overwritten.
        Delay/Repeat Reaction is inferred from unique 0x55 events (not Instant/24h).
        """
        panel = self.panel_bus.panels.get(panel_id)
        empty = {
            "sections_applied": 0,
            "types_applied": 0,
            "models_applied": 0,
            "links_applied": 0,
            "reactions_applied": 0,
            "device_sections": {},
            "device_models": {},
            "device_types": {},
            "device_links": {},
            "device_reactions": {},
        }
        if not panel:
            return empty

        section_to_zone: dict[int, str] = {}
        for zone in panel.zones.values():
            try:
                sec = int(zone.get("section_num"))
            except (TypeError, ValueError):
                continue
            section_to_zone[sec] = zone["zone_id"]

        for section in sorted(set(updates.device_sections.values())):
            if section in section_to_zone:
                continue
            zone = await self.panel_bus.create_zone(
                panel_id,
                name=f"Section {section}",
                section_num=section,
            )
            section_to_zone[section] = zone["zone_id"]

        sections_applied = 0
        types_applied = 0
        models_applied = 0
        links_applied = 0
        reactions_applied = 0
        changed: list[str] = []
        nums = (
            set(updates.device_sections)
            | set(updates.device_types)
            | set(updates.device_models)
            | set(updates.device_links)
            | set(updates.device_reactions)
        )
        for device_num in sorted(nums):
            global_id = make_device_global_id(panel_id, device_num)
            device = panel.devices.get(global_id)
            if not device:
                continue
            kwargs: dict[str, Any] = {}
            if device_num in updates.device_sections:
                zone_id = section_to_zone.get(updates.device_sections[device_num])
                if zone_id and device.get("zone_id") != zone_id:
                    kwargs["zone_id"] = zone_id
                    kwargs["update_zone"] = True
                    sections_applied += 1
            if device_num in updates.device_types:
                next_type = updates.device_types[device_num]
                cur_type = (device.get("device_type") or "sensor").lower()
                if next_type and is_unrefined_device_type(cur_type) and cur_type != next_type:
                    kwargs["device_type"] = next_type
                    types_applied += 1
            if device_num in updates.device_models:
                next_model = updates.device_models[device_num] or ""
                cur_model = device.get("model") or ""
                if next_model:
                    if is_generic_model_hint(cur_model) and cur_model != next_model:
                        kwargs["model"] = next_model
                        models_applied += 1
                elif cur_model and is_generic_model_hint(cur_model):
                    kwargs["model"] = ""
                    models_applied += 1
            if device_num in updates.device_links:
                next_link = updates.device_links[device_num] or ""
                if next_link in ("bus", "rf") and (device.get("link") or "") != next_link:
                    kwargs["link"] = next_link
                    links_applied += 1
            if device_num in updates.device_reactions:
                next_reaction = updates.device_reactions[device_num]
                if hid_reaction_overrides(device.get("reaction"), next_reaction):
                    kwargs["reaction"] = next_reaction
                    reactions_applied += 1
            if not kwargs:
                continue
            await self.panel_bus.upsert_device(panel_id, device_num, **kwargs)
            changed.append(global_id)

        if changed:
            await self.event_hub.publish(
                {
                    "type": "devices_inventory_updated",
                    "panel_id": panel_id,
                    "device_ids": changed,
                    "sections_applied": sections_applied,
                    "types_applied": types_applied,
                    "models_applied": models_applied,
                    "links_applied": links_applied,
                    "reactions_applied": reactions_applied,
                }
            )

        return {
            "sections_applied": sections_applied,
            "types_applied": types_applied,
            "models_applied": models_applied,
            "links_applied": links_applied,
            "reactions_applied": reactions_applied,
            "device_sections": {str(k): v for k, v in updates.device_sections.items()},
            "device_models": {str(k): v for k, v in updates.device_models.items()},
            "device_types": {str(k): v for k, v in updates.device_types.items()},
            "device_links": {str(k): v for k, v in updates.device_links.items()},
            "device_reactions": {str(k): v for k, v in updates.device_reactions.items()},
        }

    async def _reset_declared_states(
        self,
        panel_id: str,
        *,
        state: str = "ok",
        only_activity: bool = False,
    ) -> int:
        """Force declared device rows to a baseline state and push WS batch."""
        panel = self.panel_bus.panels.get(panel_id)
        if not panel or not panel.devices:
            return 0
        updates: dict[str, str] = {}
        for gid, device in panel.devices.items():
            current = str(device.get("state") or "ok")
            if current == state:
                continue
            # Keep F-Link TMP / fault / alarm unless caller wants a full wipe.
            if only_activity and current in PROBLEM_DEVICE_STATES:
                continue
            device["state"] = state
            updates[gid] = state
            if self.panel_bus._persist:
                asyncio.create_task(panel_store.save_device(device))
        if updates:
            await self.event_hub.publish(
                {
                    "type": "devices_state_batch",
                    "panel_id": panel_id,
                    "updates": updates,
                }
            )
        return len(updates)

    async def _initial_sync(self, panel_id: str) -> None:
        """Intensive drain after connect — always auth+enable when stream_code exists."""
        session = self._sessions.get(panel_id)
        if session:
            session.force_stream_refresh = True
            session.last_enable_states_at = 0.0
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

    async def _drain_session_only(self, panel_id: str) -> ParsedUpdates:
        """Read HID without writing — captures async 0x55/0xd8 between keepalives."""
        collected = empty_updates()
        session = self._sessions.get(panel_id)
        if not session:
            return collected
        panel = self.panel_bus.panels.get(panel_id)
        stream_code = (getattr(panel, "stream_code", "") or "").strip() if panel else ""
        async with session.lock:
            batch = await self._drain_hid(session, rounds=40, timeout_ms=40)
            for packet in sorted(batch, key=packet_sort_key):
                if not packet:
                    continue
                session.packet_type_counts[f"0x{packet[0]:02x}"] += 1
                parsed = parse_packet(packet)
                self._annotate_keypad_auth(session, panel, packet, parsed)
                self._note_status_bus_type(session, packet)
                if packet[:1] == b"\xd8":
                    self._remember_activity_bitmap(session, parsed)
                if packet[:1] == b"\x55" and len(packet) >= 6:
                    dnum = _parse_device_number(packet)
                    if 1 <= dnum <= 99:
                        session.last_55_by_device[dnum] = packet.hex()
                if packet[:1] in (b"\xd8", b"\x55", b"\x80", b"\xd0", b"\x5f", b"\x3b", b"\x94", b"\x52"):
                    marker = (
                        f"{packet.hex()}"
                        f"#{len(parsed.device_states)}"
                        f"d{len(parsed.device_disable)}"
                    )
                    session.recent_device_packets.append(marker)
                    if len(session.recent_device_packets) > 80:
                        session.recent_device_packets = session.recent_device_packets[-80:]
                merge_updates(collected, parsed)
            if (
                collected.device_states
                or collected.device_disable
                or collected.section_states
                or collected.section_triggered
                or collected.pg_states
                or collected.panel_armed
            ):
                await self._apply_updates(panel_id, collected)
            await self._expire_pir_pulse_act(panel_id)
            if batch:
                session.last_packet_at = time.monotonic()
            if collected.device_states:
                session.last_device_state_at = time.monotonic()
            await self._publish_live_signals(
                panel_id,
                session,
                collected,
                packet_count=len(batch),
                has_stream_code=bool(stream_code),
            )
        return collected

    async def _poll_session(self, panel_id: str, *, intensive: bool = False) -> ParsedUpdates:
        collected = empty_updates()
        session = self._sessions.get(panel_id)
        if not session:
            return collected

        async with session.lock:
            # 1) Drain anything already queued (async 0x55/0xd8 between polls).
            batch: list[bytes] = []
            batch.extend(await self._drain_hid(session, rounds=8 if intensive else 6, timeout_ms=20))

            now = time.monotonic()
            panel = self.panel_bus.panels.get(panel_id)
            stream_code = (getattr(panel, "stream_code", "") or "").strip() if panel else ""

            # JA-100: device-state packets (0x55/0xd8) require auth + enable (admin/service PIN).
            # Match HA: re-auth ~30s; if stream is quiet, retry sooner.
            stream_quiet = (
                session.last_device_state_at == 0
                or (now - session.last_device_state_at) > 8
            )
            enable_every = 12 if stream_quiet else 28
            need_enable = session.force_stream_refresh or (
                now - session.last_enable_states_at > enable_every
            )
            if need_enable:
                if stream_code:
                    try:
                        for pkt in build_device_stream_keepalive(stream_code):
                            await self._hid_call(self._hid_write, session, pkt)
                            await asyncio.sleep(0.05)
                    except ValueError:
                        # Invalid stored PIN — fall back to unauthenticated enable (sections/PG only).
                        for pkt in build_init_sequence():
                            await self._hid_call(self._hid_write, session, pkt)
                            await asyncio.sleep(0.02)
                else:
                    for pkt in build_init_sequence():
                        await self._hid_call(self._hid_write, session, pkt)
                        await asyncio.sleep(0.02)
                session.last_enable_states_at = now
                session.force_stream_refresh = False
                session.last_sections_poll_at = now
                # Give the panel time to push the first 0xd8/0x55 after auth+enable.
                await asyncio.sleep(0.25 if intensive else 0.12)
            else:
                # Heartbeat every poll (HA). Sections/PG sparsely — even in intensive
                # sync, spamming 0x0e floods the bus and crowds out 0x55/0xd8.
                for pkt in build_poll_sequence():
                    await self._hid_call(self._hid_write, session, pkt)
                    await asyncio.sleep(0.01)
                sections_every = 0.8 if intensive else 1.5
                if now - session.last_sections_poll_at > sections_every:
                    for pkt in build_sections_poll_sequence():
                        await self._hid_call(self._hid_write, session, pkt)
                        await asyncio.sleep(0.02)
                    session.last_sections_poll_at = now
                # Round-robin GET_DEVICE_STATUS — JA-110P TMP lives in 0x8a bit 0x10,
                # while 0x55 often only reports Instant/ACT for the same address.
                if panel and (now - session.last_status_probe_at) > (1.2 if intensive else 2.5):
                    nums = sorted(
                        {
                            int(d.get("device_num"))
                            for d in panel.devices.values()
                            if d.get("device_num") is not None
                        }
                    )
                    if nums:
                        n_take = min(4, len(nums))
                        start = session.status_probe_cursor % len(nums)
                        for i in range(n_take):
                            n = nums[(start + i) % len(nums)]
                            await self._hid_call(
                                self._hid_write, session, build_get_device_status_packet(n)
                            )
                            await asyncio.sleep(0.02)
                        session.status_probe_cursor = (start + n_take) % len(nums)
                        session.last_status_probe_at = now

            await asyncio.sleep(0.05 if not intensive else 0.12)
            # 2) Read responses — favor longer drain so async 0x55/0xd8 arrive.
            batch.extend(
                await self._drain_hid(
                    session,
                    rounds=64 if intensive else 28,
                    timeout_ms=60 if intensive else 35,
                )
            )

            login_error = False
            for packet in sorted(batch, key=packet_sort_key):
                if not packet:
                    continue
                phex = f"0x{packet[0]:02x}"
                session.packet_type_counts[phex] += 1
                if is_login_error_packet(packet):
                    login_error = True
                parsed = parse_packet(packet)
                self._annotate_keypad_auth(session, panel, packet, parsed)
                self._note_status_bus_type(session, packet)
                if packet[:1] == b"\xd8":
                    self._remember_activity_bitmap(session, parsed)
                if packet[:1] == b"\x55" and len(packet) >= 6:
                    dnum = _parse_device_number(packet)
                    if 1 <= dnum <= 99:
                        session.last_55_by_device[dnum] = packet.hex()
                if packet[:1] in (b"\xd8", b"\x55", b"\x80", b"\xd0", b"\x5f", b"\x3b", b"\x94", b"\x52"):
                    session.recent_device_packets.append(
                        f"{packet.hex()}#{len(parsed.device_states)}d{len(parsed.device_disable)}"
                    )
                    if len(session.recent_device_packets) > 80:
                        session.recent_device_packets = session.recent_device_packets[-80:]
                merge_updates(collected, parsed)
            if login_error:
                session.force_stream_refresh = True
                await self.event_hub.publish(
                    {
                        "type": "usb_error",
                        "panel_id": panel_id,
                        "detail": "wrong_stream_pin",
                    }
                )
            if (
                collected.device_states
                or collected.device_disable
                or collected.section_states
                or collected.section_triggered
                or collected.pg_states
                or collected.panel_armed
            ):
                await self._apply_updates(panel_id, collected)
            await self._expire_pir_pulse_act(panel_id)

            if batch:
                session.last_packet_at = time.monotonic()
                if panel:
                    panel.last_seen_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    if panel.connection != "usb":
                        panel.connection = "usb"
            # Only mark stream healthy when we actually parsed device addresses.
            if collected.device_states:
                session.last_device_state_at = time.monotonic()

            await self._publish_live_signals(
                panel_id,
                session,
                collected,
                packet_count=len(batch),
                has_stream_code=bool(stream_code),
            )
            return collected

    def _drain_hid_sync(
        self,
        session: _HidSession,
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
                time.sleep(0.005)
                continue
            empty_streak = 0
            out.extend(split_packets(raw))
        return out

    async def _drain_hid(
        self,
        session: _HidSession,
        *,
        rounds: int,
        timeout_ms: int,
    ) -> list[bytes]:
        return await self._hid_call(self._drain_hid_sync, session, rounds, timeout_ms)

    async def _publish_live_signals(
        self,
        panel_id: str,
        session: _HidSession,
        collected: ParsedUpdates,
        *,
        packet_count: int,
        has_stream_code: bool,
    ) -> None:
        """Heartbeat + periodic snapshot so UI stays realtime even when states are stable."""
        now = time.monotonic()
        heartbeat_sec = max(0.5, float(self.settings.usb_live_heartbeat_sec))
        snapshot_sec = max(1.0, float(self.settings.usb_snapshot_interval_sec))
        device_stream_ok = self.is_device_stream_ok(panel_id)

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
                    "device_stream_ok": device_stream_ok,
                    "has_stream_code": has_stream_code,
                    "needs_stream_code": receiving and not has_stream_code,
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
            # Heal sticky alarm left when UI disarm updated armed_state before HID.
            await self._clear_sticky_alarms_while_disarmed(panel_id)
            # Quiet reconcile — UI applies states without row-flash spam.
            await self._publish_declared_states_snapshot(
                panel_id,
                event_type="devices_state_snapshot",
            )

    async def _clear_stale_problem_states(
        self,
        panel_id: str,
        *,
        confirmed_problem_nums: set[int],
        only_states: frozenset[str] | None = None,
    ) -> None:
        """Clear selected problem states not reconfirmed by forced 0x55 this sync."""
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return
        session = self._sessions.get(panel_id)
        allowed = only_states if only_states is not None else PROBLEM_DEVICE_STATES
        to_clear: dict[int, str] = {}
        for device in list(panel.devices.values()):
            num = device.get("device_num")
            if num is None:
                continue
            try:
                n = int(num)
            except (TypeError, ValueError):
                continue
            if n in confirmed_problem_nums:
                continue
            cur = str(device.get("state") or "ok")
            if cur not in allowed:
                continue
            if cur == "alarm" and reaction_alarms_when_disarmed(device.get("reaction")):
                continue
            to_clear[n] = self._bitmap_act_or_ok(session, n)
        if to_clear:
            await self._apply_device_states(
                panel_id,
                to_clear,
                force_nums=set(to_clear),
                clear_alarm=True,
            )

    async def _clear_sticky_alarms_while_disarmed(self, panel_id: str) -> None:
        """While disarmed: sticky Báo động → trạng thái thật; Instant ACT lỗi thời → OK."""
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return
        session = self._sessions.get(panel_id)
        to_clear: dict[int, str] = {}
        for device in panel.devices.values():
            try:
                n = int(device.get("device_num"))
            except (TypeError, ValueError):
                continue
            if self._device_section_armed(panel, n):
                continue
            if reaction_alarms_when_disarmed(self._device_reaction(panel, n)):
                continue
            cur = str(device.get("state") or "ok")
            real = self._bitmap_act_or_ok(session, n)
            if cur == "alarm":
                to_clear[n] = real
                if session is not None:
                    session.pulse_act_until.pop(n, None)
                continue
            if cur == "open" and real == "ok":
                to_clear[n] = "ok"
                if session is not None:
                    session.pulse_act_until.pop(n, None)
        if not to_clear:
            return
        # Direct write + publish — do not rely solely on should_replace edge cases.
        await self._apply_device_states(
            panel_id,
            to_clear,
            force_nums=set(to_clear),
            clear_alarm=True,
        )
        # If anything still stuck on alarm (race), force memory + WS.
        leftover: dict[str, str] = {}
        for n, real in to_clear.items():
            gid = make_device_global_id(panel_id, n)
            dev = panel.devices.get(gid)
            if not dev:
                continue
            if str(dev.get("state") or "ok") == "alarm":
                dev["state"] = real
                leftover[gid] = real
                if self.panel_bus._persist:
                    asyncio.create_task(panel_store.save_device(dev))
        if leftover:
            await self.event_hub.publish(
                {
                    "type": "devices_state_batch",
                    "panel_id": panel_id,
                    "updates": leftover,
                }
            )

    @staticmethod
    def _bitmap_act_or_ok(session: _HidSession | None, device_num: int) -> str:
        """F-Link Status ACT/OK from last activity bitmap (0xd8)."""
        if session is not None and session.last_d8_states.get(device_num) == "open":
            return "open"
        return "ok"

    def _note_status_bus_type(self, session: _HidSession, packet: bytes) -> None:
        if (
            packet[:1] == b"\x52"
            and len(packet) >= 6
            and packet[2:3] == b"\x8a"
        ):
            device_num = int(packet[3])
            if 1 <= device_num <= 99:
                session.bus_type_by_device[device_num] = int(packet[4])

    def _is_level_contact_device(
        self, session: _HidSession, panel_id: str, device_num: int
    ) -> bool:
        """Door/magnet contacts keep sticky ACT while open (not pulse).

        Prefer CMS ``device_type`` — bus nibble 0x04 is shared by PIR/JA-bus and
        must not force door magnets onto the pulse-ACT path (that cleared ACT→OK
        and corrupted ``last_d8``).
        """
        panel = self.panel_bus.panels.get(panel_id)
        if panel is not None:
            global_id = make_device_global_id(panel_id, device_num)
            dtype = str(
                (panel.devices.get(global_id) or {}).get("device_type") or ""
            ).lower()
            if dtype in _LEVEL_CONTACT_DEVICE_TYPES:
                return True
        if device_num in session.bus_type_by_device:
            bus = int(session.bus_type_by_device[device_num]) & 0xFF
            return bus in _LEVEL_CONTACT_BUS_TYPES
        return False
    def _is_pulse_act_device(
        self, session: _HidSession, panel_id: str, device_num: int
    ) -> bool:
        """DEV_09-style short ACT for declared Instant/pulse sensors.

        All UI-declared devices use this path except level contacts (door magnets).
        Newly synced devices are included as soon as they exist in panel.devices;
        bus type from 0x8a refines classification when available.
        """
        panel = self.panel_bus.panels.get(panel_id)
        if panel is None:
            return False
        global_id = make_device_global_id(panel_id, device_num)
        if global_id not in panel.devices:
            # Undeclared HID address — only treat classic PIR bus nibble as pulse.
            return (session.bus_type_by_device.get(device_num, 0) & 0x0F) == 0x04
        if self._is_level_contact_device(session, panel_id, device_num):
            return False
        return True

    def _remember_activity_bitmap(self, session: _HidSession, updates: ParsedUpdates) -> None:
        """Store 0xd8 ACT/OK bits — Instant can spam ACT while bitmap is idle.

        Only addresses **without** 0x55 force in this batch are treated as bitmap
        truth. (Old code skipped the whole batch when any Instant was present,
        leaving last_d8 stale and ACT stuck after disarm.)
        """
        for device_num, state in updates.device_states.items():
            if state not in ("ok", "open"):
                continue
            if device_num in updates.device_state_force:
                continue
            session.last_d8_states[device_num] = state

    def _heal_stale_fault_from_bitmap(
        self,
        session: _HidSession,
        panel_id: str,
        updates: ParsedUpdates,
    ) -> None:
        """If 0xd8 already shows ACT/OK, drop sticky Error not reconfirmed this batch."""
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return
        for device_num, d8 in session.last_d8_states.items():
            if d8 not in ("ok", "open"):
                continue
            if device_num in updates.device_states:
                continue
            global_id = make_device_global_id(panel_id, device_num)
            cur = str((panel.devices.get(global_id) or {}).get("state") or "ok")
            if cur != "fault":
                continue
            updates.device_states[device_num] = d8

    def _arm_pir_pulse_act(
        self, session: _HidSession, panel_id: str, updates: ParsedUpdates
    ) -> None:
        """Refresh pulse ACT window on Instant/0x55 ON (F-Link-style short ACT)."""
        now = time.monotonic()
        for device_num, state in updates.device_states.items():
            if state != "open" or device_num not in updates.device_state_force:
                continue
            if not self._is_pulse_act_device(session, panel_id, device_num):
                continue
            session.pulse_act_until[device_num] = now + PULSE_ACT_SECONDS

    def _apply_pir_pulse_window(
        self, session: _HidSession, panel_id: str, updates: ParsedUpdates
    ) -> None:
        """Drop sticky pulse ACT from 0xd8 after the Instant pulse window ends."""
        now = time.monotonic()
        panel = self.panel_bus.panels.get(panel_id)
        for device_num, state in list(updates.device_states.items()):
            if state != "open" or not self._is_pulse_act_device(
                session, panel_id, device_num
            ):
                continue
            until = session.pulse_act_until.get(device_num, 0.0)
            if now <= until:
                continue
            # While armed, keep open so promote → alarm (Dev_09 lần 1 bitmap/ACTIVITY).
            if panel is not None and self._device_section_armed(panel, device_num):
                continue
            # 24h/Fire: ACT khi phân khu tắt vẫn phải promote Báo động — không hạ OK.
            if panel is not None and reaction_alarms_when_disarmed(
                self._device_reaction(panel, device_num)
            ):
                continue
            updates.device_states[device_num] = "ok"
            updates.device_state_force.add(device_num)
            if session.last_d8_states.get(device_num) == "open":
                session.last_d8_states[device_num] = "ok"

    def _reconcile_instant_with_bitmap(
        self,
        session: _HidSession,
        panel_id: str,
        updates: ParsedUpdates,
    ) -> None:
        """Drop false Instant ACT when activity bitmap already shows idle (F-Link OK).

        While armed: keep Instant/Delayed/Repeated ON (``device_alarm_events``) even
        if ``last_d8`` is still OK so first-trigger promote → Báo động works.

        While disarmed: do NOT keep those Instant events — otherwise JA-118M doors
        stick on ACT after Tắt bảo vệ (Instant residue + idle bitmap).
        """
        if not session.last_d8_states:
            return
        alarm_addrs = getattr(updates, "device_alarm_events", None) or set()
        panel = self.panel_bus.panels.get(panel_id)
        now = time.monotonic()
        for device_num, state in list(updates.device_states.items()):
            if state != "open":
                continue
            # 24h/Fire/Panic: giữ ACT để promote Báo động (kể cả phân khu tắt).
            # 0x55 ACTIVITY thường tới trước 0xd8 — last_d8=ok không được nuốt trip.
            if panel is not None and reaction_alarms_when_disarmed(
                self._device_reaction(panel, device_num)
            ):
                continue
            # Armed + real Instant/Delayed/Repeated → keep for promote.
            if device_num in alarm_addrs and panel is not None:
                if self._device_section_armed(panel, device_num):
                    continue
            # Pulse device inside window keeps ACT even if a prior d8 said ok.
            if (
                self._is_pulse_act_device(session, panel_id, device_num)
                and now <= session.pulse_act_until.get(device_num, 0.0)
            ):
                continue
            if session.last_d8_states.get(device_num) != "ok":
                continue
            updates.device_states[device_num] = "ok"
            updates.device_state_force.add(device_num)

    async def _expire_pir_pulse_act(self, panel_id: str) -> None:
        """Clear pulse ACT → OK when Instant pulse window ends (no packet required)."""
        session = self._sessions.get(panel_id)
        panel = self.panel_bus.panels.get(panel_id)
        if session is None or panel is None:
            return
        now = time.monotonic()
        to_clear: dict[int, str] = {}
        history_ok: list[tuple[str, dict[str, Any]]] = []
        for device_num, until in list(session.pulse_act_until.items()):
            if now < until:
                continue
            session.pulse_act_until.pop(device_num, None)
            if not self._is_pulse_act_device(session, panel_id, device_num):
                continue
            if session.last_d8_states.get(device_num) == "open":
                session.last_d8_states[device_num] = "ok"
            global_id = make_device_global_id(panel_id, device_num)
            device = panel.devices.get(global_id) or {}
            current = str(device.get("state") or "ok")
            if current == "open":
                to_clear[device_num] = "ok"
            elif current == "alarm":
                # Sticky Báo động giữ trên UI; lịch sử vẫn ghi OK khi hết xung PIR.
                history_ok.append((global_id, device))
        if to_clear:
            await self._apply_device_states(
                panel_id, to_clear, force_nums=set(to_clear)
            )
        for global_id, device in history_ok:
            await self.event_hub.publish(
                {
                    "type": "device_state",
                    "panel_id": panel_id,
                    "device_id": global_id,
                    "state": "ok",
                    "disable": device.get("disable") or "none",
                    "history_only": True,
                }
            )

    def _track_tmp_sticky(self, session: _HidSession, updates: ParsedUpdates) -> None:
        """Track JA-110P TMP / cover-open (flag 0x11) from 0x8a."""
        for device_num, state in updates.device_states.items():
            if state == "tamper" and device_num in updates.device_state_force:
                if updates.device_disable.get(device_num) == "tamper":
                    session.sticky_tmp_nums.discard(device_num)
                else:
                    session.sticky_tmp_nums.add(device_num)
            # Forced OK + Tamper bypass without tmp_clear → cover open (flag 0x11).
            if (
                state == "ok"
                and device_num in updates.device_state_force
                and updates.device_disable.get(device_num) == "tamper"
                and device_num not in updates.device_tmp_clear
            ):
                session.physical_tmp_nums.add(device_num)
                session.sticky_tmp_nums.discard(device_num)
        for device_num, bypass in updates.device_disable.items():
            if bypass == "tamper":
                session.sticky_tmp_nums.discard(device_num)
        for device_num in updates.device_tmp_clear:
            session.sticky_tmp_nums.discard(device_num)
            session.physical_tmp_nums.discard(device_num)

    def _device_section_armed(self, panel: Any, device_num: int) -> bool:
        """True when the device's section (or panel) is armed/partial.

        Trust zone ``armed_state`` when the device is assigned — do not fall back to
        panel ``armed`` while the zone already says disarmed (that re-promoted
        Instant → Báo động after Tắt bảo vệ and kept the red section LED).
        """
        global_id = make_device_global_id(panel.panel_id, device_num)
        device = panel.devices.get(global_id) or {}
        zone_id = device.get("zone_id")
        if zone_id and zone_id in panel.zones:
            armed = str(panel.zones[zone_id].get("armed_state") or "disarmed")
            return armed in ("armed", "partial")
        return str(getattr(panel, "armed_state", None) or "disarmed") in (
            "armed",
            "partial",
        )

    def _device_reaction(self, panel: Any, device_num: int) -> str:
        global_id = make_device_global_id(panel.panel_id, device_num)
        return normalize_reaction((panel.devices.get(global_id) or {}).get("reaction"))

    def _acked_always(self, panel_id: str) -> set[int]:
        store = getattr(self, "_acked_always_nums", None)
        if store is None:
            self._acked_always_nums = {}
            store = self._acked_always_nums
        return store.setdefault(panel_id, set())

    def _acked_always_path(self):
        try:
            return self.settings.hwid_cache_path.parent / "acked_always.json"
        except Exception:
            return BACKEND_ROOT / "data" / "acked_always.json"

    def _load_acked_always(self) -> None:
        path = self._acked_always_path()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError):
            return
        if not isinstance(raw, dict):
            return
        for panel_id, nums in raw.items():
            if not isinstance(nums, list):
                continue
            bucket = self._acked_always(str(panel_id))
            for n in nums:
                try:
                    bucket.add(int(n))
                except (TypeError, ValueError):
                    continue

    def _save_acked_always(self) -> None:
        path = self._acked_always_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                pid: sorted(nums)
                for pid, nums in (getattr(self, "_acked_always_nums", {}) or {}).items()
                if nums
            }
            path.write_text(json.dumps(payload), encoding="utf-8")
        except OSError:
            pass

    def _ack_always_add(self, panel_id: str, device_num: int) -> None:
        self._acked_always(panel_id).add(int(device_num))

    def _ack_always_discard(self, panel_id: str, device_num: int) -> None:
        store = self._acked_always(panel_id)
        if int(device_num) not in store:
            return
        store.discard(int(device_num))
        self._save_acked_always()

    @staticmethod
    def _is_keypad_device(panel: Any, session: _HidSession | None, device_num: int) -> bool:
        if device_num in (SYSTEM_DEVICE_MOBILE, SYSTEM_DEVICE_USB):
            return True
        if device_num >= SYSTEM_DEVICE_RESERVED_MIN:
            return True
        gid = make_device_global_id(panel.panel_id, device_num)
        dev = (panel.devices.get(gid) or {}) if panel else {}
        dt = str(dev.get("device_type") or "").lower()
        if dt == "keypad":
            return True
        model = str(dev.get("model") or "").upper().replace(" ", "")
        if model.startswith("JA-11") and model.endswith("E"):
            return True
        if model.startswith("JA-15") and model.endswith("E"):
            return True
        bus = session.bus_type_by_device.get(device_num) if session else None
        if bus is not None and (int(bus) & 0x0F) in (1, 2, 3):
            return True
        return False

    def _annotate_keypad_auth(
        self,
        session: _HidSession | None,
        panel: Any,
        packet: bytes,
        parsed: ParsedUpdates,
    ) -> None:
        if not panel or packet[:1] != b"\x55":
            return
        if is_device_state_heartbeat(packet):
            return
        try:
            dnum = _parse_device_number(packet)
        except (TypeError, ValueError):
            return
        if dnum < 0 or dnum > 255:
            return
        if not self._is_keypad_device(panel, session, dnum):
            return
        parsed.keypad_authorized = True
        parsed.device_states.pop(dnum, None)
        parsed.device_alarm_events.discard(dnum)
        parsed.device_state_force.discard(dnum)

    async def _clear_zone_keypad_alarm_leds(
        self,
        panel_id: str,
        section_nums: set[int] | None,
    ) -> None:
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return
        for zone in panel.zones.values():
            try:
                sec = int(zone.get("section_num")) if zone.get("section_num") is not None else None
            except (TypeError, ValueError):
                continue
            if section_nums is not None and sec not in section_nums:
                continue
            if not zone.get("keypad_alarm"):
                continue
            zone["keypad_alarm"] = False
            if self.panel_bus._persist:
                await panel_store.save_zone(zone)
            await self.event_hub.publish(
                {
                    "type": "zone_armed",
                    "panel_id": panel_id,
                    "zone_id": zone["zone_id"],
                    "section_num": zone.get("section_num"),
                    "armed_state": zone.get("armed_state") or "disarmed",
                    "keypad_alarm": False,
                    "history": False,
                }
            )

    async def _ack_alarms_from_physical_keypad(self, panel_id: str) -> None:
        """PIN trên bàn phím vật lý khi đang Báo động → gỡ CMS + LED, map về lưới."""
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return
        if not any(str(d.get("state") or "ok") == "alarm" for d in panel.devices.values()):
            return
        await self._clear_alarms_on_disarm(panel_id, whole_panel=True)
        await self._clear_zone_keypad_alarm_leds(panel_id, None)
        sess = self._sessions.get(panel_id)
        if sess is not None:
            sess.force_stream_refresh = True

    def _device_has_no_battery(
        self, session: _HidSession | None, panel: Any, device_num: int
    ) -> bool:
        """Wired BUS contacts have no battery — HA treats 0x14 as activity."""
        gid = make_device_global_id(panel.panel_id, device_num)
        link = str((panel.devices.get(gid) or {}).get("link") or "").lower()
        if link == "bus":
            return True
        if link == "rf":
            return False
        return False

    def _reinterpret_trip_fault(
        self,
        panel: Any,
        session: _HidSession | None,
        updates: ParsedUpdates,
    ) -> None:
        """Map one-shot 0x55 Error (0x05/0x14) to ACT for 24h trips and bus contacts.

        F-Link Status for an open 24h/Instant contact is ACT, not Error. CMS used
        to keep ``fault`` (Lỗi) so promote never ran and automation skipped snapshot.
        HA: BATTERY_FAULT on a device without battery is active state.
        """
        for device_num, state in list(updates.device_states.items()):
            if state != "fault" or device_num not in updates.device_state_force:
                continue
            always = reaction_alarms_when_disarmed(self._device_reaction(panel, device_num))
            d8_open = bool(session and session.last_d8_states.get(device_num) == "open")
            no_batt = self._device_has_no_battery(session, panel, device_num)
            if not (always or no_batt or d8_open):
                continue
            updates.device_states[device_num] = "open"
            if always:
                updates.device_alarm_events.add(device_num)

    def _promote_act_to_alarm_when_armed(
        self,
        panel: Any,
        updates: ParsedUpdates,
        session: _HidSession | None = None,
    ) -> set[int]:
        """Instant/Delay: Báo động khi phân khu armed.
        24h / Fire / Panic / Flood / Gas: Báo động luôn (không cần armed).
        Report / None: không promote.

        PIR (pulse) may send ACTIVITY before Instant on the first trip — also
        promote forced ACT for pulse devices so lần 1 Dev_09 gets alarm + map focus.
        Level contacts (doors) stay Instant-only (ACTIVITY alone = ACT, not alarm)
        unless Reaction is 24h / life-safety.

        Returns device nums demoted alarm→open (legacy; now unused).
        """
        demote_open: set[int] = set()
        alarm_addrs = getattr(updates, "device_alarm_events", None) or set()
        panel_id = panel.panel_id
        for device_num, state in list(updates.device_states.items()):
            if state != "open":
                continue
            reaction = self._device_reaction(panel, device_num)
            if reaction in ("report", "keybox", "siren_mute", "none", "none_no_tamper"):
                continue
            always = reaction_alarms_when_disarmed(reaction)
            if always and device_num in self._acked_always(panel_id):
                continue
            is_zone_alarm_evt = device_num in alarm_addrs
            is_pulse_activity = False
            if (
                not is_zone_alarm_evt
                and session is not None
                and device_num in updates.device_state_force
                and self._is_pulse_act_device(session, panel_id, device_num)
            ):
                is_pulse_activity = True
            if always:
                # 0xd8 ACT after restart is the current level, not a new 24h trip.
                if device_num not in updates.device_state_force and not is_zone_alarm_evt:
                    continue
            elif not is_zone_alarm_evt and not is_pulse_activity:
                continue
            elif not self._device_section_armed(panel, device_num):
                continue
            global_id = make_device_global_id(panel_id, device_num)
            current = str((panel.devices.get(global_id) or {}).get("state") or "ok")
            if current in ("tamper", "loss"):
                continue
            updates.device_states[device_num] = "alarm"
            updates.device_state_force.add(device_num)
        return demote_open

    def _device_in_disarm_scope(
        self,
        panel: Any,
        device: dict[str, Any],
        *,
        section_nums: set[int] | None,
        whole_panel: bool,
    ) -> bool:
        if whole_panel:
            return True
        if not section_nums:
            return False
        zone_id = device.get("zone_id")
        zone = panel.zones.get(zone_id) if zone_id else None
        try:
            sec = int(zone.get("section_num")) if zone else None
        except (TypeError, ValueError, AttributeError):
            sec = None
        return sec in section_nums

    async def _clear_alarms_on_disarm(
        self,
        panel_id: str,
        *,
        section_nums: set[int] | None = None,
        whole_panel: bool = False,
    ) -> None:
        """After Tắt bảo vệ: bỏ sticky Báo động và đồng bộ Status thật từ 0xd8.

        - Bitmap ACT → UI ACT (cửa đang mở)
        - Bitmap OK → UI OK (Instant/ACT lỗi thời cũng về OK)
        Không xóa ``last_d8`` — đó là nguồn trạng thái thật.
        """
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return
        session = self._sessions.get(panel_id)
        to_apply: dict[int, str] = {}
        for device in panel.devices.values():
            try:
                n = int(device.get("device_num"))
            except (TypeError, ValueError):
                continue
            if not self._device_in_disarm_scope(
                panel, device, section_nums=section_nums, whole_panel=whole_panel
            ):
                continue
            cur = str(device.get("state") or "ok")
            # TMP / Loss / fault giữ nguyên — chỉ xử lý alarm/ACT/OK.
            if cur in ("tamper", "loss", "fault"):
                continue
            always = reaction_alarms_when_disarmed(device.get("reaction"))
            real = self._bitmap_act_or_ok(session, n)
            if cur == "alarm":
                if always:
                    # Còn ACT → chặn lần kích hiện tại. Đã OK → bỏ ack.
                    if real == "open":
                        self._ack_always_add(panel_id, n)
                    else:
                        self._ack_always_discard(panel_id, n)
                to_apply[n] = real
            elif cur in ("open", "ok") and cur != real:
                to_apply[n] = real
            else:
                continue
            if session is not None:
                session.pulse_act_until.pop(n, None)
        if to_apply:
            self._save_acked_always()
            await self._apply_device_states(
                panel_id,
                to_apply,
                force_nums=set(to_apply),
                clear_alarm=True,
            )

    async def _apply_updates(self, panel_id: str, updates: ParsedUpdates) -> None:
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return
        session = self._sessions.get(panel_id)
        if session is not None:
            if updates.device_bus_types:
                session.bus_type_by_device.update(
                    {int(k): int(v) for k, v in updates.device_bus_types.items()}
                )
            self._remember_activity_bitmap(session, updates)
            self._heal_stale_fault_from_bitmap(session, panel_id, updates)
            self._arm_pir_pulse_act(session, panel_id, updates)
            self._apply_pir_pulse_window(session, panel_id, updates)
            self._reconcile_instant_with_bitmap(session, panel_id, updates)
            self._track_tmp_sticky(session, updates)
            # Overlay sticky TMP so Instant/0xd8 in the same batch cannot win,
            # unless this update (or stored disable) is Tamper-bypass.
            for n in list(session.sticky_tmp_nums):
                bypass = updates.device_disable.get(n)
                if bypass is None:
                    gid = make_device_global_id(panel_id, n)
                    bypass = (panel.devices.get(gid) or {}).get("disable") or "none"
                if bypass == "tamper":
                    session.sticky_tmp_nums.discard(n)
                    continue
                updates.device_states[n] = "tamper"
                updates.device_state_force.add(n)
                updates.device_tmp_clear.discard(n)

        # Apply Disable before composing Status (Tamper-bypass → OK).
        if updates.device_disable:
            await self._apply_device_disable(panel_id, updates.device_disable)
        if updates.device_reactions:
            await self._apply_device_reactions(panel_id, updates.device_reactions)

        prev_panel_armed = str(panel.armed_state or "disarmed")
        disarmed_sections: set[int] = set()
        unset_ack_sections: set[int] = set()

        always_alarm_nums: set[int] = set()
        for device in panel.devices.values():
            try:
                n = int(device.get("device_num"))
            except (TypeError, ValueError):
                continue
            if str(device.get("state") or "ok") != "alarm":
                continue
            if reaction_alarms_when_disarmed(device.get("reaction")):
                always_alarm_nums.add(n)
        # 0x55 trong cùng batch mà không phải cảm biến 24h đang alarm → PIN/bàn phím.
        companion_55 = bool(
            (updates.device_state_force - always_alarm_nums) or updates.keypad_authorized
        )

        # Per-section HID 0x51 only — never fan-out panel_armed onto every zone.
        # Incomplete packets (terminator after section 1) used to arm/disarm the whole UI.
        # LED hết flash ~10s ≠ tắt phân khu. Tắt tay: LED tắt nhanh (<8s) hoặc kèm 0x55.
        for section_num, armed in updates.section_states.items():
            triggered = bool(updates.section_triggered.get(section_num))
            for zone in panel.zones.values():
                try:
                    zone_sec = int(zone.get("section_num"))
                except (TypeError, ValueError):
                    continue
                if zone_sec != int(section_num):
                    continue
                prev = str(zone.get("armed_state") or "disarmed")
                prev_alarm = bool(zone.get("keypad_alarm"))
                if prev == armed and prev_alarm == triggered:
                    continue
                now_mono = time.monotonic()
                if triggered and not prev_alarm:
                    zone["keypad_alarm_since"] = now_mono
                led_on_for = 0.0
                if prev_alarm and not triggered:
                    try:
                        led_on_for = now_mono - float(zone.get("keypad_alarm_since") or 0)
                    except (TypeError, ValueError):
                        led_on_for = 0.0
                    zone.pop("keypad_alarm_since", None)
                zone["armed_state"] = armed
                zone["keypad_alarm"] = triggered
                if self.panel_bus._persist:
                    await panel_store.save_zone(zone)
                physical_unset = False
                if prev in ("armed", "partial") and armed == "disarmed":
                    disarmed_sections.add(int(section_num))
                    physical_unset = True
                elif (
                    prev_alarm
                    and not triggered
                    and prev == "disarmed"
                    and armed == "disarmed"
                    and always_alarm_nums
                    and (
                        companion_55
                        or updates.section_unset_cmds
                        or (0 < led_on_for < 8.0)
                    )
                ):
                    unset_ack_sections.add(int(section_num))
                    physical_unset = True
                await self.event_hub.publish(
                    {
                        "type": "zone_armed",
                        "panel_id": panel_id,
                        "zone_id": zone["zone_id"],
                        "section_num": section_num,
                        "armed_state": armed,
                        "keypad_alarm": triggered,
                        "physical_unset": physical_unset,
                        "history": prev != armed,
                    }
                )

        if updates.section_states:
            await self.panel_bus._sync_panel_armed_from_zones(panel_id)

        just_disarmed_panel = (
            str(panel.armed_state or "disarmed") == "disarmed"
            and prev_panel_armed in ("armed", "partial")
        )
        just_disarmed = just_disarmed_panel or bool(disarmed_sections)

        # Cover-open 0x8a may have forced ok while Instant/ACTIVITY still tagged —
        # restore open while armed so promote can fire (Dev_09 disable=tamper).
        alarm_addrs_pre = getattr(updates, "device_alarm_events", None) or set()
        for device_num in list(alarm_addrs_pre):
            if updates.device_states.get(device_num) != "ok":
                continue
            armed = self._device_section_armed(panel, device_num)
            always = reaction_alarms_when_disarmed(self._device_reaction(panel, device_num))
            if not armed and not always:
                continue
            updates.device_states[device_num] = "open"
            updates.device_state_force.add(device_num)

        # 24h/Fire: 0x55 0x05/0x14 maps to fault — reinterpret as ACT before promote
        # so Status = Báo động (snapshot) instead of Lỗi.
        self._reinterpret_trip_fault(panel, session, updates)

        # Promote BEFORE F-Link compose — Disable=Tamper + cover_open used to turn
        # Instant/ACTIVITY open→ok before promote, so Dev_09 lần 1 never became alarm/focus.
        demote_open = self._promote_act_to_alarm_when_armed(panel, updates, session)

        # Compose F-Link Status. Cover open (0x11) + Disable Tamper → Instant ACT = OK.
        # Never mask sticky alarm; never mask Instant/PIR reaction while still armed.
        if updates.device_states:
            alarm_addrs = getattr(updates, "device_alarm_events", None) or set()
            composed: dict[int, str] = {}
            for device_num, state in updates.device_states.items():
                if state == "alarm":
                    composed[device_num] = "alarm"
                    continue
                bypass = updates.device_disable.get(device_num)
                if bypass is None:
                    gid = make_device_global_id(panel_id, device_num)
                    bypass = (panel.devices.get(gid) or {}).get("disable") or "none"
                # Zone Instant / PIR forced ACT while armed — keep open for Status/UI.
                # Do NOT apply cover-open→OK mask while armed (that killed Dev_09 lần 1).
                if (
                    state == "open"
                    and self._device_section_armed(panel, device_num)
                    and (
                        device_num in alarm_addrs
                        or (
                            session is not None
                            and device_num in updates.device_state_force
                            and self._is_pulse_act_device(session, panel_id, device_num)
                        )
                    )
                ):
                    composed[device_num] = "open"
                    continue
                cover_open = bool(session and device_num in session.physical_tmp_nums)
                if (
                    str(bypass) == "tamper"
                    and state == "ok"
                    and device_num in updates.device_state_force
                    and device_num not in updates.device_tmp_clear
                ):
                    cover_open = True
                    if session is not None:
                        session.physical_tmp_nums.add(device_num)
                shown = flink_status_from_state_disable(
                    state, str(bypass), cover_open_tmp=cover_open
                )
                composed[device_num] = shown
                if shown != "tamper" and session is not None:
                    session.sticky_tmp_nums.discard(device_num)
            updates.device_states = composed

        # Khi vừa tắt bảo vệ: Instant/forced alarm → trạng thái thật từ 0xd8.
        # Giữ ACT thuần từ bitmap (cửa đang mở). Không xóa last_d8.
        if just_disarmed and updates.device_states:
            alarm_addrs = getattr(updates, "device_alarm_events", None) or set()
            for n, st in list(updates.device_states.items()):
                if st not in ("alarm", "open"):
                    continue
                pure_bitmap_open = (
                    st == "open"
                    and n not in updates.device_state_force
                    and n not in alarm_addrs
                )
                if pure_bitmap_open:
                    continue
                real = self._bitmap_act_or_ok(session, n)
                updates.device_states[n] = real
                updates.device_state_force.add(n)
                if session is not None:
                    session.pulse_act_until.pop(n, None)

        if updates.device_states:
            if demote_open:
                demote_states = {
                    n: updates.device_states.pop(n)
                    for n in list(demote_open)
                    if n in updates.device_states
                }
                if demote_states:
                    await self._apply_device_states(
                        panel_id,
                        demote_states,
                        force_nums=set(demote_states),
                        clear_alarm=True,
                    )
            if updates.device_states:
                await self._apply_device_states(
                    panel_id,
                    updates.device_states,
                    force_nums=updates.device_state_force,
                    clear_alarm=False,
                )

        # Clear SAU apply — tránh batch Instant/0xd8 ghi đè alarm→ok / ACT lỗi thời.
        if just_disarmed_panel:
            await self._clear_alarms_on_disarm(panel_id, whole_panel=True)
            sess = self._sessions.get(panel_id)
            if sess is not None:
                sess.force_stream_refresh = True
        elif disarmed_sections:
            await self._clear_alarms_on_disarm(panel_id, section_nums=disarmed_sections)
            sess = self._sessions.get(panel_id)
            if sess is not None:
                sess.force_stream_refresh = True
        elif updates.keypad_authorized or updates.section_unset_cmds or unset_ack_sections:
            # Đã disarmed: tắt phân khu / PIN — gỡ 24h (không dùng LED timeout ~10s).
            secs = set(updates.section_unset_cmds) | unset_ack_sections
            if updates.keypad_authorized or not secs:
                await self._ack_alarms_from_physical_keypad(panel_id)
            else:
                await self._clear_alarms_on_disarm(panel_id, section_nums=secs)
                await self._clear_zone_keypad_alarm_leds(panel_id, secs)
            sess = self._sessions.get(panel_id)
            if sess is not None:
                sess.force_stream_refresh = True

        # Heal every poll: sticky Báo động must not survive while section is disarmed
        # (HID Instant after keypad Tắt bảo vệ used to turn the red LED back on).
        await self._clear_sticky_alarms_while_disarmed(panel_id)

        # JA-110P: 0x8a without TMP bit → clear sticky tamper (cover closed).
        if updates.device_tmp_clear:
            panel_clear = self.panel_bus.panels.get(panel_id)
            for device_num in updates.device_tmp_clear:
                if device_num in updates.device_states and updates.device_states.get(device_num) == "tamper":
                    continue
                global_id = make_device_global_id(panel_id, device_num)
                device = (panel_clear.devices.get(global_id) if panel_clear else None) or {}
                if str(device.get("state") or "ok") == "tamper":
                    await self.panel_bus.set_device_state(panel_id, device_num, "ok")

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
        clear_alarm: bool = False,
    ) -> None:
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return

        force_nums = force_nums or set()
        updates: dict[str, str] = {}
        alarm_triggers: list[str] = []
        cleared_alarm: list[str] = []
        session = self._sessions.get(panel_id)
        for device_num, state in list(device_states.items()):
            global_id = make_device_global_id(panel_id, device_num)
            if global_id not in panel.devices:
                continue
            device = panel.devices[global_id]
            current = str(device.get("state") or "ok")
            section_armed = self._device_section_armed(panel, device_num)
            always = reaction_alarms_when_disarmed(self._device_reaction(panel, device_num))
            # Instant: không ghi Báo động khi phân khu tắt. 24h/Fire/Panic thì được.
            if state == "alarm" and not section_armed and not always:
                state = self._bitmap_act_or_ok(session, device_num)
            # Instant: sticky khi armed.
            # 24h/Fire: ACT → Báo động + Focus; HID OK/cửa đóng KHÔNG gỡ.
            # Chỉ Tắt báo động (PIN) / Tắt bảo vệ (clear_alarm=True) mới gỡ.
            allow_clear = clear_alarm or (
                current == "alarm"
                and not always
                and state in ("ok", "open")
                and not section_armed
            )
            # 24h/Fire về OK (cảm biến hết kích) → bỏ ack để lần kích sau báo động lại.
            # Kể cả khi đang alarm mà Tắt báo động / Tắt bảo vệ (allow_clear).
            if state == "ok" and always and (allow_clear or current != "alarm"):
                self._ack_always_discard(panel_id, device_num)
            if not should_replace_device_state(
                current,
                state,
                forced=device_num in force_nums,
                clear_alarm=allow_clear,
            ):
                if (
                    state == "alarm"
                    and current == "alarm"
                    and device_num in force_nums
                    and section_armed
                    and not always
                ):
                    alarm_triggers.append(global_id)
                continue
            device["state"] = state
            updates[global_id] = state
            if current == "alarm" and state in ("ok", "open") and allow_clear:
                cleared_alarm.append(global_id)
            if state == "alarm" and current != "alarm":
                alarm_triggers.append(global_id)
            if self.panel_bus._persist:
                asyncio.create_task(panel_store.save_device(device))

        if len(updates) == 1:
            global_id, state = next(iter(updates.items()))
            device = panel.devices.get(global_id) or {}
            await self.event_hub.publish(
                {
                    "type": "device_state",
                    "panel_id": panel_id,
                    "device_id": global_id,
                    "state": state,
                    "disable": device.get("disable") or "none",
                    "clear_alarm": global_id in cleared_alarm,
                }
            )
        elif updates:
            await self.event_hub.publish(
                {
                    "type": "devices_state_batch",
                    "panel_id": panel_id,
                    "updates": updates,
                    "clear_alarm_ids": cleared_alarm,
                }
            )

        # Mỗi lần kích hoạt Báo động (mới hoặc Instant lại khi chưa tắt) → focus map.
        for global_id in alarm_triggers:
            device = panel.devices.get(global_id) or {}
            await self.event_hub.publish(
                {
                    "type": "device_alarm_trigger",
                    "panel_id": panel_id,
                    "device_id": global_id,
                    "state": "alarm",
                    "disable": device.get("disable") or "none",
                    "map_id": device.get("map_id"),
                }
            )

    async def _apply_device_reactions(
        self, panel_id: str, device_reactions: dict[int, str]
    ) -> None:
        """Apply Delay/Repeat inferred from 0x55; never overwrite 24h/Fire/Mute."""
        panel = self.panel_bus.panels.get(panel_id)
        if not panel or not device_reactions:
            return
        changed: list[str] = []
        for device_num, incoming in device_reactions.items():
            global_id = make_device_global_id(panel_id, device_num)
            device = panel.devices.get(global_id)
            if not device:
                continue
            if not hid_reaction_overrides(device.get("reaction"), incoming):
                continue
            await self.panel_bus.upsert_device(panel_id, device_num, reaction=incoming)
            changed.append(global_id)
        if changed:
            await self.event_hub.publish(
                {
                    "type": "devices_inventory_updated",
                    "panel_id": panel_id,
                    "device_ids": changed,
                    "reactions_applied": len(changed),
                }
            )

    async def _apply_device_disable(self, panel_id: str, device_disable: dict[int, str]) -> None:
        """Apply F-Link Disable independently of Status (TMP/Loss must not wipe bypass)."""
        panel = self.panel_bus.panels.get(panel_id)
        if not panel:
            return
        batch: dict[str, str] = {}
        for device_num, disable in device_disable.items():
            global_id = make_device_global_id(panel_id, device_num)
            if global_id not in panel.devices:
                continue
            device = panel.devices[global_id]
            current = str(device.get("disable") or "none")
            next_disable = disable if disable in ("none", "input", "device", "tamper") else "none"
            if current == next_disable:
                continue
            device["disable"] = next_disable
            batch[global_id] = next_disable
            if self.panel_bus._persist:
                asyncio.create_task(panel_store.save_device(device))

        if len(batch) == 1:
            global_id, disable = next(iter(batch.items()))
            device = panel.devices.get(global_id) or {}
            await self.event_hub.publish(
                {
                    "type": "device_disable",
                    "panel_id": panel_id,
                    "device_id": global_id,
                    "disable": disable,
                    "state": device.get("state") or "ok",
                }
            )
        elif batch:
            await self.event_hub.publish(
                {
                    "type": "devices_disable_batch",
                    "panel_id": panel_id,
                    "updates": batch,
                }
            )

    def _open_hid_path(self, path_str: str) -> Any:
        if hid is None:
            raise RuntimeError("hidapi unavailable")
        device = hid.device()
        path_arg: bytes | str = path_str
        if isinstance(path_str, str):
            path_arg = path_str.encode("utf-8")
        try:
            device.open_path(path_arg)
        except Exception:
            device.open_path(path_str)
        return device

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
