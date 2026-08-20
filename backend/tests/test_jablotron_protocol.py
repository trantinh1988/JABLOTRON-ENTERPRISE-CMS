"""Protocol decode tests aligned with kukulich/jablotron100 little-endian packing."""

from app.iot_core.jablotron_protocol import (
    DeviceStateEvent,
    _bytes_to_binary,
    _bytes_to_reverse_binary,
    _parse_device_number,
    bytes_to_int,
    parse_packet,
)


def test_bytes_to_int_little_endian():
    assert bytes_to_int(b"\x04\x00") == 4
    assert bytes_to_int(b"\x00\x01") == 256
    assert bytes_to_int(b"\x40\x03") == 0x0340


def test_bytes_to_binary_matches_ha():
    assert _bytes_to_binary(b"\x40\x00") == "0000000001000000"
    assert _bytes_to_reverse_binary(b"\x01\x00") == "1000000000000000"


def test_parse_device_number_device_1():
    # LE 0x0040 → binary ...01000000 → bits[2:10] = device 1
    packet = bytes([0x55, 0x0A, 0x04, 0x6C, 0x40, 0x00])
    assert _parse_device_number(packet) == 1


def test_parse_device_number_device_9():
    packet = bytes([0x55, 0x0A, DeviceStateEvent.SABOTAGE, 0x8C, 0x40, 0x02])
    assert _parse_device_number(packet) == 9


def test_parse_device_number_old_msb_concat_was_wrong():
    packet = bytes([0x55, 0x0A, 0x04, 0x6C, 0x40, 0x00])
    msb_concat = "".join(f"{b:08b}" for b in packet[4:6])
    wrong = int(msb_concat[2:10], 2)
    assert wrong != 1
    assert _parse_device_number(packet) == 1


def test_parse_devices_states_activity_bits_1_to_8():
    # length=3, skip first payload byte, LE 0x01FE → devices 1..8 open
    packet = bytes([0xD8, 0x03, 0x00, 0xFE, 0x01])
    parsed = parse_packet(packet)
    for n in range(1, 9):
        assert parsed.device_states.get(n) == "open", n
    assert parsed.device_states.get(9) == "ok"


def test_parse_device_state_sabotage_tamper():
    # device 9 SABOTAGE + ON state byte 0x8C (9*4+104)
    packet = bytes([0x55, 0x0A, DeviceStateEvent.SABOTAGE, 0x8C, 0x40, 0x02])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(9) == "tamper"
    assert 9 in parsed.device_state_force


def test_parse_device_state_activity_open():
    packet = bytes([0x55, 0x0A, DeviceStateEvent.ACTIVITY, 0x6C, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(1) == "open"


def test_parse_device_state_ignores_unknown_state_byte():
    # ACTIVITY but state byte not in ON/OFF encoding → ignore (do not invent "open")
    packet = bytes([0x55, 0x0A, DeviceStateEvent.ACTIVITY, 0x00, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states == {}


def test_parse_device_state_ignores_heartbeat():
    packet = bytes([0x55, 0x0A, DeviceStateEvent.HEARTBEAT, 0x6C, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states == {}


def test_parse_device_state_instant_alarm_is_act():
    # Instant zone ON → F-Link ACT (open), not sticky "alarm"; tagged for promote.
    on = (1 * 4) + 104
    packet = bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(1) == "open"
    assert 1 in parsed.device_alarm_events
    assert 1 in parsed.device_state_force


def test_parse_device_state_instant_alarm_clears_on_off():
    # device 1 Instant OFF → ok (no alarm-event tag)
    off = (1 * 4) + 104 + 2
    packet = bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, off, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(1) == "ok"
    assert 1 not in parsed.device_alarm_events


def test_parse_device_state_activity_not_alarm_event():
    # ACTIVITY ON → ACT only; must not promote to sticky alarm while armed.
    packet = bytes([0x55, 0x0A, DeviceStateEvent.ACTIVITY, 0x6C, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(1) == "open"
    assert 1 in parsed.device_state_force
    assert 1 not in parsed.device_alarm_events


def test_flink_priority_tamper_beats_alarm():
    from app.iot_core.jablotron_protocol import should_replace_device_state

    assert should_replace_device_state("alarm", "tamper", forced=True) is True
    assert should_replace_device_state("tamper", "alarm", forced=True) is False
    assert should_replace_device_state("tamper", "ok", forced=True) is True
    assert should_replace_device_state("tamper", "open", forced=False) is False
    # Sticky Báo động: ACT / Instant OFF must not clear alarm (24h giữ đến Tắt báo động)
    assert should_replace_device_state("alarm", "open", forced=False) is False
    assert should_replace_device_state("alarm", "open", forced=True) is False
    assert should_replace_device_state("alarm", "ok", forced=True) is False
    # One-shot Error (0x05) must not turn Báo động → Lỗi
    assert should_replace_device_state("alarm", "fault", forced=True) is False
    # Chỉ Tắt báo động / Tắt bảo vệ (clear_alarm) mới gỡ
    assert should_replace_device_state("alarm", "ok", forced=True, clear_alarm=True) is True
    # After Tắt bảo vệ (section disarmed): Instant OFF / 0xd8 OK must clear sticky
    assert should_replace_device_state("alarm", "ok", forced=False, clear_alarm=True) is True
    assert should_replace_device_state("alarm", "open", forced=True, clear_alarm=True) is True
    # F-Link Loss must replace sticky TMP
    assert should_replace_device_state("tamper", "loss", forced=True) is True
    assert should_replace_device_state("loss", "tamper", forced=True) is False
    # Stale Error yields to live ACT/OK (F-Link Device 1 = ACT, not Lỗi)
    assert should_replace_device_state("fault", "open", forced=True) is True
    assert should_replace_device_state("fault", "open", forced=False) is True
    assert should_replace_device_state("fault", "ok", forced=False) is True
    assert should_replace_device_state("fault", "alarm", forced=True) is True
    # TMP / Loss still outrank ACT
    assert should_replace_device_state("tamper", "open", forced=True) is False
    assert should_replace_device_state("loss", "open", forced=True) is False


def test_parse_device_state_fault_is_loss():
    # device 9 FAULT ON → loss (F-Link Loss)
    on = (9 * 4) + 104
    packet = bytes([0x55, 0x0A, DeviceStateEvent.FAULT, on, 0x40, 0x02])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(9) == "loss"


def test_flags_to_disable_mapping():
    from app.iot_core.jablotron_protocol import flags_to_disable

    # 0x55 flags intentionally ignored for F-Link Disable (0x8a only)
    assert flags_to_disable(0) is None
    assert flags_to_disable(0x20) is None
    assert flags_to_disable(0xE0) is None


def test_parse_device_disable_input_flag():
    # 0x55 flags no longer drive Disable (0x8a only)
    event = DeviceStateEvent.ACTIVITY | 0x20
    packet = bytes([0x55, 0x0A, event, 0x6C, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(1) == "open"
    assert parsed.device_disable == {}


def test_parse_device_disable_device_combo():
    event = DeviceStateEvent.ACTIVITY | 0x60
    packet = bytes([0x55, 0x0A, event, 0x6C, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_disable == {}


def test_parse_device_disable_tamper_flag():
    event = DeviceStateEvent.SABOTAGE | 0x40
    on = (9 * 4) + 104
    packet = bytes([0x55, 0x0A, event, on, 0x40, 0x02])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(9) == "tamper"
    assert parsed.device_disable == {}


def test_heartbeat_with_disable_keeps_bypass_without_state():
    event = DeviceStateEvent.HEARTBEAT | 0x20
    packet = bytes([0x55, 0x0A, event, 0x6C, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states == {}
    assert parsed.device_disable == {}


def test_heartbeat_without_flags_does_not_clear_disable():
    packet = bytes([0x55, 0x0A, DeviceStateEvent.HEARTBEAT, 0x6C, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_disable == {}


def test_activity_clears_disable_when_flags_zero():
    packet = bytes([0x55, 0x0A, DeviceStateEvent.ACTIVITY, 0x6C, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(1) == "open"
    assert parsed.device_disable == {}


def test_parse_device_status_8a_flag11_is_disable_tamper_status_ok():
    # Live: F-Link Disable=Tamper + cover open — type 0x04 + flag 0x11
    # Force Status OK so Instant ACT from open cover cannot stick.
    packet = bytes.fromhex("52078a0904110000f2")
    parsed = parse_packet(packet)
    assert parsed.device_states.get(9) == "ok"
    assert 9 in parsed.device_state_force
    assert 9 not in parsed.device_tmp_clear
    assert parsed.device_disable.get(9) == "tamper"
    from app.iot_core.jablotron_protocol import flink_status_from_state_disable

    assert flink_status_from_state_disable("tamper", "tamper") == "ok"
    assert flink_status_from_state_disable("open", "tamper", cover_open_tmp=True) == "ok"
    assert flink_status_from_state_disable("open", "tamper", cover_open_tmp=False) == "open"


def test_parse_device_status_8a_flag10_type04_is_disable_tamper():
    # Cover closed + Disable Tamper — Instant ACT is real.
    packet = bytes.fromhex("52078a0904100000f2")
    parsed = parse_packet(packet)
    assert parsed.device_states == {}
    assert 9 in parsed.device_tmp_clear
    assert parsed.device_disable.get(9) == "tamper"
    from app.iot_core.jablotron_protocol import flink_status_from_state_disable

    assert flink_status_from_state_disable("tamper", "tamper") == "ok"
    assert flink_status_from_state_disable("open", "tamper", cover_open_tmp=False) == "open"


def test_parse_device_status_8a_type14_flag10_is_status_tmp():
    # Disable empty + Status TMP
    packet = bytes.fromhex("52078a0914100000f2")
    parsed = parse_packet(packet)
    assert parsed.device_states.get(9) == "tamper"
    assert parsed.device_disable.get(9) == "none"


def test_parse_device_status_8a_flag01_is_disable_tamper_not_device():
    # Historical: Tamper-disable + Status OK → byte[5]=0x01 (not Device)
    packet = bytes.fromhex("52078a0904010000f2")
    parsed = parse_packet(packet)
    assert parsed.device_disable.get(9) == "tamper"
    assert 9 in parsed.device_tmp_clear


def test_parse_device_status_8a_clears_tmp_bit():
    packet = bytes.fromhex("52078a0904000000f2")
    parsed = parse_packet(packet)
    assert parsed.device_states == {}
    assert 9 in parsed.device_tmp_clear


def test_merge_tmp_beats_instant_act():
    from app.iot_core.jablotron_protocol import empty_updates, merge_updates

    base = empty_updates()
    instant = empty_updates()
    instant.device_states[9] = "open"
    instant.device_state_force.add(9)
    tmp = empty_updates()
    tmp.device_states[9] = "tamper"
    tmp.device_state_force.add(9)
    merge_updates(base, instant)
    merge_updates(base, tmp)
    assert base.device_states[9] == "tamper"


def test_activity_bitmap_ok_clears_sticky_instant_act():
    """JA-110P pulse: 0xd8 idle must clear Instant ACT (like F-Link / contacts)."""
    from app.iot_core.jablotron_protocol import should_replace_device_state, parse_packet

    assert should_replace_device_state("open", "ok", forced=False) is True
    assert should_replace_device_state("tamper", "ok", forced=False) is False
    assert should_replace_device_state("loss", "ok", forced=False) is False
    d8 = parse_packet(bytes.fromhex("d80300fe01"))
    assert d8.device_states.get(9) == "ok"
    assert d8.device_states.get(8) == "open"


def test_parse_device_status_8a_ignores_ja118m_diag_byte():
    # JA-118M type 0x0c/0x0e — byte[5]=0x10 is NOT F-Link Disable
    packet = bytes.fromhex("52078a010c100000f2")
    parsed = parse_packet(packet)
    assert parsed.device_disable.get(1) == "none"
    assert parsed.device_types.get(1) == "door"
    assert parsed.device_models.get(1) == "JA-118M"
    assert parsed.device_links.get(1) == "bus"
    packet2 = bytes.fromhex("52078a020e000000fc")
    assert parse_packet(packet2).device_disable.get(2) == "none"
    assert parse_packet(packet2).device_models.get(2) == "JA-118M"
    assert parse_packet(packet2).device_links.get(2) == "bus"


def test_bus_type_to_device_info_does_not_invent_sku_on_0x04():
    from app.iot_core.jablotron_protocol import bus_type_to_device_info

    assert bus_type_to_device_info(0x04) == ("sensor", "")
    assert bus_type_to_device_info(0x14) == ("pir", "")
    assert bus_type_to_device_info(0x0C) == ("door", "JA-118M")
    assert bus_type_to_device_info(0x06) == ("siren", "")
    packet = bytes.fromhex("52078a0904100000f2")
    parsed = parse_packet(packet)
    assert parsed.device_types.get(9) == "sensor"
    assert parsed.device_models.get(9) == ""
    assert parsed.device_links.get(9) == "bus"


def test_parse_device_status_8a_type14_is_pir_family_without_sku():
    packet = bytes.fromhex("52078a0914100000f2")
    parsed = parse_packet(packet)
    assert parsed.device_types.get(9) == "pir"
    assert parsed.device_models.get(9) == ""
    assert parsed.device_links.get(9) == "bus"


def test_parse_device_status_8a_length9_is_rf():
    packet = bytes.fromhex("52098a09040000001f20")
    parsed = parse_packet(packet)
    assert parsed.device_links.get(9) == "rf"
    assert parsed.device_models.get(9) == ""
    assert parsed.device_types.get(9) == "sensor"


def test_parse_devices_sections_3b():
    from app.iot_core.jablotron_protocol import parse_devices_sections_packet

    # Live capture: all zeros → every address section 1
    sections = parse_devices_sections_packet(bytes.fromhex("3b0701000000000000"))
    assert sections.get(1) == 1
    assert sections.get(9) == 1
    assert sections.get(12) == 1
    # High nibble first (HA order): byte 0x10 → first device section 2, second section 1
    # bits MSB-left of 0x10 = 00010000 → [4:8]=0001 →1+1=2; [0:4]=0000 →1
    packed = bytes([0x3B, 0x02, 0x01, 0x10])
    s2 = parse_devices_sections_packet(packed)
    assert s2.get(1) == 2
    assert s2.get(2) == 1


def test_parse_device_status_8a_device_disable():
    # Device (red): 0x02 / 0x08 — not 0x01 (0x01 = Tamper-disable + Status OK)
    packet = bytes.fromhex("52078a0904020000f2")
    parsed = parse_packet(packet)
    assert parsed.device_disable.get(9) == "device"
    packet2 = bytes.fromhex("52078a0904080000f2")
    assert parse_packet(packet2).device_disable.get(9) == "device"


def test_parse_device_status_8a_ignores_unknown_combo_bits():
    # Unknown combo must not invent Device (previous false Disable on TMP).
    packet = bytes.fromhex("52078a09040b0000f2")  # 0x0B
    parsed = parse_packet(packet)
    assert parsed.device_disable.get(9) == "none"
    packet2 = bytes.fromhex("52078a0904050000f2")  # 0x05
    assert parse_packet(packet2).device_disable.get(9) == "none"


def test_authorisation_code_1234_matches_ha_wire():
    from app.iot_core.jablotron_protocol import create_packet_authorisation_code

    pkt = create_packet_authorisation_code("1234")
    # 80 | len | 03 | 39 39 39 31 32 33 34
    assert pkt[:3] == bytes([0x80, 0x08, 0x03])
    assert pkt[3:] == bytes([0x39, 0x39, 0x39, 0x31, 0x32, 0x33, 0x34])


def test_authorisation_code_candidates_user2_prefix_first():
    from app.iot_core.jablotron_protocol import authorisation_code_candidates

    assert authorisation_code_candidates("5678", user_num=2) == ["2*5678", "5678"]
    assert authorisation_code_candidates("1234", user_num=1) == ["1234", "1*1234"]
    assert authorisation_code_candidates("2*5678") == ["2*5678", "5678"]
    assert authorisation_code_candidates("1234") == ["1234"]


def test_authorisation_code_prefix_packet_matches_ha():
    from app.iot_core.jablotron_protocol import create_packet_authorisation_code

    pkt = create_packet_authorisation_code("2*1234")
    # rjust 8 → "002*1234", skip * → 0,0,2,1,2,3,4 as 0x30+n
    assert pkt[:3] == bytes([0x80, 0x08, 0x03])
    assert pkt[3:] == bytes([0x30, 0x30, 0x32, 0x31, 0x32, 0x33, 0x34])


def test_sections_states_mixed_is_partial_not_whole_disarm():
    """Armed + disarmed sections must not report panel_armed=disarmed."""
    # 0x51 layout: section N at offset N*2 (2 bytes, primary in low 3 bits)
    packet = bytearray(16)
    packet[0] = 0x51
    packet[2] = 3  # section 1 ARMED_FULL
    packet[3] = 0
    packet[4] = 1  # section 2 DISARMED
    packet[5] = 0
    packet[6] = 0x07  # terminator (ignored section)
    packet[7] = 0x00
    parsed = parse_packet(bytes(packet))
    assert parsed.section_states[1] == "armed"
    assert parsed.section_states[2] == "disarmed"
    assert parsed.panel_armed == "partial"
    assert parsed.section_triggered[1] is False
    assert parsed.section_triggered[2] is False
    assert 3 not in parsed.section_states


def test_sections_states_triggered_matches_physical_keypad():
    """HA triggered bits 3/4/9/12/13 → keypad_alarm; other sections stay independent."""
    packet = bytearray(16)
    packet[0] = 0x51
    packet[2] = 0x11  # DISARMED + bit 3 (keypad flash)
    packet[3] = 0
    packet[4] = 3  # ARMED_FULL, no flash
    packet[5] = 0
    packet[6] = 0x07
    packet[7] = 0x00
    parsed = parse_packet(bytes(packet))
    assert parsed.section_states[1] == "disarmed"
    assert parsed.section_triggered[1] is True
    assert parsed.section_states[2] == "armed"
    assert parsed.section_triggered[2] is False
    assert parsed.panel_armed == "partial"


def test_sections_states_truncated_does_not_invent_other_sections():
    """Terminator after section 1 must not invent armed_state for section 2+."""
    packet = bytearray(16)
    packet[0] = 0x51
    packet[2] = 3  # section 1 ARMED_FULL
    packet[3] = 0
    packet[4] = 0x07
    packet[5] = 0x00
    parsed = parse_packet(bytes(packet))
    assert parsed.section_states == {1: "armed"}
    assert parsed.section_triggered == {1: False}
    assert parsed.panel_armed == "armed"


def test_reconcile_keeps_instant_alarm_when_d8_still_ok():
    """First Instant while armed + last_d8=ok must stay open so promote → alarm works."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager, _HidSession

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="armed",
        zones={},
        devices={},
    )
    mgr.panel_bus = SimpleNamespace(panels={"PANEL_1": panel})
    session = _HidSession(panel_id="PANEL_1", usb_path="mock", device=None)
    session.last_d8_states[1] = "ok"

    on = (1 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0x40, 0x00])
    )
    assert updates.device_states.get(1) == "open"
    assert 1 in updates.device_alarm_events

    mgr._reconcile_instant_with_bitmap(session, "PANEL_1", updates)
    assert updates.device_states.get(1) == "open", "Instant alarm must not be wiped to ok"


def test_reconcile_drops_instant_act_when_disarmed():
    """After Tắt bảo vệ: Instant residue + idle bitmap must clear (no sticky ACT)."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager, _HidSession

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={},
        devices={},
    )
    mgr.panel_bus = SimpleNamespace(panels={"PANEL_1": panel})
    session = _HidSession(panel_id="PANEL_1", usb_path="mock", device=None)
    session.last_d8_states[3] = "ok"

    on = (3 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0xC0, 0x00])
    )
    assert updates.device_states.get(3) == "open"
    mgr._reconcile_instant_with_bitmap(session, "PANEL_1", updates)
    assert updates.device_states.get(3) == "ok"


def test_promote_pulse_activity_while_armed():
    """PIR ACTIVITY ON while armed → sticky alarm (lần 1 Dev_09 focus)."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager, _HidSession

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="armed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "armed"}},
        devices={
            "PANEL_1_DEV_09": {
                "global_id": "PANEL_1_DEV_09",
                "device_num": 9,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "pir",
            }
        },
    )
    mgr.panel_bus = SimpleNamespace(panels={"PANEL_1": panel})
    session = _HidSession(panel_id="PANEL_1", usb_path="mock", device=None)
    on = (9 * 4) + 104
    # ACTIVITY ON for device 9 — encode address like live captures
    # device 9: bits → use parse from known-good pattern
    from app.iot_core.jablotron_protocol import _parse_device_number

    # Build packet: find lo/hi for device 9
    pkt = None
    for hi in range(4):
        for lo in range(256):
            cand = bytes([0x55, 0x0A, DeviceStateEvent.ACTIVITY, on, lo, hi])
            if _parse_device_number(cand) == 9:
                pkt = cand
                break
        if pkt:
            break
    assert pkt is not None
    updates = parse_packet(pkt)
    assert updates.device_states.get(9) == "open"
    assert 9 not in updates.device_alarm_events
    mgr._promote_act_to_alarm_when_armed(panel, updates, session)
    assert updates.device_states.get(9) == "alarm"


def test_promote_skipped_when_zone_disarmed():
    """After Tắt bảo vệ: Instant must not re-promote to sticky alarm."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "door",
            }
        },
    )
    on = (1 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0x40, 0x00])
    )
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(1) == "open"


def test_merge_keeps_instant_open_over_cover_open_ok():
    """Dev_09: Instant open must survive 0x8a flag 0x11 OK in the same batch."""
    from app.iot_core.jablotron_protocol import merge_updates

    on = (9 * 4) + 104
    pkt = None
    for hi in range(4):
        for lo in range(256):
            cand = bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, lo, hi])
            if _parse_device_number(cand) == 9:
                pkt = cand
                break
        if pkt:
            break
    assert pkt is not None
    instant = parse_packet(pkt)
    assert instant.device_states.get(9) == "open"
    assert 9 in instant.device_alarm_events

    # type 0x04 + flag 0x11 → Disable Tamper + forced OK (cover open)
    cover = parse_packet(bytes([0x52, 0x06, 0x8A, 0x09, 0x04, 0x11, 0x00, 0x00]))
    assert cover.device_disable.get(9) == "tamper"
    assert cover.device_states.get(9) == "ok"

    merged = merge_updates(instant, cover)
    assert merged.device_states.get(9) == "open", "cover-open OK must not wipe Instant"
    assert 9 in merged.device_alarm_events
    assert merged.device_disable.get(9) == "tamper"


def test_promote_after_cover_open_ok_restores_instant_while_armed():
    """Armed + Instant tagged but state wiped to ok → restore then promote."""
    from types import SimpleNamespace

    from app.iot_core.jablotron_protocol import empty_updates
    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="armed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "armed"}},
        devices={
            "PANEL_1_DEV_09": {
                "global_id": "PANEL_1_DEV_09",
                "device_num": 9,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "pir",
                "disable": "tamper",
            }
        },
    )
    mgr.panel_bus = SimpleNamespace(panels={"PANEL_1": panel})
    updates = empty_updates()
    updates.device_states[9] = "ok"
    updates.device_state_force.add(9)
    updates.device_alarm_events.add(9)
    updates.device_disable[9] = "tamper"

    # Simulate the restore step used in _apply_updates before promote.
    if updates.device_states.get(9) == "ok" and mgr._device_section_armed(panel, 9):
        updates.device_states[9] = "open"
        updates.device_state_force.add(9)
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(9) == "alarm"


def test_promote_24h_when_zone_disarmed():
    """24 hours: Instant ON → Báo động even when section is unset."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "door",
                "reaction": "24h",
            }
        },
    )
    on = (1 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0x40, 0x00])
    )
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(1) == "alarm"


def test_merge_instant_not_clobbered_by_power_supply_fault():
    """24h trip: Instant ON then 0x05 in the same batch must stay ACT, not Lỗi."""
    from app.iot_core.jablotron_protocol import merge_updates

    on = (1 * 4) + 104
    instant = parse_packet(bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0x40, 0x00]))
    psu = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.POWER_SUPPLY_FAULT, on, 0x40, 0x00])
    )
    assert instant.device_states.get(1) == "open"
    assert psu.device_states.get(1) == "fault"
    merged = merge_updates(instant, psu)
    assert merged.device_states.get(1) == "open"
    assert 1 in merged.device_alarm_events


def test_promote_24h_power_supply_fault_when_disarmed():
    """0x55 0x05 on a 24h zone is the trip — Báo động, not Lỗi (snapshot needs alarm)."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    mgr._acked_always_nums = {}
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "door",
                "link": "bus",
                "reaction": "24h",
            }
        },
    )
    on = (1 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.POWER_SUPPLY_FAULT, on, 0x40, 0x00])
    )
    assert updates.device_states.get(1) == "fault"
    mgr._reinterpret_trip_fault(panel, None, updates)
    assert updates.device_states.get(1) == "open"
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(1) == "alarm"


def test_promote_24h_battery_fault_on_bus_contact():
    """HA: 0x14 on a bus (no-battery) contact is activity — 24h still promotes."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    mgr._acked_always_nums = {}
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "door",
                "link": "bus",
                "reaction": "24h",
            }
        },
    )
    on = (1 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.BATTERY_FAULT, on, 0x40, 0x00])
    )
    assert updates.device_states.get(1) == "fault"
    mgr._reinterpret_trip_fault(panel, None, updates)
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(1) == "alarm"


def test_rf_power_supply_fault_stays_error_when_instant():
    """RF Instant + real 0x05 (d8 idle) stays Lỗi — not a 24h trip."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_09": {
                "global_id": "PANEL_1_DEV_09",
                "device_num": 9,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "pir",
                "link": "rf",
                "reaction": "instant",
            }
        },
    )
    on = (9 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.POWER_SUPPLY_FAULT, on, 0x40, 0x02])
    )
    mgr._reinterpret_trip_fault(panel, None, updates)
    assert updates.device_states.get(9) == "fault"


def test_promote_24h_activity_when_disarmed():
    """24h OK→ACT (ACTIVITY) khi phân khu tắt vẫn promote Báo động + Focus."""
    from types import SimpleNamespace

    from app.iot_core.jablotron_protocol import should_replace_device_state
    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "door",
                "reaction": "24h",
            }
        },
    )
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.ACTIVITY, (1 * 4) + 104, 0x40, 0x00])
    )
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(1) == "alarm"
    assert should_replace_device_state("alarm", "ok", forced=True, clear_alarm=False) is False


def test_reconcile_keeps_24h_act_when_d8_idle():
    """0x55 ACTIVITY 24h tới trước 0xd8 — không được hạ OK rồi mất Báo động."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager, _HidSession

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    mgr._acked_always_nums = {}
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "door",
                "reaction": "24h",
            }
        },
    )
    mgr.panel_bus = SimpleNamespace(panels={"PANEL_1": panel})
    session = _HidSession(panel_id="PANEL_1", usb_path="mock", device=None)
    session.last_d8_states[1] = "ok"
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.ACTIVITY, (1 * 4) + 104, 0x40, 0x00])
    )
    assert updates.device_states.get(1) == "open"
    mgr._reconcile_instant_with_bitmap(session, "PANEL_1", updates)
    assert updates.device_states.get(1) == "open"
    mgr._promote_act_to_alarm_when_armed(panel, updates, session)
    assert updates.device_states.get(1) == "alarm"


def test_pulse_window_keeps_24h_pir_when_disarmed():
    """PIR 24h: hết cửa sổ pulse khi phân khu tắt vẫn giữ ACT để promote."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager, _HidSession

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    mgr._acked_always_nums = {}
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_09": {
                "global_id": "PANEL_1_DEV_09",
                "device_num": 9,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "pir",
                "reaction": "24h",
            }
        },
    )
    mgr.panel_bus = SimpleNamespace(panels={"PANEL_1": panel})
    session = _HidSession(panel_id="PANEL_1", usb_path="mock", device=None)
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.ACTIVITY, (9 * 4) + 104, 0x40, 0x02])
    )
    if updates.device_states.get(9) != "open":
        updates.device_states[9] = "open"
        updates.device_state_force.add(9)
    mgr._apply_pir_pulse_window(session, "PANEL_1", updates)
    assert updates.device_states.get(9) == "open"
    mgr._promote_act_to_alarm_when_armed(panel, updates, session)
    assert updates.device_states.get(9) == "alarm"


def test_runtime_state_for_boot_drops_alarm():
    from app.iot_core.panel_store import runtime_state_for_boot

    assert runtime_state_for_boot("alarm") == "ok"
    assert runtime_state_for_boot("open") == "open"
    assert runtime_state_for_boot("tamper") == "tamper"
    assert runtime_state_for_boot(None) == "ok"


def test_promote_24h_d8_bitmap_does_not_alarm():
    """Reconnect 0xd8 ACT is the current level — not a new 24h trip after restart."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    mgr._acked_always_nums = {}
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "open",
                "device_type": "door",
                "reaction": "24h",
            }
        },
    )
    updates = parse_packet(bytes([0xD8, 0x03, 0x00, 0xFE, 0x01]))
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(1) == "open"


def test_acked_always_survives_restart_from_disk(tmp_path):
    """Ack «Tắt báo động 24h» đọc lại từ đĩa; ACT thuần không tự sinh ack.

    Trước đây restart tự đánh ack mọi thiết bị 24h đang ACT — lần kích sau bị
    bỏ qua hoàn toàn (không Báo động, không Focus Map, không Snapshot).
    """
    import json

    from app.iot_core.usb_manager import UsbDeviceManager

    path = tmp_path / "acked_always.json"
    path.write_text(json.dumps({"PANEL_1": [1]}), encoding="utf-8")

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    mgr._acked_always_nums = {}
    mgr._acked_always_path = lambda: path
    mgr._load_acked_always()

    assert mgr._acked_always("PANEL_1") == {1}
    assert not hasattr(mgr, "_seed_acked_always_from_bus")


def test_promote_24h_skipped_when_acked():
    """Tắt báo động 24h: Instant ON while still open must not re-promote."""
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    mgr._acked_always_nums = {"PANEL_1": {1}}
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "open",
                "device_type": "door",
                "reaction": "24h",
            }
        },
    )
    on = (1 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0x40, 0x00])
    )
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(1) == "open"


def test_promote_fire_when_zone_disarmed():
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="disarmed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "disarmed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "smoke",
                "reaction": "fire",
            }
        },
    )
    on = (1 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0x40, 0x00])
    )
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(1) == "alarm"


def test_report_reaction_does_not_promote():
    from types import SimpleNamespace

    from app.iot_core.usb_manager import UsbDeviceManager

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        armed_state="armed",
        zones={"z1": {"zone_id": "z1", "section_num": 1, "armed_state": "armed"}},
        devices={
            "PANEL_1_DEV_01": {
                "global_id": "PANEL_1_DEV_01",
                "device_num": 1,
                "zone_id": "z1",
                "state": "ok",
                "device_type": "sensor",
                "reaction": "report",
            }
        },
    )
    on = (1 * 4) + 104
    updates = parse_packet(
        bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0x40, 0x00])
    )
    mgr._promote_act_to_alarm_when_armed(panel, updates, None)
    assert updates.device_states.get(1) == "open"


def test_normalize_reaction_defaults_to_instant():
    from app.iot_core.device_reaction import (
        normalize_reaction,
        reaction_alarms_when_disarmed,
        reaction_promotes_open,
    )

    assert normalize_reaction(None) == "instant"
    assert normalize_reaction("24H") == "24h"
    assert normalize_reaction("siren_mute") == "siren_mute"
    assert reaction_alarms_when_disarmed("24h")
    assert reaction_alarms_when_disarmed("fire")
    assert not reaction_alarms_when_disarmed("instant")
    assert not reaction_promotes_open("none")
    assert not reaction_promotes_open("siren_mute")
    assert reaction_promotes_open("instant")
    from app.iot_core.device_reaction import hid_reaction_overrides

    assert hid_reaction_overrides("instant", "delayed")
    assert not hid_reaction_overrides("24h", "delayed")
    assert not hid_reaction_overrides("instant", "instant")
    assert not hid_reaction_overrides("siren_mute", "delayed")


def test_parse_delayed_event_sets_reaction():
    on = (1 * 4) + 104
    packet = bytes([0x55, 0x0A, DeviceStateEvent.DELAYED_ALARM_A, on, 0x40, 0x00])
    parsed = parse_packet(packet)
    assert parsed.device_states.get(1) == "open"
    assert parsed.device_reactions.get(1) == "delayed"
    instant = bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, on, 0x40, 0x00])
    assert parse_packet(instant).device_reactions == {}
    repeat = bytes([0x55, 0x0A, DeviceStateEvent.REPEATED_ALARM, on, 0x40, 0x00])
    assert parse_packet(repeat).device_reactions.get(1) == "repeating_instant"


def test_device_state_heartbeat_is_not_pin():
    from app.iot_core.jablotron_protocol import is_device_state_heartbeat

    hb = bytes([0x55, 0x0A, DeviceStateEvent.HEARTBEAT, 0x6C, 0x40, 0x00])
    raw33 = bytes([0x55, 0x0A, 0x33, 0x6C, 0x40, 0x00])
    auth = bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, 0x6C, 0x40, 0x00])
    assert is_device_state_heartbeat(hb) is True
    assert is_device_state_heartbeat(raw33) is True
    assert is_device_state_heartbeat(auth) is False


def test_keypad_auth_packet_flagged_and_not_treated_as_sensor():
    from types import SimpleNamespace

    from app.iot_core.jablotron_protocol import empty_updates, parse_packet
    from app.iot_core.usb_manager import UsbDeviceManager, _HidSession

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(
        panel_id="PANEL_1",
        devices={
            "PANEL_1_DEV_01": {
                "device_num": 1,
                "device_type": "keypad",
                "model": "JA-114E",
            }
        },
    )
    session = _HidSession(panel_id="PANEL_1", usb_path="mock", device=None)
    pkt = bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, 0x6C, 0x40, 0x00])
    parsed = parse_packet(pkt)
    mgr._annotate_keypad_auth(session, panel, pkt, parsed)
    assert parsed.keypad_authorized is True
    assert 1 not in parsed.device_states
    assert 1 not in parsed.device_alarm_events

    hb = bytes([0x55, 0x0A, DeviceStateEvent.HEARTBEAT, 0x6C, 0x40, 0x00])
    idle = empty_updates()
    mgr._annotate_keypad_auth(session, panel, hb, idle)
    assert idle.keypad_authorized is False


def test_usb_system_device_55_is_authorization():
    """PIN khi phân khu đã disarmed: 0x55 từ USB (254), không phải cảm biến 1–99."""
    from types import SimpleNamespace

    from app.iot_core.jablotron_protocol import parse_packet
    from app.iot_core.usb_manager import UsbDeviceManager, _HidSession

    mgr = UsbDeviceManager.__new__(UsbDeviceManager)
    panel = SimpleNamespace(panel_id="PANEL_1", devices={})
    session = _HidSession(panel_id="PANEL_1", usb_path="mock", device=None)
    # bits[2:10] = 254 → packet[4:6] little-endian 0x3F80
    pkt = bytes([0x55, 0x0A, DeviceStateEvent.INSTANT_ALARM, 0x6C, 0x80, 0x3F])
    assert _parse_device_number(pkt) == 254
    parsed = parse_packet(pkt)
    mgr._annotate_keypad_auth(session, panel, pkt, parsed)
    assert parsed.keypad_authorized is True


def test_ui_control_disarm_already_disarmed_section():
    from app.iot_core.jablotron_protocol import SECTION_MODE_DISARM, parse_packet

    section = 2
    pkt = bytes([0x80, 0x02, 0x0D, SECTION_MODE_DISARM + section])
    parsed = parse_packet(pkt)
    assert parsed.section_unset_cmds == {2}
