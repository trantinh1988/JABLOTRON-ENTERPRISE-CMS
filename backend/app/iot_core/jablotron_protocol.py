"""Jablotron JA-100 USB/HID packet helpers (compatible with Link serial 16D6:0008).

Derived from the community JA-100 protocol (Home Assistant jablotron100 integration).
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

STREAM_PACKET_SIZE = 64

PACKET_COMMAND = b"\x52"
PACKET_DEVICE_STATE = b"\x55"
PACKET_DEVICES_STATES = b"\xd8"
PACKET_SECTIONS_STATES = b"\x51"
PACKET_PG_OUTPUTS_STATES = b"\x50"

COMMAND_HEARTBEAT = b"\x02"
COMMAND_GET_SECTIONS_AND_PG_OUTPUTS_STATES = b"\x0e"
COMMAND_ENABLE_DEVICE_STATE_PACKETS = b"\x13"

DEVICE_STATE_EVENT_MASK = 0x1F
TIMEOUT_DEVICE_STATE_PACKETS_MIN = 5


class DeviceStateEvent(IntEnum):
    INSTANT_ALARM = 0x00
    DELAYED_ALARM_A = 0x01
    DELAYED_ALARM_B = 0x02
    DELAYED_ALARM_C = 0x03
    ACTIVITY = 0x04
    HEARTBEAT = 0x0F


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


def int_to_bytes(value: int) -> bytes:
    return bytes([value & 0xFF])


def bytes_to_int(data: bytes) -> int:
    return data[0] if data else 0


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
    return [
        create_packet_command(COMMAND_HEARTBEAT),
        create_packet_command(COMMAND_GET_SECTIONS_AND_PG_OUTPUTS_STATES),
    ]


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


def _event_to_state(event: int, on_off: str | None) -> str:
    if event in (
        DeviceStateEvent.INSTANT_ALARM,
        DeviceStateEvent.DELAYED_ALARM_A,
        DeviceStateEvent.DELAYED_ALARM_B,
        DeviceStateEvent.DELAYED_ALARM_C,
    ):
        return "alarm"
    if event == DeviceStateEvent.ACTIVITY:
        return "open"
    if on_off == "open":
        return "open"
    if on_off == "ok":
        return "ok"
    return "ok"


def _bytes_to_reverse_binary(data: bytes) -> str:
    bits = "".join(f"{b:08b}" for b in data)
    return bits[::-1]


def _section_armed_state(section_packet: bytes) -> str | None:
    if section_packet == b"\x07\x00":
        return None
    primary = bytes_to_int(section_packet[:1]) & 0x07
    try:
        state = SectionPrimaryState(primary)
    except ValueError:
        return None
    if state == SectionPrimaryState.DISARMED:
        return "disarmed"
    if state == SectionPrimaryState.ARMED_PARTIALLY:
        return "partial"
    if state == SectionPrimaryState.ARMED_FULL:
        return "armed"
    return None


def _bytes_to_binary(data: bytes) -> str:
    return "".join(f"{b:08b}" for b in data)


def _binary_to_int(bits: str) -> int:
    return int(bits, 2) if bits else 0


def _parse_device_number(packet: bytes) -> int:
    if len(packet) < 6:
        return bytes_to_int(packet[2:3]) if len(packet) > 2 else 0
    packet_binary = _bytes_to_binary(packet[4:6])
    return _binary_to_int(packet_binary[2:10])


def parse_packet(packet: bytes) -> ParsedUpdates:
    out = ParsedUpdates(device_states={}, section_states={}, pg_states={}, panel_armed=None)
    if not packet:
        return out

    ptype = packet[:1]
    if ptype == PACKET_DEVICE_STATE and len(packet) >= 4:
        device_num = _parse_device_number(packet)
        if device_num >= 240 or device_num == 0:
            return out
        event_val = bytes_to_int(packet[2:3]) & DEVICE_STATE_EVENT_MASK
        state_byte = bytes_to_int(packet[3:4])
        on_off = _device_on_off_state(device_num, state_byte)
        out.device_states[device_num] = _event_to_state(event_val, on_off)

    elif ptype == PACKET_DEVICES_STATES and len(packet) >= 3:
        length = bytes_to_int(packet[1:2])
        start = 3
        end = min(len(packet), 2 + length)
        if end > start:
            bits = _bytes_to_reverse_binary(packet[start:end])
            for idx, bit in enumerate(bits):
                if idx == 0:
                    continue
                if bit == "1":
                    out.device_states[idx] = "open"
                else:
                    out.device_states[idx] = "ok"

    elif ptype == PACKET_SECTIONS_STATES:
        armed_counts = {"disarmed": 0, "partial": 0, "armed": 0}
        for section in range(1, 16):
            off = section * 2
            if off + 2 > len(packet):
                break
            chunk = packet[off : off + 2]
            armed = _section_armed_state(chunk)
            if armed is None:
                break
            out.section_states[section] = armed
            armed_counts[armed] = armed_counts.get(armed, 0) + 1
        if armed_counts["armed"] and not armed_counts["partial"] and not armed_counts["disarmed"]:
            out.panel_armed = "armed"
        elif armed_counts["partial"]:
            out.panel_armed = "partial"
        elif armed_counts["disarmed"]:
            out.panel_armed = "disarmed"

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
