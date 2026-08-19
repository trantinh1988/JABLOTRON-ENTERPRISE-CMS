"""Lưu file âm thanh cảnh báo trên máy chủ — mọi client CMS dùng chung."""

from __future__ import annotations

import json
import re
import threading
import uuid
from pathlib import Path
from typing import Any

from app.core.config import BACKEND_ROOT

ALERT_SOUND_STATUSES = ("alarm", "tamper", "fault", "loss")
ALERT_SOUND_MAX_BYTES = 2 * 1024 * 1024
MEDIA_PREFIX = "/media/alert-sounds"

_DEFAULT_DIR = BACKEND_ROOT / "data" / "alert_sounds"
_dir_override: Path | None = None
_lock = threading.Lock()

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._\- ()\u00C0-\u024F\u1E00-\u1EFF]+")


def set_alert_sounds_dir(path: Path | None) -> None:
    global _dir_override
    _dir_override = path


def ensure_alert_sounds_dir() -> Path:
    d = _dir_override or _DEFAULT_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def _manifest_path() -> Path:
    return ensure_alert_sounds_dir() / "manifest.json"


def _empty_state() -> dict[str, Any]:
    return {
        "sound_enabled": False,
        "trail_enabled": True,
        "site_title": "",
        "sounds": {key: None for key in ALERT_SOUND_STATUSES},
    }


def _read_state() -> dict[str, Any]:
    path = _manifest_path()
    if not path.is_file():
        return _empty_state()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty_state()
    if not isinstance(raw, dict):
        return _empty_state()
    state = _empty_state()
    if isinstance(raw.get("sound_enabled"), bool):
        state["sound_enabled"] = raw["sound_enabled"]
    if isinstance(raw.get("trail_enabled"), bool):
        state["trail_enabled"] = raw["trail_enabled"]
    if isinstance(raw.get("site_title"), str):
        state["site_title"] = _normalize_site_title(raw["site_title"])
    sounds = raw.get("sounds")
    if isinstance(sounds, dict):
        for key in ALERT_SOUND_STATUSES:
            slot = sounds.get(key)
            if isinstance(slot, dict) and slot.get("url") and slot.get("name"):
                state["sounds"][key] = {
                    "name": str(slot["name"])[:200],
                    "url": str(slot["url"]),
                    "type": str(slot.get("type") or ""),
                }
    return state


def _write_state(state: dict[str, Any]) -> None:
    path = _manifest_path()
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def get_system_settings() -> dict[str, Any]:
    with _lock:
        return _read_state()


def _normalize_site_title(value: str) -> str:
    text = "".join(ch for ch in value.replace("\x00", "") if ch.isprintable() or ch in " \t")
    return " ".join(text.split())[:80]


def patch_system_settings(
    *,
    sound_enabled: bool | None = None,
    trail_enabled: bool | None = None,
    site_title: str | None = None,
) -> dict[str, Any]:
    with _lock:
        state = _read_state()
        if sound_enabled is not None:
            state["sound_enabled"] = bool(sound_enabled)
        if trail_enabled is not None:
            state["trail_enabled"] = bool(trail_enabled)
        if site_title is not None:
            state["site_title"] = _normalize_site_title(site_title)
        _write_state(state)
        return state


def _sniff_ext(filename: str, content_type: str, raw: bytes) -> str | None:
    name = filename.lower()
    ctype = (content_type or "").split(";")[0].strip().lower()
    if len(raw) >= 12 and raw.startswith(b"RIFF") and raw[8:12] == b"WAVE":
        return ".wav"
    if raw.startswith(b"ID3") or (len(raw) >= 2 and raw[0] == 0xFF and raw[1] in (0xFB, 0xF3, 0xF2, 0xFA)):
        return ".mp3"
    if raw.startswith(b"OggS"):
        return ".ogg"
    if len(raw) >= 12 and raw[4:8] == b"ftyp":
        return ".m4a"
    if raw.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    by_name = {
        ".wav": ".wav",
        ".mp3": ".mp3",
        ".ogg": ".ogg",
        ".m4a": ".m4a",
        ".webm": ".webm",
    }
    for suffix, ext in by_name.items():
        if name.endswith(suffix):
            return ext
    by_type = {
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/wave": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/ogg": ".ogg",
        "audio/mp4": ".m4a",
        "audio/aac": ".m4a",
        "audio/webm": ".webm",
    }
    return by_type.get(ctype)


def _display_name(filename: str) -> str:
    base = Path(filename.replace("\\", "/")).name.strip() or "sound"
    cleaned = _SAFE_NAME.sub("_", base).strip("._") or "sound"
    return cleaned[:200]


def _unlink_slot(slot: dict[str, Any] | None) -> None:
    if not slot:
        return
    url = str(slot.get("url") or "")
    if not url.startswith(f"{MEDIA_PREFIX}/"):
        return
    name = Path(url).name
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        return
    path = ensure_alert_sounds_dir() / name
    try:
        if path.is_file():
            path.unlink()
    except OSError:
        pass


def save_alert_sound(status: str, filename: str, content_type: str, raw: bytes) -> dict[str, Any]:
    if status not in ALERT_SOUND_STATUSES:
        raise ValueError("bad_status")
    if not raw:
        raise ValueError("empty")
    if len(raw) > ALERT_SOUND_MAX_BYTES:
        raise ValueError("too_big")
    ext = _sniff_ext(filename, content_type, raw)
    if not ext:
        raise ValueError("bad_type")

    dest_name = f"{status}_{uuid.uuid4().hex}{ext}"
    dest = ensure_alert_sounds_dir() / dest_name
    dest.write_bytes(raw)
    slot = {
        "name": _display_name(filename),
        "url": f"{MEDIA_PREFIX}/{dest_name}",
        "type": (content_type or "").split(";")[0].strip() or f"audio/{ext.lstrip('.')}",
    }
    with _lock:
        state = _read_state()
        old = state["sounds"].get(status)
        state["sounds"][status] = slot
        _write_state(state)
        _unlink_slot(old)
        return state


def delete_alert_sound(status: str) -> dict[str, Any]:
    if status not in ALERT_SOUND_STATUSES:
        raise ValueError("bad_status")
    with _lock:
        state = _read_state()
        old = state["sounds"].get(status)
        state["sounds"][status] = None
        _write_state(state)
        _unlink_slot(old)
        return state
