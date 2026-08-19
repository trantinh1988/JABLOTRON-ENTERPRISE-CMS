from datetime import datetime, timezone

from app.api.events import _as_int, _parse_bound
from app.iot_core.event_store import (
    audit_records,
    history_overwrite_cutoff,
    is_history_page_event,
    reset_audit_dedup,
)


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


def test_audit_collapses_alarm_trigger_with_state():
    reset_audit_dedup()
    state = audit_records(
        {
            "type": "device_state",
            "panel_id": "PANEL_1",
            "device_id": "PANEL_1_DEV_05",
            "state": "alarm",
        }
    )
    trigger = audit_records(
        {
            "type": "device_alarm_trigger",
            "panel_id": "PANEL_1",
            "device_id": "PANEL_1_DEV_05",
            "state": "alarm",
        }
    )
    assert len(state) == 1
    assert trigger == []


def test_audit_collapses_repeat_tamper_and_fault():
    reset_audit_dedup()
    first = audit_records(
        {
            "type": "device_state",
            "panel_id": "PANEL_1",
            "device_id": "PANEL_1_DEV_03",
            "state": "tamper",
        }
    )
    echo = audit_records(
        {
            "type": "device_state",
            "panel_id": "PANEL_1",
            "device_id": "PANEL_1_DEV_03",
            "state": "tamper",
        }
    )
    assert len(first) == 1
    assert echo == []
    fault = audit_records(
        {
            "type": "device_state",
            "panel_id": "PANEL_1",
            "device_id": "PANEL_1_DEV_04",
            "state": "fault",
        }
    )
    assert len(fault) == 1
    assert (
        audit_records(
            {
                "type": "device_state",
                "panel_id": "PANEL_1",
                "device_id": "PANEL_1_DEV_04",
                "state": "fault",
            }
        )
        == []
    )


def test_audit_same_map_trail_collapses():
    reset_audit_dedup()
    a = audit_records({"type": "map_trail_snap", "map_id": 1, "map_name": "Tầng 1"})
    b = audit_records({"type": "map_trail_snap", "map_id": 1, "map_name": "Tầng 1"})
    assert len(a) == 1
    assert b == []


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


def test_history_overwrite_cutoff():
    assert history_overwrite_cutoff(None) is None
    assert history_overwrite_cutoff(1_000_000) is None
    assert history_overwrite_cutoff(1_000_001) == 1
    assert history_overwrite_cutoff(1_000_500) == 500
    assert history_overwrite_cutoff(6, keep=5) == 1
    assert history_overwrite_cutoff(5, keep=5) is None
    assert history_overwrite_cutoff(10, keep=0) is None
