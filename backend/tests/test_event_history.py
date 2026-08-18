from datetime import datetime, timezone

from app.api.events import _as_int, _parse_bound
from app.iot_core.event_store import audit_records, is_history_page_event, reset_audit_dedup


def test_parse_bound_date_start_vn():
    dt = _parse_bound("2026-08-14", end=False)
    assert dt is not None
    assert dt == datetime(2026, 8, 13, 17, 0, tzinfo=timezone.utc)


def test_parse_bound_date_end_vn():
    dt = _parse_bound("2026-08-14", end=True)
    assert dt is not None
    assert dt.tzinfo == timezone.utc
    assert dt.hour == 16


def test_as_int():
    assert _as_int(3) == 3
    assert _as_int("12") == 12
    assert _as_int("") is None
    assert _as_int(None) is None
    assert _as_int("x") is None


def test_audit_skips_derived_panel_armed():
    reset_audit_dedup()
    assert audit_records({"type": "panel_armed", "panel_id": "PANEL_1", "armed_state": "armed", "derived": True}) == []
    assert audit_records({"type": "zone_armed", "panel_id": "PANEL_1", "zone_id": "Z1", "armed_state": "disarmed", "history": False}) == []


def test_audit_skips_status_page_events():
    reset_audit_dedup()
    assert audit_records({"type": "zone_armed", "panel_id": "PANEL_1", "zone_id": "Z1", "armed_state": "armed"}) == []
    assert audit_records({"type": "panel_armed", "panel_id": "PANEL_1", "armed_state": "disarmed"}) == []
    assert audit_records({"type": "device_state", "panel_id": "PANEL_1", "device_id": "PANEL_1_DEV_01", "state": "ok"}) == []
    assert audit_records({"type": "device_state", "panel_id": "PANEL_1", "device_id": "PANEL_1_DEV_02", "state": "open"}) == []
    assert audit_records({"type": "device_state", "panel_id": "PANEL_1", "device_id": "PANEL_1_DEV_03", "state": "loss"}) == []


def test_audit_expands_state_batch_incidents_only():
    reset_audit_dedup()
    rows = audit_records(
        {
            "type": "devices_state_batch",
            "panel_id": "PANEL_1",
            "updates": {
                "PANEL_1_DEV_09": "ok",
                "PANEL_1_DEV_01": "open",
                "PANEL_1_DEV_02": "alarm",
                "PANEL_1_DEV_03": "tamper",
                "PANEL_1_DEV_04": "fault",
            },
            "ts": "2026-08-14T08:00:00Z",
        }
    )
    assert {r["device_id"]: r["state"] for r in rows} == {
        "PANEL_1_DEV_02": "alarm",
        "PANEL_1_DEV_03": "tamper",
        "PANEL_1_DEV_04": "fault",
    }
    assert all(r["type"] == "device_state" for r in rows)


def test_audit_keeps_alarm_trigger_skips_automation():
    reset_audit_dedup()
    alarm = audit_records(
        {
            "type": "device_alarm_trigger",
            "panel_id": "PANEL_1",
            "device_id": "PANEL_1_DEV_01",
            "state": "alarm",
        }
    )
    assert len(alarm) == 1
    assert alarm[0]["type"] == "device_alarm_trigger"
    snap = audit_records(
        {
            "type": "automation_fired",
            "device_id": "PANEL_1_DEV_01",
            "then_type": "camera_snapshot",
            "image_url": "/media/alarm-snaps/x.jpg",
        }
    )
    assert snap == []


def test_audit_map_trail_snap_unique_per_map():
    reset_audit_dedup()
    a = audit_records(
        {
            "type": "map_trail_snap",
            "map_id": 1,
            "map_name": "Tầng 1",
            "image_url": "/media/map-snaps/a.jpg",
        }
    )
    b = audit_records(
        {
            "type": "map_trail_snap",
            "map_id": 2,
            "map_name": "Tầng 2",
            "image_url": "/media/map-snaps/b.jpg",
        }
    )
    assert len(a) == 1
    assert len(b) == 1


def test_audit_keeps_panel_updated():
    reset_audit_dedup()
    rows = audit_records({"type": "panel_updated", "panel_id": "PANEL_1", "detail": "USB"})
    assert len(rows) == 1
    assert rows[0]["type"] == "panel_updated"


def test_audit_skips_history_only_ok():
    reset_audit_dedup()
    rows = audit_records(
        {
            "type": "device_state",
            "panel_id": "PANEL_1",
            "device_id": "PANEL_1_DEV_09",
            "state": "ok",
            "history_only": True,
        }
    )
    assert rows == []


def test_is_history_page_event():
    assert is_history_page_event({"type": "device_state", "state": "alarm"})
    assert is_history_page_event({"type": "device_state", "state": "tamper"})
    assert is_history_page_event({"type": "device_state", "state": "fault"})
    assert is_history_page_event({"type": "device_alarm_trigger"})
    assert is_history_page_event({"type": "map_trail_snap"})
    assert is_history_page_event({"type": "panel_updated"})
    assert not is_history_page_event({"type": "device_state", "state": "ok"})
    assert not is_history_page_event({"type": "device_state", "state": "open"})
    assert not is_history_page_event({"type": "device_state", "state": "loss"})
    assert not is_history_page_event({"type": "zone_armed"})
    assert not is_history_page_event({"type": "automation_fired"})
