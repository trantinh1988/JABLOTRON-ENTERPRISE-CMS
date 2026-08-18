from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from app.core.config import get_settings
from app.iot_core.device_id import make_device_global_id, make_panel_id
from app.iot_core.device_reaction import (
    DEFAULT_DEVICE_REACTION,
    normalize_reaction,
    reaction_alarms_when_disarmed,
)
from app.iot_core.event_hub import EventHub, get_event_hub
from app.iot_core import panel_store

ActionName = Literal["arm", "disarm", "partial"]


@dataclass
class PanelState:
    panel_id: str
    display_name: str
    connection: str = "disconnected"  # usb|mock|disconnected
    usb_path: str | None = None
    armed_state: str = "disarmed"
    stream_code: str = ""  # admin/service PIN for device-state HID stream
    last_seen_at: str | None = None
    devices: dict[str, dict[str, Any]] = field(default_factory=dict)
    zones: dict[str, dict[str, Any]] = field(default_factory=dict)
    users: dict[str, dict[str, Any]] = field(default_factory=dict)
    pgs: dict[str, dict[str, Any]] = field(default_factory=dict)


class PanelBus:
    """Command queue + in-memory panel/device state for multi-panel control."""

    def __init__(self, event_hub: EventHub | None = None) -> None:
        self.event_hub = event_hub or get_event_hub()
        self.panels: dict[str, PanelState] = {}
        self._queues: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._workers: dict[str, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()
        self._command_sender: Any = None  # set by UsbDeviceManager
        self._persist = True

    def _ensure_worker(self, panel_id: str) -> None:
        if panel_id not in self._queues:
            self._queues[panel_id] = asyncio.Queue()
        if panel_id not in self._workers or self._workers[panel_id].done():
            self._workers[panel_id] = asyncio.create_task(self._worker(panel_id))

    async def _persist_panel(self, panel: PanelState) -> None:
        if self._persist:
            await panel_store.save_panel(panel)

    def set_command_sender(self, sender: Any) -> None:
        self._command_sender = sender

    @staticmethod
    def default_connection() -> str:
        return "mock" if get_settings().usb_mock_mode else "disconnected"

    async def ensure_panel(
        self,
        panel_id: str,
        *,
        display_name: str | None = None,
        connection: str | None = None,
        usb_path: str | None = None,
        update_usb_path: bool = False,
    ) -> PanelState:
        async with self._lock:
            panel = self.panels.get(panel_id)
            if panel is None:
                panel = PanelState(
                    panel_id=panel_id,
                    display_name=display_name or panel_id,
                    connection=connection if connection is not None else self.default_connection(),
                    usb_path=usb_path,
                    last_seen_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                )
                self.panels[panel_id] = panel
                self._ensure_worker(panel_id)
            else:
                if connection is not None:
                    panel.connection = connection
                if update_usb_path or usb_path is not None:
                    panel.usb_path = usb_path
                if display_name:
                    panel.display_name = display_name
                panel.last_seen_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            await self._persist_panel(panel)
            return panel

    async def upsert_device(
        self,
        panel_id: str,
        device_num: int,
        *,
        state: str | None = None,
        disable: str | None = None,
        device_type: str | None = None,
        label: str | None = None,
        model: str | None = None,
        zone_id: str | None = None,
        update_zone: bool = False,
        clear_zone: bool = False,
        map_id: int | None = None,
        map_x: float | None = None,
        map_y: float | None = None,
        update_map: bool = False,
        clear_map: bool = False,
        map_icon: str | None = None,
        map_icon_size: float | None = None,
        link: str | None = None,
        reaction: str | None = None,
    ) -> dict[str, Any]:
        await self.ensure_panel(panel_id)
        global_id = make_device_global_id(panel_id, device_num)
        existing = self.panels[panel_id].devices.get(global_id, {})
        if zone_id and zone_id not in self.panels[panel_id].zones:
            raise ValueError(f"Không tìm thấy vùng: {zone_id}")
        next_disable = disable if disable is not None else existing.get("disable") or "none"
        if next_disable not in ("none", "input", "device", "tamper"):
            next_disable = "none"
        next_icon = (
            map_icon
            if map_icon is not None
            else (existing.get("map_icon") or "")
        )
        next_size = (
            float(map_icon_size)
            if map_icon_size is not None
            else float(existing.get("map_icon_size") or 2.0)
        )
        next_size = max(0.5, min(5.0, next_size))
        next_link = link if link is not None else existing.get("link") or ""
        if next_link not in ("bus", "rf"):
            next_link = ""
        next_reaction = (
            normalize_reaction(reaction)
            if reaction is not None
            else normalize_reaction(existing.get("reaction") or DEFAULT_DEVICE_REACTION)
        )
        next_state = state if state is not None else existing.get("state") or "ok"
        # Chỉ promote khi user/HID đổi Reaction — không ghi đè «Tắt báo động 24h».
        if (
            reaction is not None
            and reaction_alarms_when_disarmed(next_reaction)
            and next_state == "open"
        ):
            next_state = "alarm"
        device = {
            "global_id": global_id,
            "panel_id": panel_id,
            "device_id": f"DEV_{device_num:02d}",
            "device_num": device_num,
            "device_type": device_type or existing.get("device_type") or "sensor",
            "label": label if label is not None else existing.get("label") or global_id,
            "model": model if model is not None else existing.get("model") or "",
            "link": next_link,
            "state": next_state,
            "disable": next_disable,
            "reaction": next_reaction,
            "zone_id": existing.get("zone_id"),
            "map_id": existing.get("map_id"),
            "map_x": existing.get("map_x"),
            "map_y": existing.get("map_y"),
            "map_icon": str(next_icon or ""),
            "map_icon_size": next_size,
        }
        if clear_zone:
            device["zone_id"] = None
        elif update_zone:
            device["zone_id"] = zone_id
        elif zone_id is not None:
            device["zone_id"] = zone_id
        if clear_map:
            device["map_id"] = None
            device["map_x"] = None
            device["map_y"] = None
        elif update_map:
            # Chỉ ghi field được gửi — tránh update map_x/map_y làm mất map_id (None).
            if map_id is not None:
                device["map_id"] = map_id
            if map_x is not None:
                device["map_x"] = map_x
            if map_y is not None:
                device["map_y"] = map_y
        else:
            if map_id is not None:
                device["map_id"] = map_id
            if map_x is not None:
                device["map_x"] = map_x
            if map_y is not None:
                device["map_y"] = map_y
        self.panels[panel_id].devices[global_id] = device
        if self._persist:
            await panel_store.save_device(device)
        return device

    def get_device(self, global_id: str) -> dict[str, Any] | None:
        for panel in self.panels.values():
            if global_id in panel.devices:
                return panel.devices[global_id]
        return None

    async def update_device(self, global_id: str, **fields: Any) -> dict[str, Any] | None:
        device = self.get_device(global_id)
        if not device:
            return None
        panel_id = device["panel_id"]
        device_num = int(device["device_num"])
        prev_state = str(device.get("state") or "ok")
        updated = await self.upsert_device(
            panel_id,
            device_num,
            device_type=fields.get("device_type"),
            label=fields.get("label"),
            model=fields.get("model"),
            link=fields.get("link"),
            disable=fields.get("disable"),
            zone_id=fields.get("zone_id"),
            update_zone=bool(fields.get("update_zone")),
            clear_zone=bool(fields.get("clear_zone")),
            map_id=fields.get("map_id"),
            map_x=fields.get("map_x"),
            map_y=fields.get("map_y"),
            update_map=bool(fields.get("update_map")),
            clear_map=bool(fields.get("clear_map")),
            map_icon=fields.get("map_icon"),
            map_icon_size=fields.get("map_icon_size"),
            reaction=fields.get("reaction"),
        )
        if updated and str(updated.get("state") or "") == "alarm" and prev_state != "alarm":
            await self.event_hub.publish(
                {
                    "type": "device_state",
                    "panel_id": panel_id,
                    "device_id": global_id,
                    "state": "alarm",
                    "disable": updated.get("disable") or "none",
                }
            )
            await self.event_hub.publish(
                {
                    "type": "device_alarm_trigger",
                    "panel_id": panel_id,
                    "device_id": global_id,
                    "state": "alarm",
                    "disable": updated.get("disable") or "none",
                    "map_id": updated.get("map_id"),
                }
            )
        return updated

    async def delete_device(self, global_id: str) -> bool:
        async with self._lock:
            for panel in self.panels.values():
                if global_id in panel.devices:
                    del panel.devices[global_id]
                    if self._persist:
                        await panel_store.delete_device_record(global_id)
                    return True
        return False

    async def delete_devices(self, global_ids: list[str]) -> list[str]:
        """Xóa nhiều thiết bị; trả về danh sách ID đã xóa."""
        deleted: list[str] = []
        for gid in global_ids:
            if await self.delete_device(gid):
                deleted.append(gid)
        return deleted

    async def delete_panel(self, panel_id: str) -> bool:
        """Xóa tủ và toàn bộ cấu hình thuộc tủ; hủy worker queue."""
        async with self._lock:
            panel = self.panels.pop(panel_id, None)
            if panel is None:
                return False
            worker = self._workers.pop(panel_id, None)
            self._queues.pop(panel_id, None)
            if worker is not None and not worker.done():
                worker.cancel()
            if self._persist:
                await panel_store.delete_panel_record(panel_id)
            return True

    def _next_zone_id(self, panel_id: str) -> str:
        panel = self.panels[panel_id]
        used = set()
        for zid in panel.zones:
            if zid.startswith(f"{panel_id}_ZONE_"):
                try:
                    used.add(int(zid.rsplit("_", 1)[-1]))
                except ValueError:
                    pass
        n = 1
        while n in used:
            n += 1
        return f"{panel_id}_ZONE_{n}"

    def _next_user_id(self, panel_id: str) -> str:
        panel = self.panels[panel_id]
        used = set()
        for uid in panel.users:
            if uid.startswith(f"{panel_id}_USER_"):
                try:
                    used.add(int(uid.rsplit("_", 1)[-1]))
                except ValueError:
                    pass
        n = 1
        while n in used:
            n += 1
        return f"{panel_id}_USER_{n}"

    def _next_pg_id(self, panel_id: str) -> str:
        panel = self.panels[panel_id]
        used = set()
        for pid in panel.pgs:
            if pid.startswith(f"{panel_id}_PG_"):
                try:
                    used.add(int(pid.rsplit("_", 1)[-1]))
                except ValueError:
                    pass
        n = 1
        while n in used:
            n += 1
        return f"{panel_id}_PG_{n}"

    def list_zones(self, panel_id: str) -> list[dict[str, Any]]:
        panel = self.panels.get(panel_id)
        if not panel:
            return []
        return sorted(panel.zones.values(), key=lambda z: z["zone_id"])

    async def create_zone(
        self,
        panel_id: str,
        *,
        name: str,
        section_num: int,
    ) -> dict[str, Any]:
        await self.ensure_panel(panel_id)
        panel = self.panels[panel_id]
        for z in panel.zones.values():
            if z["section_num"] == section_num:
                raise ValueError(f"Section {section_num} đã tồn tại")
        zone_id = self._next_zone_id(panel_id)
        zone = {
            "zone_id": zone_id,
            "panel_id": panel_id,
            "name": name.strip() or f"Vùng {section_num}",
            "section_num": section_num,
            "armed_state": "disarmed",
            "keypad_alarm": False,
        }
        panel.zones[zone_id] = zone
        if self._persist:
            await panel_store.save_zone(zone)
        return zone

    async def update_zone(self, panel_id: str, zone_id: str, **fields: Any) -> dict[str, Any] | None:
        panel = self.panels.get(panel_id)
        if not panel or zone_id not in panel.zones:
            return None
        zone = panel.zones[zone_id]
        prev_armed = zone.get("armed_state")
        if "name" in fields and fields["name"] is not None:
            zone["name"] = fields["name"].strip() or zone["name"]
        if "section_num" in fields and fields["section_num"] is not None:
            for z in panel.zones.values():
                if z["zone_id"] != zone_id and z["section_num"] == fields["section_num"]:
                    raise ValueError(f"Section {fields['section_num']} đã tồn tại")
            zone["section_num"] = fields["section_num"]
        if "armed_state" in fields and fields["armed_state"] is not None:
            zone["armed_state"] = fields["armed_state"]
        if self._persist:
            await panel_store.save_zone(zone)
        if (
            "armed_state" in fields
            and fields["armed_state"] is not None
            and zone.get("armed_state") != prev_armed
        ):
            await self.event_hub.publish(
                {
                    "type": "zone_armed",
                    "panel_id": panel_id,
                    "zone_id": zone_id,
                    "section_num": zone.get("section_num"),
                    "armed_state": zone["armed_state"],
                    "keypad_alarm": bool(zone.get("keypad_alarm")),
                    "detail": fields.get("detail"),
                }
            )
            await self._sync_panel_armed_from_zones(panel_id)
        return zone

    async def _sync_panel_armed_from_zones(self, panel_id: str) -> None:
        panel = self.panels.get(panel_id)
        if not panel or not panel.zones:
            return
        states = [z.get("armed_state") or "disarmed" for z in panel.zones.values()]
        if all(s == "armed" for s in states):
            armed = "armed"
        elif all(s == "disarmed" for s in states):
            armed = "disarmed"
        else:
            armed = "partial"
        if panel.armed_state == armed:
            return
        panel.armed_state = armed
        if self._persist:
            await panel_store.save_panel(panel)
        await self.event_hub.publish(
            {
                "type": "panel_armed",
                "panel_id": panel_id,
                "armed_state": armed,
                "derived": True,
            }
        )

    async def delete_zone(self, panel_id: str, zone_id: str) -> bool:
        panel = self.panels.get(panel_id)
        if not panel or zone_id not in panel.zones:
            return False
        del panel.zones[zone_id]
        for device in panel.devices.values():
            if device.get("zone_id") == zone_id:
                device["zone_id"] = None
                if self._persist:
                    await panel_store.save_device(device)
        for pg in panel.pgs.values():
            if pg.get("zone_id") == zone_id:
                pg["zone_id"] = None
                if self._persist:
                    await panel_store.save_pg(pg)
        if self._persist:
            await panel_store.delete_zone_record(zone_id)
        return True

    def list_users(self, panel_id: str) -> list[dict[str, Any]]:
        panel = self.panels.get(panel_id)
        if not panel:
            return []
        return sorted(panel.users.values(), key=lambda u: u["user_id"])

    async def create_user(
        self,
        panel_id: str,
        *,
        name: str,
        code_label: str = "",
        permissions: list[str] | None = None,
    ) -> dict[str, Any]:
        await self.ensure_panel(panel_id)
        panel = self.panels[panel_id]
        user_id = self._next_user_id(panel_id)
        user = {
            "user_id": user_id,
            "panel_id": panel_id,
            "name": name.strip() or user_id,
            "code_label": code_label.strip(),
            "permissions": permissions or [],
        }
        panel.users[user_id] = user
        if self._persist:
            await panel_store.save_user(user)
        return user

    async def update_user(self, panel_id: str, user_id: str, **fields: Any) -> dict[str, Any] | None:
        panel = self.panels.get(panel_id)
        if not panel or user_id not in panel.users:
            return None
        user = panel.users[user_id]
        if "name" in fields and fields["name"] is not None:
            user["name"] = fields["name"].strip() or user["name"]
        if "code_label" in fields and fields["code_label"] is not None:
            user["code_label"] = fields["code_label"].strip()
        if "permissions" in fields and fields["permissions"] is not None:
            user["permissions"] = fields["permissions"]
        if self._persist:
            await panel_store.save_user(user)
        return user

    async def delete_user(self, panel_id: str, user_id: str) -> bool:
        panel = self.panels.get(panel_id)
        if not panel or user_id not in panel.users:
            return False
        del panel.users[user_id]
        if self._persist:
            await panel_store.delete_user_record(user_id)
        return True

    def list_pgs(self, panel_id: str) -> list[dict[str, Any]]:
        panel = self.panels.get(panel_id)
        if not panel:
            return []
        return sorted(panel.pgs.values(), key=lambda p: p["pg_num"])

    async def create_pg(
        self,
        panel_id: str,
        *,
        pg_num: int,
        label: str = "",
        zone_id: str | None = None,
        mode: str = "pulse",
    ) -> dict[str, Any]:
        await self.ensure_panel(panel_id)
        panel = self.panels[panel_id]
        for pg in panel.pgs.values():
            if pg["pg_num"] == pg_num:
                raise ValueError(f"PG {pg_num} đã tồn tại")
        if zone_id and zone_id not in panel.zones:
            raise ValueError(f"Không tìm thấy vùng: {zone_id}")
        pg_id = self._next_pg_id(panel_id)
        pg = {
            "pg_id": pg_id,
            "panel_id": panel_id,
            "pg_num": pg_num,
            "label": label.strip() or f"PG {pg_num}",
            "zone_id": zone_id,
            "mode": mode,
            "state": "off",
        }
        panel.pgs[pg_id] = pg
        if self._persist:
            await panel_store.save_pg(pg)
        return pg

    async def update_pg(self, panel_id: str, pg_id: str, **fields: Any) -> dict[str, Any] | None:
        panel = self.panels.get(panel_id)
        if not panel or pg_id not in panel.pgs:
            return None
        pg = panel.pgs[pg_id]
        if "label" in fields and fields["label"] is not None:
            pg["label"] = fields["label"].strip() or pg["label"]
        if "pg_num" in fields and fields["pg_num"] is not None:
            for other in panel.pgs.values():
                if other["pg_id"] != pg_id and other["pg_num"] == fields["pg_num"]:
                    raise ValueError(f"PG {fields['pg_num']} đã tồn tại")
            pg["pg_num"] = fields["pg_num"]
        if "zone_id" in fields:
            zid = fields["zone_id"]
            if zid and zid not in panel.zones:
                raise ValueError(f"Không tìm thấy vùng: {zid}")
            pg["zone_id"] = zid
        if "mode" in fields and fields["mode"] is not None:
            pg["mode"] = fields["mode"]
        if "state" in fields and fields["state"] is not None:
            pg["state"] = fields["state"]
            if self._persist:
                await panel_store.save_pg(pg)
            await self.event_hub.publish(
                {
                    "type": "pg_state",
                    "panel_id": panel_id,
                    "pg_id": pg_id,
                    "state": pg["state"],
                }
            )
            return pg
        if self._persist:
            await panel_store.save_pg(pg)
        return pg

    async def delete_pg(self, panel_id: str, pg_id: str) -> bool:
        panel = self.panels.get(panel_id)
        if not panel or pg_id not in panel.pgs:
            return False
        del panel.pgs[pg_id]
        if self._persist:
            await panel_store.delete_pg_record(pg_id)
        return True

    def list_all_devices(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for panel in self.panels.values():
            out.extend(panel.devices.values())
        return sorted(out, key=lambda d: d["global_id"])

    def devices_on_map(self, map_id: int) -> list[dict[str, Any]]:
        return [d for d in self.list_all_devices() if d.get("map_id") == map_id]

    async def clear_map_placements(self, map_id: int) -> int:
        cleared = 0
        for device in self.list_all_devices():
            if device.get("map_id") == map_id:
                await self.upsert_device(
                    device["panel_id"],
                    int(device["device_num"]),
                    clear_map=True,
                )
                cleared += 1
        return cleared

    async def set_device_state(self, panel_id: str, device_num: int, state: str) -> dict[str, Any]:
        global_id = make_device_global_id(panel_id, device_num)
        panel = self.panels.get(panel_id)
        if panel is not None and global_id in panel.devices:
            device = panel.devices[global_id]
            prev = device.get("state")
            if prev == state:
                return device
            device["state"] = state
            await self.event_hub.publish(
                {
                    "type": "device_state",
                    "panel_id": panel_id,
                    "device_id": global_id,
                    "state": state,
                    "disable": device.get("disable") or "none",
                }
            )
            if state == "alarm" and prev != "alarm":
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
            if self._persist:
                asyncio.create_task(panel_store.save_device(device))
            return device

        device = await self.upsert_device(panel_id, device_num, state=state)
        await self.event_hub.publish(
            {
                "type": "device_state",
                "panel_id": panel_id,
                "device_id": device["global_id"],
                "state": state,
                "disable": device.get("disable") or "none",
            }
        )
        if state == "alarm":
            await self.event_hub.publish(
                {
                    "type": "device_alarm_trigger",
                    "panel_id": panel_id,
                    "device_id": device["global_id"],
                    "state": "alarm",
                    "disable": device.get("disable") or "none",
                    "map_id": device.get("map_id"),
                }
            )
        return device

    async def set_device_disable(self, panel_id: str, device_num: int, disable: str) -> dict[str, Any] | None:
        """Update F-Link Disable bypass without touching runtime ``state``."""
        if disable not in ("none", "input", "device", "tamper"):
            disable = "none"
        global_id = make_device_global_id(panel_id, device_num)
        panel = self.panels.get(panel_id)
        if panel is None or global_id not in panel.devices:
            return None
        device = panel.devices[global_id]
        if (device.get("disable") or "none") == disable:
            return device
        device["disable"] = disable
        if self._persist:
            asyncio.create_task(panel_store.save_device(device))
        await self.event_hub.publish(
            {
                "type": "device_disable",
                "panel_id": panel_id,
                "device_id": global_id,
                "disable": disable,
                "state": device.get("state") or "ok",
            }
        )
        return device

    async def group_action(
        self,
        panel_ids: list[str],
        action: ActionName,
        *,
        detail: str | None = None,
        code: str | None = None,
        section_num: int | None = None,
    ) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        for panel_id in panel_ids:
            if panel_id not in self.panels:
                results.append({"panel_id": panel_id, "ok": False, "error": "panel_not_found"})
                continue
            done: asyncio.Future[tuple[bool, str]] = asyncio.get_running_loop().create_future()
            await self._queues[panel_id].put(
                {
                    "action": action,
                    "detail": detail,
                    "code": code,
                    "section_num": section_num,
                    "done": done,
                }
            )
            try:
                ok, err = await asyncio.wait_for(done, timeout=12.0)
            except asyncio.TimeoutError:
                ok, err = False, "command_timeout"
            if ok:
                results.append({"panel_id": panel_id, "ok": True, "action": action})
            else:
                results.append({"panel_id": panel_id, "ok": False, "error": err, "action": action})
        return {"action": action, "results": results}

    async def _worker(self, panel_id: str) -> None:
        queue = self._queues[panel_id]
        while True:
            cmd = await queue.get()
            done: asyncio.Future[tuple[bool, str]] | None = cmd.get("done")
            try:
                action: ActionName = cmd["action"]
                operator_detail = cmd.get("detail")
                code = cmd.get("code")
                section_num = cmd.get("section_num")
                ok = True
                detail = "mock_ok"
                if self._command_sender is not None:
                    ok, detail = await self._command_sender.send_action(
                        panel_id,
                        action,
                        code=code,
                        section_num=section_num,
                    )
                if ok:
                    event_detail = operator_detail or detail
                    armed = {"arm": "armed", "disarm": "disarmed", "partial": "partial"}[action]
                    panel = self.panels[panel_id]
                    if section_num is not None and panel.zones:
                        for zone in panel.zones.values():
                            if int(zone.get("section_num") or 0) != int(section_num):
                                continue
                            if zone.get("armed_state") == armed:
                                continue
                            zone["armed_state"] = armed
                            if self._persist:
                                await panel_store.save_zone(zone)
                            await self.event_hub.publish(
                                {
                                    "type": "zone_armed",
                                    "panel_id": panel_id,
                                    "zone_id": zone["zone_id"],
                                    "section_num": zone.get("section_num"),
                                    "armed_state": armed,
                                    "keypad_alarm": bool(zone.get("keypad_alarm")),
                                    "detail": event_detail,
                                }
                            )
                        await self._sync_panel_armed_from_zones(panel_id)
                    else:
                        panel.armed_state = armed
                        if self._persist:
                            await panel_store.save_panel(panel)
                        await self.event_hub.publish(
                            {
                                "type": "panel_armed",
                                "panel_id": panel_id,
                                "armed_state": armed,
                                "detail": event_detail,
                                "history": not bool(panel.zones),
                            }
                        )
                        if action in ("arm", "disarm") and panel.zones:
                            for zone in panel.zones.values():
                                if zone.get("armed_state") == armed:
                                    continue
                                zone["armed_state"] = armed
                                if self._persist:
                                    await panel_store.save_zone(zone)
                                await self.event_hub.publish(
                                    {
                                        "type": "zone_armed",
                                        "panel_id": panel_id,
                                        "zone_id": zone["zone_id"],
                                        "section_num": zone.get("section_num"),
                                        "armed_state": armed,
                                        "keypad_alarm": bool(zone.get("keypad_alarm")),
                                        "detail": event_detail,
                                    }
                                )
                else:
                    await self.event_hub.publish(
                        {
                            "type": "command_error",
                            "panel_id": panel_id,
                            "action": action,
                            "detail": detail,
                        }
                    )
                if done is not None and not done.done():
                    done.set_result((ok, detail))
            except Exception as exc:  # noqa: BLE001
                if done is not None and not done.done():
                    done.set_result((False, str(exc)))
            finally:
                queue.task_done()

    def list_panels(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for panel in self.panels.values():
            out.append(
                {
                    "panel_id": panel.panel_id,
                    "display_name": panel.display_name,
                    "connection": panel.connection,
                    "usb_path": panel.usb_path,
                    "armed_state": panel.armed_state,
                    "last_seen_at": panel.last_seen_at,
                    "device_count": len(panel.devices),
                }
            )
        return sorted(out, key=lambda p: p["panel_id"])

    def list_devices(self, panel_id: str) -> list[dict[str, Any]]:
        panel = self.panels.get(panel_id)
        if not panel:
            return []
        return sorted(panel.devices.values(), key=lambda d: d["global_id"])

    async def seed_mock_panels(self, count: int = 2, devices_per_panel: int = 6) -> None:
        for i in range(1, count + 1):
            panel_id = make_panel_id(i)
            await self.ensure_panel(panel_id, display_name=f"Tủ Jablotron {i}", connection="mock")
            for d in range(1, devices_per_panel + 1):
                await self.upsert_device(
                    panel_id,
                    d,
                    state="ok",
                    label=f"Cảm biến {d}",
                    map_id=1 if i == 1 else None,
                    map_x=10.0 * d,
                    map_y=20.0 * i,
                    update_map=True,
                )


_panel_bus: PanelBus | None = None


def get_panel_bus() -> PanelBus:
    global _panel_bus
    if _panel_bus is None:
        _panel_bus = PanelBus()
    return _panel_bus
