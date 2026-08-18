"""Jablotron JA-100 USB/HID packet helpers (compatible with Link serial 16D6:0008).

Derived from the community JA-100 protocol (Home Assistant jablotron100 integration).
Binary packing matches kukulich/jablotron100: multi-byte little-endian.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum

STREAM_PACKET_SIZE = 64

PACKET_COMMAND = b"\x52"
PACKET_DEVICE_STATE = b"\x55"
PACKET_DEVICES_STATES = b"\xd8"
PACKET_SECTIONS_STATES = b"\x51"
PACKET_PG_OUTPUTS_STATES = b"\x50"
PACKET_UI_CONTROL = b"\x80"

COMMAND_HEARTBEAT = b"\x02"
COMMAND_GET_DEVICE_STATUS = b"\x0a"
COMMAND_GET_SECTIONS_AND_PG_OUTPUTS_STATES = b"\x0e"
COMMAND_ENABLE_DEVICE_STATE_PACKETS = b"\x13"
COMMAND_RESPONSE_DEVICE_STATUS = b"\x8a"

PACKET_GET_DEVICES_SECTIONS = b"\x3a"
PACKET_DEVICES_SECTIONS = b"\x3b"
PACKET_DIAGNOSTICS = b"\x94"
PACKET_DIAGNOSTICS_COMMAND = b"\x96"

UI_CONTROL_AUTHORISATION_END = b"\x01"
UI_CONTROL_AUTHORISATION_CODE = b"\x03"
UI_CONTROL_MODIFY_SECTION = b"\x0d"
# HA DeviceNumber: mobile app / USB appear as 0x55 authorization sources.
SYSTEM_DEVICE_MOBILE = 251
SYSTEM_DEVICE_USB = 254
SYSTEM_DEVICE_RESERVED_MIN = 240

# Base command byte + section_num (1-based). Verified by JA-Link captures.
SECTION_MODE_DISARM = 0x8F
SECTION_MODE_ARM_AWAY = 0x9F
SECTION_MODE_ARM_HOME = 0xAF

CODE_MIN_LENGTH = 4
CODE_MAX_LENGTH = 10
DEFAULT_AUTH_PREFIX = "999"

DEVICE_STATE_EVENT_MASK = 0x1F
DEVICE_STATE_FLAGS_MASK = 0xE0
# HA-verified flag — not an F-Link Disable column value.
DEVICE_STATE_FLAG_NO_REACTION_PARTIAL = 0x80
# F-Link Disable column bits in the 0x55 event-byte upper nibble (refined via capture).
DEVICE_STATE_FLAG_DISABLE_INPUT = 0x20  # yellow
DEVICE_STATE_FLAG_DISABLE_TAMPER = 0x40  # blue
# 0x20|0x40 and other remaining combos → full Device stop (red)
TIMEOUT_DEVICE_STATE_PACKETS_MIN = 5

# F-Link Status column mapping:
# OK → ok | ACT → open | TMP → tamper | Loss → loss | Error → fault | alarm → alarm
PROBLEM_DEVICE_STATES = frozenset({"tamper", "fault", "alarm", "loss"})

VALID_DEVICE_DISABLE = frozenset({"none", "input", "device", "tamper"})

# GET_DEVICE_STATUS (0x52/0x8a) byte[5] on PIR:
# F-Link ground truth (JA-110P addr 9):
#   type 0x04 + flag 0x10 / 0x01 → Disable Tamper; Status follows Instant (OK/ACT)
#   type 0x04 + flag 0x11       → Disable Tamper + cover open; Status OK (suppress Instant ACT)
#   type 0x14 + flag 0x10       → Disable empty; Status TMP
DEVICE_STATUS_DISABLE_DEVICE_BITS = 0x0B  # 0x01 | 0x02 | 0x08
DEVICE_STATUS_DISABLE_INPUT = 0x04
DEVICE_STATUS_DISABLE_TAMPER = 0x10
DEVICE_STATUS_FLAG_TMP = 0x10
# Cover-open sense while Tamper-bypass is active (type 0x04).
DEVICE_STATUS_FLAG_TAMPER_COVER_OPEN = 0x11

# F-Link Status column priority (higher wins for the single CMS state field).
# Loss outranks TMP: unreachable device supersedes a prior tamper report.
STATE_DISPLAY_RANK = {
    "ok": 0,
    "open": 1,
    "alarm": 2,
    "fault": 3,
    "tamper": 4,
    "loss": 5,
}


class DeviceStateEvent(IntEnum):
    INSTANT_ALARM = 0x00
    DELAYED_ALARM_A = 0x01
    DELAYED_ALARM_B = 0x02
    DELAYED_ALARM_C = 0x03
    ACTIVITY = 0x04
    POWER_SUPPLY_FAULT = 0x05
    SABOTAGE = 0x06  # F-Link TMP
    FAULT = 0x07
    REPEATED_ALARM = 0x08
    HEARTBEAT = 0x0F
    BATTERY_FAULT = 0x14


class SectionPrimaryState(IntEnum):
    DISARMED = 1
    ARMED_PARTIALLY = 2
    ARMED_FULL = 3


@dataclass
class ParsedUpdates:
    device_states: dict[int, str]
    section_states: dict[int, str]
    pg_states: dict[int, str]
    panel_armed: str | None
    # HID 0x51 keypad flash (HA triggered bits 3, 4, 9, 12, 13)
    section_triggered: dict[int, bool] = field(default_factory=dict)
    # device nums from 0x55 events — may clear TMP/fault even when activity bitmap says ok
    device_state_force: set[int] = field(default_factory=set)
    # Instant / Delayed / Repeated ON — used to promote sticky alarm while armed
    # (not plain ACTIVITY, not 0xd8 bitmap).
    device_alarm_events: set[int] = field(default_factory=set)
    # F-Link Disable: none|input|device|tamper (independent of runtime state)
    device_disable: dict[int, str] = field(default_factory=dict)
    # type-0x04 0x8a probes where TMP bit is clear → allow clearing sticky tamper
    device_tmp_clear: set[int] = field(default_factory=set)
    # address → section (1-based) from 0x3b
    device_sections: dict[int, int] = field(default_factory=dict)
    # address → 0x8a type/conn byte
    device_bus_types: dict[int, int] = field(default_factory=dict)
    # address → CMS device_type (pir/door/…)
    device_types: dict[int, str] = field(default_factory=dict)
    # address → unique SKU hint only (empty when HID cannot identify)
    device_models: dict[int, str] = field(default_factory=dict)
    # address → bus | rf from 0x8a packet length (HA: length 9 = wireless)
    device_links: dict[int, str] = field(default_factory=dict)
    # address → F-Link Reaction inferred from unique 0x55 events (Delay/Repeat)
    device_reactions: dict[int, str] = field(default_factory=dict)
    # 0x55 từ bàn phím / USB / app (không phải heartbeat) — user vừa nhập PIN.
    keypad_authorized: bool = False
    # 0x80 modify_section DISARM (tắt phân khu, kể cả khi đã disarmed).
    section_unset_cmds: set[int] = field(default_factory=set)


@dataclass
class InventoryHints:
    """Heuristic inventory from HID state packets (not full F-Link config)."""

    section_nums: list[int]
    device_count_hint: int | None
    pg_count_hint: int | None


def empty_updates() -> ParsedUpdates:
    return ParsedUpdates(
        device_states={},
        section_states={},
        pg_states={},
        panel_armed=None,
        section_triggered={},
        device_state_force=set(),
        device_alarm_events=set(),
        device_disable={},
        device_tmp_clear=set(),
        device_sections={},
        device_bus_types={},
        device_types={},
        device_models={},
        device_links={},
        device_reactions={},
        keypad_authorized=False,
        section_unset_cmds=set(),
    )


def merge_updates(base: ParsedUpdates, other: ParsedUpdates) -> ParsedUpdates:
    for device_num, state in other.device_states.items():
        current = base.device_states.get(device_num)
        forced = device_num in other.device_state_force
        # 0x8a cover-open (flag 0x11) forces Status OK + carries Disable.
        # Must NOT wipe Instant/ACTIVITY open in the same batch — otherwise
        # Dev_09 (disable=tamper) lần 1 never reaches promote → alarm / map focus.
        if (
            current == "open"
            and device_num in base.device_state_force
            and forced
            and state == "ok"
            and device_num in other.device_disable
        ):
            continue
        # Instant/ACTIVITY ACT in this batch — one-shot 0x05/0x14 Error must not
        # win. 24h trips often send POWER_SUPPLY_FAULT after Instant; F-Link
        # Status stays ACT (then CMS promotes Báo động), not Lỗi.
        if current == "open" and device_num in base.device_state_force and state == "fault":
            continue
        if current is None or should_replace_device_state(current, state, forced=forced):
            base.device_states[device_num] = state
            if forced:
                base.device_state_force.add(device_num)
    base.device_alarm_events.update(other.device_alarm_events)
    base.section_states.update(other.section_states)
    base.section_triggered.update(other.section_triggered)
    base.pg_states.update(other.pg_states)
    base.device_disable.update(other.device_disable)
    base.device_tmp_clear.update(other.device_tmp_clear)
    base.device_sections.update(other.device_sections)
    base.device_bus_types.update(other.device_bus_types)
    base.device_types.update(other.device_types)
    base.device_models.update(other.device_models)
    base.device_links.update(other.device_links)
    base.device_reactions.update(other.device_reactions)
    # Drop tmp_clear when a forced tamper just won for that address.
    for device_num, state in other.device_states.items():
        if state == "tamper" and device_num in other.device_state_force:
            base.device_tmp_clear.discard(device_num)
    if other.panel_armed is not None:
        base.panel_armed = other.panel_armed
    if other.keypad_authorized:
        base.keypad_authorized = True
    base.section_unset_cmds.update(other.section_unset_cmds)
    return base


def packet_sort_key(packet: bytes) -> int:
    """Apply activity bitmap, then alarms, then TMP/fault so F-Link priority wins."""
    ptype = packet[:1]
    if ptype == PACKET_DEVICES_STATES:
        return 0
    if ptype == PACKET_DEVICE_STATE:
        event = bytes_to_int(packet[2:3]) & DEVICE_STATE_EVENT_MASK if len(packet) > 2 else 0
        if event in (
            DeviceStateEvent.INSTANT_ALARM,
            DeviceStateEvent.DELAYED_ALARM_A,
            DeviceStateEvent.DELAYED_ALARM_B,
            DeviceStateEvent.DELAYED_ALARM_C,
            DeviceStateEvent.REPEATED_ALARM,
        ):
            return 1
        if event == DeviceStateEvent.ACTIVITY:
            return 2
        if event in (
            DeviceStateEvent.SABOTAGE,
            DeviceStateEvent.FAULT,
            DeviceStateEvent.POWER_SUPPLY_FAULT,
            DeviceStateEvent.BATTERY_FAULT,
        ):
            return 3
        return 2
    if ptype == PACKET_SECTIONS_STATES:
        return 4
    if ptype == PACKET_PG_OUTPUTS_STATES:
        return 5
    # GET_DEVICE_STATUS (0x8a) carries JA-110P TMP bit — apply after Instant/ACT.
    if (
        ptype == PACKET_COMMAND
        and len(packet) >= 3
        and packet[2:3] == COMMAND_RESPONSE_DEVICE_STATUS
    ):
        return 3
    return 9


def should_replace_device_state(
    current: str,
    new: str,
    *,
    forced: bool,
    clear_alarm: bool = False,
) -> bool:
    """Decide whether ``new`` should replace ``current`` (F-Link Status semantics)."""
    cur = current or "ok"
    nxt = new or "ok"
    if cur == nxt:
        return False
    # Sticky alarm while armed — Instant OFF / ACT / 0xd8 / one-shot Error
    # must not clear it. Disarm / PIN passes clear_alarm=True.
    # 24h: 0x55 0x05 after promote used to turn Báo động → Lỗi (mất snapshot).
    if cur == "alarm" and nxt in ("ok", "open", "fault"):
        return bool(clear_alarm)
    # Explicit OFF from 0x55 always clears — except do not clear Loss/TMP via
    # generic activity/ok from the 0xd8 bitmap (handled below).
    if forced and nxt == "ok":
        return True
    # Stale Error (fault) yields to live ACT/OK/alarm. F-Link shows ACT for an
    # open 24h/Instant contact — a one-shot POWER_SUPPLY_FAULT must not stick.
    # Real Error is re-applied in the same batch (0x55 0x05/0x14, sort after Instant).
    if cur == "fault" and nxt in ("ok", "open", "alarm"):
        return True
    # Activity bitmap must not wipe TMP / Loss.
    if not forced and cur in ("tamper", "loss") and nxt in ("ok", "open"):
        return False
    # Forced ACT/open must not wipe Loss/TMP either (0x55 ACTIVITY while Loss).
    if forced and nxt == "open" and cur in ("loss", "tamper"):
        return False
    # JA-110P is pulse: Instant ON can stick while 0xd8 already idle (bit off).
    # Allow bitmap OK to clear ACT so Status returns to OK like F-Link / DEV 1–8.
    if not forced and nxt == "ok" and cur == "open":
        return True
    # F-Link: Loss > TMP > fault > alarm > ACT > OK
    if STATE_DISPLAY_RANK.get(nxt, 0) < STATE_DISPLAY_RANK.get(cur, 0):
        return False
    return True


def inventory_hints_from_updates(updates: ParsedUpdates) -> InventoryHints:
    section_nums = sorted(updates.section_states.keys())
    device_nums = [n for n in updates.device_states if 1 <= n <= 99]
    pg_nums = [n for n in updates.pg_states if n >= 1]
    return InventoryHints(
        section_nums=section_nums,
        device_count_hint=max(device_nums) if device_nums else None,
        pg_count_hint=max(pg_nums) if pg_nums else None,
    )


def int_to_bytes(value: int) -> bytes:
    return bytes([value & 0xFF])


def bytes_to_int(data: bytes) -> int:
    """Little-endian integer (HA jablotron100 compatible)."""
    if not data:
        return 0
    return int.from_bytes(data, byteorder="little")


def create_packet(packet_type: bytes, data: bytes) -> bytes:
    return packet_type + int_to_bytes(len(data)) + data


def create_packet_command(command_type: bytes, data: bytes = b"") -> bytes:
    return create_packet(PACKET_COMMAND, command_type + data)


def pad_hid_packet(packet: bytes) -> bytes:
    return packet.ljust(STREAM_PACKET_SIZE, b"\x00")[:STREAM_PACKET_SIZE]


def strip_hid_report_id(data: bytes) -> bytes:
    if len(data) > STREAM_PACKET_SIZE and data[0] == 0:
        return bytes(data[1 : 1 + STREAM_PACKET_SIZE])
    return bytes(data[:STREAM_PACKET_SIZE])


def build_init_sequence() -> list[bytes]:
    return [
        create_packet_command(COMMAND_ENABLE_DEVICE_STATE_PACKETS, int_to_bytes(TIMEOUT_DEVICE_STATE_PACKETS_MIN)),
        create_packet_command(COMMAND_HEARTBEAT),
        create_packet_command(COMMAND_GET_SECTIONS_AND_PG_OUTPUTS_STATES),
    ]


def build_poll_sequence() -> list[bytes]:
    """HA keepalive idle path: heartbeat only (do not spam GET_SECTIONS)."""
    return [
        create_packet_command(COMMAND_HEARTBEAT),
    ]


def build_sections_poll_sequence() -> list[bytes]:
    return [
        create_packet_command(COMMAND_GET_SECTIONS_AND_PG_OUTPUTS_STATES),
    ]


def build_get_devices_sections_packet(from_device: int = 1, to_device: int = 99) -> bytes:
    """Request section assignment bitmap (HA: from..to inclusive)."""
    lo = max(1, min(99, int(from_device)))
    hi = max(lo, min(99, int(to_device)))
    return create_packet(PACKET_GET_DEVICES_SECTIONS, int_to_bytes(lo) + int_to_bytes(hi))


def build_get_device_status_packet(device_num: int) -> bytes:
    return create_packet_command(COMMAND_GET_DEVICE_STATUS, int_to_bytes(device_num))


DIAGNOSTICS_ON = b"\x01"
DIAGNOSTICS_OFF = b"\x00"
DIAGNOSTICS_COMMAND_GET_INFO = b"\x09"


def build_device_diagnostics_start(device_num: int) -> bytes:
    return create_packet(PACKET_DIAGNOSTICS, int_to_bytes(device_num) + DIAGNOSTICS_ON)


def build_device_diagnostics_force_info(device_num: int) -> bytes:
    return create_packet(
        PACKET_DIAGNOSTICS_COMMAND,
        int_to_bytes(device_num) + DIAGNOSTICS_COMMAND_GET_INFO + b"\x00",
    )


def build_device_diagnostics_end(device_num: int) -> bytes:
    return create_packet(PACKET_DIAGNOSTICS, int_to_bytes(device_num) + DIAGNOSTICS_OFF)


def create_packet_ui_control(control_type: bytes, data: bytes = b"") -> bytes:
    return create_packet(PACKET_UI_CONTROL, control_type + data)


def create_packet_authorisation_end() -> bytes:
    return create_packet_ui_control(UI_CONTROL_AUTHORISATION_END)


def create_packet_authorisation_code(code: str, prefix: str = DEFAULT_AUTH_PREFIX) -> bytes:
    """Build login packet (HA jablotron100 compatible).

    - ``1234`` → HA nibble/ASCII packing with leading ``999``
    - ``1*1234`` / ``0*1010`` → user-prefix form when F-Link “code with a prefix” is on
    """
    raw = (code or "").strip()
    magic_offset = 48

    if "*" in raw:
        # HA path for codes with asterisk (drop '*', left-pad to 8, encode digits as 0x30+n)
        padded = raw.rjust(8, "0")
        code_packet = b""
        for letter in padded:
            if letter == "*":
                continue
            if not letter.isdigit():
                raise ValueError("invalid_pin_code")
            code_packet += int_to_bytes(magic_offset + int(letter))
        return create_packet_ui_control(UI_CONTROL_AUTHORISATION_CODE, code_packet)

    pin = raw
    if not CODE_MIN_LENGTH <= len(pin) <= CODE_MAX_LENGTH or not pin.isdigit():
        raise ValueError("invalid_pin_code")

    # Exact HA packing for non-prefix codes (not plain ASCII for 5–10 digit PINs).
    _ = prefix  # HA always uses wire prefix 999 for this path
    code_packet = b"\x39\x39\x39"
    for i in range(0, 4):
        j = i + 4
        first_number = pin[j : j + 1] if j < len(pin) else ""
        second_number = pin[i : i + 1]
        if first_number == "":
            code_number = magic_offset + int(second_number)
        else:
            code_number = int(f"{first_number}{second_number}", 16)
        code_packet += int_to_bytes(code_number)
    return create_packet_ui_control(UI_CONTROL_AUTHORISATION_CODE, code_packet)


def build_device_stream_keepalive(code: str, *, prefix: str = DEFAULT_AUTH_PREFIX) -> list[bytes]:
    """Authorize + enable 0x55/0xd8 device-state stream (required on JA-100).

    Matches HA create_packets_keepalive: auth code + enable (no authorisation_end).
    """
    return [
        create_packet_authorisation_code(code, prefix=prefix),
        create_packet_command(
            COMMAND_ENABLE_DEVICE_STATE_PACKETS,
            int_to_bytes(TIMEOUT_DEVICE_STATE_PACKETS_MIN),
        ),
    ]


def create_packet_modify_section(section_num: int, action: str) -> bytes:
    """action: arm | disarm | partial"""
    if section_num < 1 or section_num > 32:
        raise ValueError("invalid_section_num")
    if action == "disarm":
        mode = SECTION_MODE_DISARM
    elif action == "partial":
        mode = SECTION_MODE_ARM_HOME
    elif action == "arm":
        mode = SECTION_MODE_ARM_AWAY
    else:
        raise ValueError("invalid_action")
    return create_packet_ui_control(UI_CONTROL_MODIFY_SECTION, int_to_bytes(mode + section_num))


def build_arm_sequence(
    action: str,
    code: str,
    section_nums: list[int],
    *,
    prefix: str = DEFAULT_AUTH_PREFIX,
) -> list[bytes]:
    """Authorize with PIN, modify section(s), logout, then refresh section states."""
    sections = section_nums or [1]
    packets = [
        create_packet_authorisation_end(),
        create_packet_authorisation_code(code, prefix=prefix),
    ]
    for section in sections:
        packets.append(create_packet_modify_section(section, action))
    packets.append(create_packet_authorisation_end())
    packets.append(create_packet_command(COMMAND_GET_SECTIONS_AND_PG_OUTPUTS_STATES))
    return packets


def is_login_error_packet(packet: bytes) -> bool:
    return (
        len(packet) >= 4
        and packet[:1] == PACKET_UI_CONTROL
        and packet[2:3] == b"\x1b"
        and packet[3:4] == b"\x03"
    )


def split_packets(raw: bytes) -> list[bytes]:
    packets: list[bytes] = []
    offset = 0
    while offset + 2 <= len(raw):
        packet_type = raw[offset : offset + 1]
        if packet_type == b"\x00":
            break
        length = bytes_to_int(raw[offset + 1 : offset + 2])
        end = offset + 2 + length
        if end > len(raw):
            break
        packets.append(raw[offset:end])
        offset = end
    return packets


def _device_on_off_state(device_num: int, state_byte: int) -> str | None:
    if device_num <= 37:
        high_offset = 0
    elif device_num <= 101:
        high_offset = -64
    elif device_num <= 165:
        high_offset = -128
    elif device_num <= 229:
        high_offset = -192
    else:
        high_offset = -256
    base = ((device_num + high_offset) * 4) + 104
    if state_byte in (base, base + 1):
        return "open"
    if state_byte in (base + 2, base + 3):
        return "ok"
    return None


def _event_to_state(event: int, on_off: str | None) -> str | None:
    """Map 0x55 event + ON/OFF byte. None = ignore packet (HA-compatible)."""
    if event == DeviceStateEvent.HEARTBEAT:
        return None
    # Unknown state byte → do not invent open/alarm (HA skips these).
    if on_off is None:
        return None
    # Instant / Delayed / Repeated zone reaction ON → F-Link Status ACT (open).
    # HA treats these the same as ACTIVITY (STATE_ON). CMS used to map them to
    # sticky "alarm", which made open contacts show "Báo động" forever.
    if event in (
        DeviceStateEvent.INSTANT_ALARM,
        DeviceStateEvent.DELAYED_ALARM_A,
        DeviceStateEvent.DELAYED_ALARM_B,
        DeviceStateEvent.DELAYED_ALARM_C,
        DeviceStateEvent.REPEATED_ALARM,
        DeviceStateEvent.ACTIVITY,
    ):
        return "ok" if on_off == "ok" else "open"
    if event == DeviceStateEvent.SABOTAGE:
        return "ok" if on_off == "ok" else "tamper"
    if event == DeviceStateEvent.FAULT:
        # F-Link "Loss" (communication / device unavailable)
        return "ok" if on_off == "ok" else "loss"
    if event in (
        DeviceStateEvent.POWER_SUPPLY_FAULT,
        DeviceStateEvent.BATTERY_FAULT,
    ):
        return "ok" if on_off == "ok" else "fault"
    return on_off


def _event_to_reaction(event: int, on_off: str | None) -> str | None:
    """Map unique 0x55 events → F-Link Reaction.

    Instant (0x00) is also used by 24 hours / Fire / Panic — do not infer Instant.
    Delay / Repeat events are unique to those reactions.
    """
    if on_off != "open":
        return None
    if event in (
        DeviceStateEvent.DELAYED_ALARM_A,
        DeviceStateEvent.DELAYED_ALARM_B,
        DeviceStateEvent.DELAYED_ALARM_C,
    ):
        return "delayed"
    if event == DeviceStateEvent.REPEATED_ALARM:
        return "repeating_instant"
    return None


def _bytes_to_binary(data: bytes) -> str:
    """HA-compatible: little-endian int → MSB-left binary string."""
    if not data:
        return ""
    return bin(bytes_to_int(data))[2:].zfill(len(data) * 8)


def _bytes_to_reverse_binary(data: bytes) -> str:
    return _bytes_to_binary(data)[::-1]


def _binary_to_int(bits: str) -> int:
    return int(bits, 2) if bits else 0


# HA jablotron100: concatenated MSB-left bits of the 2-byte section slot.
_SECTION_TRIGGER_BITS = (3, 4, 9, 12, 13)


def _parse_section_status(section_packet: bytes) -> tuple[str, bool] | None:
    """Return (armed_state, keypad_triggered) from one 0x51 section slot."""
    if section_packet[:2] == b"\x07\x00" or len(section_packet) < 2:
        return None
    bits = _bytes_to_binary(section_packet[:1]) + _bytes_to_binary(section_packet[1:2])
    if len(bits) < 8:
        return None
    try:
        state = SectionPrimaryState(_binary_to_int(bits[5:8]))
    except ValueError:
        return None
    if state == SectionPrimaryState.DISARMED:
        armed = "disarmed"
    elif state == SectionPrimaryState.ARMED_PARTIALLY:
        armed = "partial"
    elif state == SectionPrimaryState.ARMED_FULL:
        armed = "armed"
    else:
        return None
    triggered = any(i < len(bits) and bits[i] == "1" for i in _SECTION_TRIGGER_BITS)
    return armed, triggered


def _section_armed_state(section_packet: bytes) -> str | None:
    parsed = _parse_section_status(section_packet)
    return None if parsed is None else parsed[0]


def is_device_state_heartbeat(packet: bytes) -> bool:
    """HA: 0x55 heartbeat is event 0x0F or raw byte 0x33 — not a PIN."""
    if packet[:1] != PACKET_DEVICE_STATE or len(packet) < 3:
        return False
    event_byte = bytes_to_int(packet[2:3])
    return event_byte == 0x33 or (event_byte & DEVICE_STATE_EVENT_MASK) == int(
        DeviceStateEvent.HEARTBEAT
    )


def _parse_device_number(packet: bytes) -> int:
    if len(packet) < 6:
        return bytes_to_int(packet[2:3]) if len(packet) > 2 else 0
    packet_binary = _bytes_to_binary(packet[4:6])
    return _binary_to_int(packet_binary[2:10])


def flags_to_disable(flags: int) -> str | None:
    """0x55 upper flags are NOT a reliable F-Link Disable source — ignore.

    Disable is read from GET_DEVICE_STATUS (0x8a) only.
    """
    _ = flags
    return None


def device_link_from_status_packet(packet: bytes) -> str:
    """Bus vs RF from GET_DEVICE_STATUS length (HA jablotron100).

    Length byte == 9 → wireless (RF); otherwise wired (bus).
    """
    if not packet or len(packet) < 2:
        return ""
    return "rf" if bytes_to_int(packet[1:2]) == 9 else "bus"


def bus_type_to_device_info(type_byte: int) -> tuple[str, str]:
    """Map GET_DEVICE_STATUS type/conn byte → (CMS family, unique SKU or '').

    Byte 0x04 is shared by PIR / JA-110A / JA-114E / JA-111R — never invent a SKU.
    JA-118M (0x0C/0x0E) is the only unique SKU hint from live captures.
    """
    t = int(type_byte) & 0xFF
    low = t & 0x0F
    if t in (0x0C, 0x0E):
        return "door", "JA-118M"
    if t == 0x14:
        return "pir", ""
    if low == 0x04:
        return "sensor", ""
    if low in (0x01, 0x02, 0x03):
        return "keypad", ""
    if low == 0x05:
        return "smoke", ""
    if low == 0x06:
        return "siren", ""
    if low == 0x07:
        return "glass", ""
    return "sensor", ""


def _apply_device_identity(
    out: ParsedUpdates, device_num: int, packet: bytes, type_byte: int
) -> None:
    cms_type, model = bus_type_to_device_info(type_byte)
    out.device_bus_types[device_num] = type_byte
    out.device_types[device_num] = cms_type
    out.device_models[device_num] = model
    out.device_links[device_num] = device_link_from_status_packet(packet)


def parse_devices_sections_packet(packet: bytes) -> dict[int, int]:
    """Parse 0x3b → {device_num: section_num} (HA jablotron100 compatible).

    Each payload byte holds two 4-bit section indexes (0-based); section = nibble + 1.
    Nibble order per byte: high then low (offsets 4, then 0 in MSB-left bit string).
    """
    out: dict[int, int] = {}
    if not packet or packet[:1] != PACKET_DEVICES_SECTIONS or len(packet) < 4:
        return out
    device_number = 0
    for packet_offset in range(3, len(packet)):
        sections_bits = _bytes_to_binary(packet[packet_offset : packet_offset + 1])
        for device_offset in (4, 0):
            device_number += 1
            if device_number > 99:
                return out
            nibble = sections_bits[device_offset : device_offset + 4]
            section = _binary_to_int(nibble) + 1
            if 1 <= section <= 32:
                out[device_number] = section
    return out


def device_status_flags_to_disable(flag_byte: int, *, type_byte: int = 0x04) -> str:
    """Map GET_DEVICE_STATUS (0x52/0x8a) → F-Link Disable column.

    JA-110P live captures:
      type 0x04 + flag 0x11/0x10/0x01 → Disable Tamper
      type 0x14 + flag 0x10 → Disable empty (Status TMP via type, not Disable)
      flag 0x02/0x08 → Device
      flag 0x04 → Input
    """
    v = int(flag_byte) & 0xFF
    if v == 0:
        return "none"
    if v == DEVICE_STATUS_FLAG_TMP and type_byte == 0x14:
        return "none"
    if v in (
        DEVICE_STATUS_FLAG_TAMPER_COVER_OPEN,
        DEVICE_STATUS_DISABLE_TAMPER,
    ) and (type_byte & 0x0F) == 0x04:
        return "tamper"
    if v == 0x01:
        return "tamper"
    if v in (0x02, 0x08):
        return "device"
    if v == DEVICE_STATUS_DISABLE_INPUT:
        return "input"
    return "none"


def flink_status_from_state_disable(
    state: str,
    disable: str,
    *,
    cover_open_tmp: bool = False,
) -> str:
    """F-Link Status with Disable Tamper.

    - TMP → OK
    - Instant ACT while cover open (0x8a flag 0x11) → OK
    - Real Instant ACT after cover closed (flag 0x10/0x01) → ACT
    """
    st = (state or "ok").lower()
    bypass = (disable or "none").lower()
    if bypass == "tamper":
        if st == "tamper":
            return "ok"
        if st == "open" and cover_open_tmp:
            return "ok"
    return st


def parse_packet(packet: bytes) -> ParsedUpdates:
    out = empty_updates()
    if not packet:
        return out

    ptype = packet[:1]
    if ptype == PACKET_DEVICE_STATE and len(packet) >= 4:
        device_num = _parse_device_number(packet)
        if device_num >= 240 or device_num == 0:
            return out
        event_byte = bytes_to_int(packet[2:3])
        event_val = event_byte & DEVICE_STATE_EVENT_MASK
        # Do not derive Disable from 0x55 — use 0x8a only (avoids false Tamper/Input).

        state_byte = bytes_to_int(packet[3:4])
        on_off = _device_on_off_state(device_num, state_byte)
        mapped = _event_to_state(event_val, on_off)
        if mapped is None:
            return out
        out.device_states[device_num] = mapped
        out.device_state_force.add(device_num)
        hid_reaction = _event_to_reaction(event_val, on_off)
        if hid_reaction:
            out.device_reactions[device_num] = hid_reaction
        if (
            mapped == "open"
            and event_val
            in (
                DeviceStateEvent.INSTANT_ALARM,
                DeviceStateEvent.DELAYED_ALARM_A,
                DeviceStateEvent.DELAYED_ALARM_B,
                DeviceStateEvent.DELAYED_ALARM_C,
                DeviceStateEvent.REPEATED_ALARM,
            )
        ):
            out.device_alarm_events.add(device_num)

    elif (
        ptype == PACKET_COMMAND
        and len(packet) >= 6
        and packet[2:3] == COMMAND_RESPONSE_DEVICE_STATUS
    ):
        # 52 | len | 8a | device_num | type/conn | status_flags | ...
        device_num = bytes_to_int(packet[3:4])
        if 1 <= device_num <= 99:
            type_byte = bytes_to_int(packet[4:5])
            flag_byte = bytes_to_int(packet[5:6])
            if type_byte == 0x14:
                # Disable empty + physical TMP (JA-110P cover open).
                out.device_disable[device_num] = "none"
                _apply_device_identity(out, device_num, packet, type_byte)
                if flag_byte & DEVICE_STATUS_FLAG_TMP:
                    out.device_states[device_num] = "tamper"
                    out.device_state_force.add(device_num)
                else:
                    out.device_tmp_clear.add(device_num)
            elif type_byte == 0x04 or (type_byte & 0x0F) == 0x04:
                bypass = device_status_flags_to_disable(flag_byte, type_byte=type_byte)
                out.device_disable[device_num] = bypass
                _apply_device_identity(out, device_num, packet, type_byte)
                if flag_byte == DEVICE_STATUS_FLAG_TAMPER_COVER_OPEN:
                    # Cover open + Tamper bypass: F-Link Status OK; Instant ACT is false.
                    out.device_states[device_num] = "ok"
                    out.device_state_force.add(device_num)
                else:
                    # 0x10/0x01 = Tamper bypass with cover closed → Instant ACT is real.
                    out.device_tmp_clear.add(device_num)
            else:
                out.device_disable[device_num] = device_status_flags_to_disable(
                    flag_byte, type_byte=type_byte
                )
                _apply_device_identity(out, device_num, packet, type_byte)

    elif ptype == PACKET_DEVICES_SECTIONS and len(packet) >= 4:
        out.device_sections.update(parse_devices_sections_packet(packet))

    elif ptype == PACKET_DEVICES_STATES and len(packet) >= 3:
        # HA: length at [1], payload at [2:2+len], skip first payload byte, reverse bits.
        length = bytes_to_int(packet[1:2])
        start = 3
        end = min(len(packet), 2 + length)
        if end > start:
            bits = _bytes_to_reverse_binary(packet[start:end])
            for idx, bit in enumerate(bits):
                if idx == 0:
                    continue  # central unit
                if idx > 99:
                    break
                out.device_states[idx] = "open" if bit == "1" else "ok"

    elif ptype == PACKET_SECTIONS_STATES:
        armed_counts = {"disarmed": 0, "partial": 0, "armed": 0}
        for section in range(1, 16):
            off = section * 2
            if off + 2 > len(packet):
                break
            chunk = packet[off : off + 2]
            parsed = _parse_section_status(chunk)
            if parsed is None:
                break
            armed, triggered = parsed
            out.section_states[section] = armed
            out.section_triggered[section] = triggered
            armed_counts[armed] = armed_counts.get(armed, 0) + 1
        if armed_counts["armed"] and not armed_counts["partial"] and not armed_counts["disarmed"]:
            out.panel_armed = "armed"
        elif (
            armed_counts["disarmed"]
            and not armed_counts["partial"]
            and not armed_counts["armed"]
        ):
            out.panel_armed = "disarmed"
        elif armed_counts["armed"] or armed_counts["partial"] or armed_counts["disarmed"]:
            # Mix of section states → partial (never treat "any disarmed" as whole-panel off)
            out.panel_armed = "partial"

    elif (
        ptype == PACKET_UI_CONTROL
        and len(packet) >= 4
        and packet[2:3] == UI_CONTROL_MODIFY_SECTION
    ):
        raw = bytes_to_int(packet[3:4])
        section = raw - SECTION_MODE_DISARM
        if 1 <= section <= 15:
            out.section_unset_cmds.add(section)

    elif ptype == PACKET_PG_OUTPUTS_STATES and len(packet) >= 3:
        length = bytes_to_int(packet[1:2])
        start = 2
        end = min(len(packet), start + length)
        if end > start:
            bits = _bytes_to_reverse_binary(packet[start:end])
            for idx, bit in enumerate(bits):
                pg_num = idx + 1
                out.pg_states[pg_num] = "on" if bit == "1" else "off"

    return out
