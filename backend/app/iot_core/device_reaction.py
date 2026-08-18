"""F-Link Reaction (zone type) — config, independent of runtime Status."""

from __future__ import annotations

from typing import Final

DEFAULT_DEVICE_REACTION: Final = "instant"

VALID_DEVICE_REACTIONS: Final[frozenset[str]] = frozenset(
    {
        "instant",
        "delayed",
        "instant_confirmed",
        "delayed_confirmed",
        "repeating_instant",
        "repeating_delayed",
        "24h",
        "fire",
        "fire_confirmed",
        "fire_instant",
        "panic_silent",
        "panic_audible",
        "flood",
        "gas",
        "report",
        "keybox",
        "siren_mute",
        "none",
        "none_no_tamper",
    }
)

REACTION_PATTERN: Final = (
    r"^(instant|delayed|instant_confirmed|delayed_confirmed|"
    r"repeating_instant|repeating_delayed|24h|fire|fire_confirmed|"
    r"fire_instant|panic_silent|panic_audible|flood|gas|report|"
    r"keybox|siren_mute|none|none_no_tamper)$"
)

# intrusion = Instant/Delay (cần armed). always/life = báo động không cần armed.
_ALWAYS_ALARM: Final[frozenset[str]] = frozenset(
    {
        "24h",
        "fire",
        "fire_confirmed",
        "fire_instant",
        "panic_silent",
        "panic_audible",
        "flood",
        "gas",
    }
)
_NO_ALARM: Final[frozenset[str]] = frozenset(
    {"report", "keybox", "siren_mute", "none", "none_no_tamper"}
)
_HID_PROTECTED: Final[frozenset[str]] = frozenset(
    {
        "24h",
        "fire",
        "fire_confirmed",
        "fire_instant",
        "panic_silent",
        "panic_audible",
        "flood",
        "gas",
        "siren_mute",
        "report",
        "keybox",
        "none",
        "none_no_tamper",
    }
)


def normalize_reaction(raw: str | None) -> str:
    value = (raw or "").strip().lower()
    if value in VALID_DEVICE_REACTIONS:
        return value
    return DEFAULT_DEVICE_REACTION


def reaction_alarms_when_disarmed(raw: str | None) -> bool:
    """24h / Fire / Panic / Flood / Gas — F-Link: section needn't be set."""
    return normalize_reaction(raw) in _ALWAYS_ALARM


def reaction_promotes_open(raw: str | None) -> bool:
    """ACT/Instant có thể thành Báo động (không gồm Report / Mute / None)."""
    return normalize_reaction(raw) not in _NO_ALARM


def hid_reaction_overrides(current: str | None, incoming: str | None) -> bool:
    """Delay/Repeat from 0x55 may replace Instant; never clobber 24h/Fire/Mute."""
    nxt = normalize_reaction(incoming)
    if not incoming or nxt not in VALID_DEVICE_REACTIONS:
        return False
    if nxt == DEFAULT_DEVICE_REACTION:
        return False
    cur = normalize_reaction(current)
    if cur == nxt:
        return False
    if cur in _HID_PROTECTED:
        return False
    return nxt in ("delayed", "repeating_instant", "repeating_delayed")
