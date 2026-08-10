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
