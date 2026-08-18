from app.iot_core.automation_engine import Trigger, extract_triggers, rule_matches


def test_extract_alarm_trigger():
    triggers = extract_triggers(
        {"type": "device_alarm_trigger", "panel_id": "PANEL_1", "device_id": "PANEL_1_DEV_05", "map_id": 2}
    )
    assert len(triggers) == 1
    assert triggers[0].if_type == "device_alarm"
    assert triggers[0].device_id == "PANEL_1_DEV_05"
    assert triggers[0].map_id == 2


def test_extract_skips_device_state_alarm():
    assert extract_triggers({"type": "device_state", "device_id": "X", "state": "alarm"}) == []


def test_extract_tamper_and_batch_loss():
    one = extract_triggers({"type": "device_state", "device_id": "D1", "state": "tamper", "panel_id": "P"})
    assert one[0].if_type == "tamper"
    batch = extract_triggers(
        {"type": "devices_state_batch", "panel_id": "P", "updates": {"D2": "loss", "D3": "ok", "D4": "alarm"}}
    )
    assert [t.if_type for t in batch] == ["loss"]
    assert batch[0].device_id == "D2"


def test_extract_zone_armed():
    armed = extract_triggers({"type": "zone_armed", "zone_id": "Z1", "armed_state": "armed", "panel_id": "P"})
    assert armed[0].if_type == "section_armed"
    off = extract_triggers({"type": "zone_armed", "zone_id": "Z1", "armed_state": "disarmed"})
    assert off[0].if_type == "section_disarmed"


def test_extract_skips_heartbeat():
    assert extract_triggers({"type": "panel_live"}) == []
    assert extract_triggers({"type": "automation_fired"}) == []


def test_rule_matches_any_device():
    rule = {"enabled": True, "if_type": "device_alarm"}
    trigger = Trigger(if_type="device_alarm", device_id="D1", map_id=1)
    assert rule_matches(rule, trigger)


def test_rule_matches_specific_device_and_floor():
    rule = {"enabled": True, "if_type": "device_alarm", "if_device_id": "D1", "if_floor_id": 2}
    assert rule_matches(rule, Trigger(if_type="device_alarm", device_id="D1", map_id=2))
    assert not rule_matches(rule, Trigger(if_type="device_alarm", device_id="D2", map_id=2))
    assert not rule_matches(rule, Trigger(if_type="device_alarm", device_id="D1", map_id=1))


def test_rule_ignores_disabled_and_wrong_type():
    rule = {"enabled": False, "if_type": "device_alarm"}
    assert not rule_matches(rule, Trigger(if_type="device_alarm"))
    rule = {"enabled": True, "if_type": "tamper"}
    assert not rule_matches(rule, Trigger(if_type="device_alarm"))


def test_armed_alarm_requires_section_or_panel_armed():
    rule = {"enabled": True, "if_type": "armed_alarm"}
    assert rule_matches(rule, Trigger(if_type="device_alarm", device_id="D1", armed=True))
    assert not rule_matches(rule, Trigger(if_type="device_alarm", device_id="D1", armed=False))
    assert not rule_matches(rule, Trigger(if_type="tamper", armed=True))


def test_armed_alarm_matches_24h_when_disarmed():
    rule = {"enabled": True, "if_type": "armed_alarm"}
    assert rule_matches(
        rule, Trigger(if_type="device_alarm", device_id="D1", armed=False, always=True)
    )


def test_require_armed_filter_on_tamper():
    rule = {"enabled": True, "if_type": "tamper", "if_require_armed": True}
    assert rule_matches(rule, Trigger(if_type="tamper", armed=True))
    assert not rule_matches(rule, Trigger(if_type="tamper", armed=False))


def test_device_zone_filter():
    rule = {"enabled": True, "if_type": "armed_alarm", "if_zone_id": "Z1"}
    assert rule_matches(rule, Trigger(if_type="device_alarm", zone_id="Z1", armed=True))
    assert not rule_matches(rule, Trigger(if_type="device_alarm", zone_id="Z2", armed=True))


def test_extract_open_fault_and_panel():
    assert extract_triggers({"type": "device_state", "device_id": "D1", "state": "open"})[0].if_type == "device_open"
    assert extract_triggers({"type": "device_state", "device_id": "D1", "state": "fault"})[0].if_type == "device_fault"
    assert extract_triggers({"type": "panel_armed", "panel_id": "P", "armed_state": "armed"})[0].if_type == "panel_armed"
    assert extract_triggers({"type": "panel_armed", "panel_id": "P", "armed_state": "disarmed"})[0].if_type == "panel_disarmed"


def test_extract_keypad_alarm():
    triggers = extract_triggers(
        {"type": "zone_armed", "zone_id": "Z1", "armed_state": "armed", "keypad_alarm": True, "panel_id": "P"}
    )
    assert {t.if_type for t in triggers} == {"section_armed", "keypad_alarm"}
