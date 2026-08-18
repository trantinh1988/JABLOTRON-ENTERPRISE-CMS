"""Luồng vận hành Báo động (24h và phân khu thường).

24h  : không cần bật báo động phân khu → ACT → Báo động → Tắt báo động → lặp lại.
Thường: bật phân khu → ACT → Báo động → Tắt bảo vệ → lặp lại.
"""

import asyncio
from types import SimpleNamespace

from app.iot_core.jablotron_protocol import empty_updates
from app.iot_core.usb_manager import UsbDeviceManager


class _Hub:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def publish(self, event: dict) -> None:
        self.events.append(event)


class _Bus:
    def __init__(self, panel) -> None:
        self.panels = {panel.panel_id: panel}
        self._persist = False

    def set_command_sender(self, sender) -> None:
        pass


def _make_panel(reaction: str, armed: str = "disarmed", state: str = "alarm"):
    zone = {
        "zone_id": "PANEL_1_ZONE_1",
        "section_num": 1,
        "armed_state": armed,
    }
    device = {
        "global_id": "PANEL_1_DEV_01",
        "device_num": 1,
        "device_type": "door",
        "reaction": reaction,
        "state": state,
        "disable": "none",
        "zone_id": "PANEL_1_ZONE_1",
        "map_id": 1,
    }
    return SimpleNamespace(
        panel_id="PANEL_1",
        armed_state=armed,
        zones={zone["zone_id"]: zone},
        devices={device["global_id"]: device},
        pgs={},
    )


def _make_manager(panel, tmp_path, *, sensor_active: bool = False):
    hub = _Hub()
    mgr = UsbDeviceManager(panel_bus=_Bus(panel), event_hub=hub)
    mgr._acked_always_path = lambda: tmp_path / "acked_always.json"
    mgr._bitmap_act_or_ok = lambda session, num: "open" if sensor_active else "ok"
    return mgr, hub


def _trip(mgr, panel):
    """Cảm biến kích hoạt (ACT) — trả về state sau khi promote."""
    updates = empty_updates()
    updates.device_states[1] = "open"
    updates.device_state_force.add(1)
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    return updates.device_states[1]


def test_always_alarm_retriggers_after_silence_with_sensor_closed(tmp_path):
    """Tắt báo động khi cảm biến đã về OK → lần kích sau phải Báo động lại ngay."""
    panel = _make_panel("24h")
    mgr, hub = _make_manager(panel, tmp_path, sensor_active=False)

    asyncio.run(mgr.ack_always_alarms("PANEL_1", device_nums=[1], code=""))

    assert panel.devices["PANEL_1_DEV_01"]["state"] == "ok"
    assert mgr._acked_always("PANEL_1") == set()
    assert any(e.get("clear_alarm") for e in hub.events)
    assert _trip(mgr, panel) == "alarm"


def test_always_alarm_ack_holds_only_the_current_activation(tmp_path):
    """Cảm biến còn ACT lúc tắt → không báo lại; đóng lại rồi kích thì báo."""
    panel = _make_panel("24h")
    mgr, _ = _make_manager(panel, tmp_path, sensor_active=True)

    asyncio.run(mgr.ack_always_alarms("PANEL_1", device_nums=[1], code=""))

    assert panel.devices["PANEL_1_DEV_01"]["state"] == "open"
    assert mgr._acked_always("PANEL_1") == {1}
    assert _trip(mgr, panel) == "open"

    # Cửa đóng → OK → bỏ ack.
    asyncio.run(
        mgr._apply_device_states("PANEL_1", {1: "ok"}, force_nums={1}, clear_alarm=True)
    )
    assert mgr._acked_always("PANEL_1") == set()
    assert _trip(mgr, panel) == "alarm"


def test_disarm_clears_always_alarm_without_blocking_next_trip(tmp_path):
    """Tắt bảo vệ (bàn phím vật lý) cũng phải cho phép 24h báo lại lần sau."""
    panel = _make_panel("24h")
    mgr, _ = _make_manager(panel, tmp_path, sensor_active=False)

    asyncio.run(mgr._clear_alarms_on_disarm("PANEL_1", whole_panel=True))

    assert panel.devices["PANEL_1_DEV_01"]["state"] == "ok"
    assert mgr._acked_always("PANEL_1") == set()
    assert _trip(mgr, panel) == "alarm"


def test_instant_needs_armed_section(tmp_path):
    """Phân khu tắt: Instant chỉ ACT. Bật phân khu: ACT → Báo động."""
    panel = _make_panel("instant", state="ok")
    mgr, _ = _make_manager(panel, tmp_path)

    updates = empty_updates()
    updates.device_states[1] = "open"
    updates.device_state_force.add(1)
    updates.device_alarm_events.add(1)
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states[1] == "open"

    panel.zones["PANEL_1_ZONE_1"]["armed_state"] = "armed"
    updates = empty_updates()
    updates.device_states[1] = "open"
    updates.device_state_force.add(1)
    updates.device_alarm_events.add(1)
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states[1] == "alarm"


def test_alarm_trigger_event_carries_map_id(tmp_path):
    """device_alarm_trigger phải mang map_id để Focus Map + Automation chạy."""
    panel = _make_panel("24h", state="ok")
    mgr, hub = _make_manager(panel, tmp_path)

    asyncio.run(
        mgr._apply_device_states("PANEL_1", {1: "alarm"}, force_nums={1}, clear_alarm=False)
    )

    triggers = [e for e in hub.events if e["type"] == "device_alarm_trigger"]
    assert len(triggers) == 1
    assert triggers[0]["device_id"] == "PANEL_1_DEV_01"
    assert triggers[0]["map_id"] == 1
