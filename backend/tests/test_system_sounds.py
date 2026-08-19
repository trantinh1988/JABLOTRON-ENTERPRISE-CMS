"""Alert sound store — shared files on the CMS host."""

from pathlib import Path

import pytest

from app.iot_core import system_sounds as store

WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + b"\x00" * 32


@pytest.fixture(autouse=True)
def _tmp_dir(tmp_path: Path):
    store.set_alert_sounds_dir(tmp_path)
    yield
    store.set_alert_sounds_dir(None)


def test_save_and_list_wav():
    state = store.save_alert_sound("alarm", "sign0001.wav", "audio/wav", WAV)
    slot = state["sounds"]["alarm"]
    assert slot is not None
    assert slot["name"] == "sign0001.wav"
    assert slot["url"].startswith("/media/alert-sounds/alarm_")
    assert slot["url"].endswith(".wav")
    disk = tmp_file(slot["url"], store.ensure_alert_sounds_dir())
    assert disk.is_file()
    assert disk.read_bytes() == WAV


def tmp_file(url: str, folder: Path) -> Path:
    return folder / Path(url).name


def test_replace_unlinks_old():
    first = store.save_alert_sound("alarm", "a.wav", "audio/wav", WAV)
    old = tmp_file(first["sounds"]["alarm"]["url"], store.ensure_alert_sounds_dir())
    store.save_alert_sound("tamper", "b.wav", "audio/wav", WAV)
    second = store.save_alert_sound("alarm", "c.wav", "audio/wav", WAV)
    assert not old.exists()
    assert tmp_file(second["sounds"]["alarm"]["url"], store.ensure_alert_sounds_dir()).is_file()
    assert second["sounds"]["tamper"]["name"] == "b.wav"


def test_delete_clears_slot():
    store.save_alert_sound("loss", "gone.wav", "audio/wav", WAV)
    state = store.delete_alert_sound("loss")
    assert state["sounds"]["loss"] is None
    assert list(store.ensure_alert_sounds_dir().glob("loss_*")) == []


def test_reject_too_big():
    with pytest.raises(ValueError, match="too_big"):
        store.save_alert_sound("fault", "big.wav", "audio/wav", b"x" * (store.ALERT_SOUND_MAX_BYTES + 1))


def test_reject_bad_type():
    with pytest.raises(ValueError, match="bad_type"):
        store.save_alert_sound("alarm", "notes.txt", "text/plain", b"hello world")


def test_patch_prefs_persist():
    store.patch_system_settings(sound_enabled=True, trail_enabled=False)
    got = store.get_system_settings()
    assert got["sound_enabled"] is True
    assert got["trail_enabled"] is False
    assert got["site_title"] == ""


def test_patch_site_title():
    store.patch_system_settings(site_title="  Coopmart 230 Nguyễn Trãi  ")
    got = store.get_system_settings()
    assert got["site_title"] == "Coopmart 230 Nguyễn Trãi"
    store.patch_system_settings(site_title="")
    assert store.get_system_settings()["site_title"] == ""
