"""Diagnose why TMP is overwritten by ACT for device 9."""
from app.iot_core.jablotron_protocol import should_replace_device_state, parse_packet

# Instant ON for device 9 must NOT wipe tamper
assert should_replace_device_state("tamper", "open", forced=True) is False
assert should_replace_device_state("tamper", "open", forced=False) is False
assert should_replace_device_state("tamper", "ok", forced=False) is False
assert should_replace_device_state("tamper", "ok", forced=True) is True  # SABOTAGE OFF
assert should_replace_device_state("ok", "tamper", forced=True) is True
assert should_replace_device_state("open", "tamper", forced=True) is True

# Live Instant packet previously captured
pkt = bytes.fromhex("5508008d40024044e909")
parsed = parse_packet(pkt)
print("instant_pkt", parsed.device_states, "force", parsed.device_state_force)

# Sabotage ON device 9: event 0x06, on = 9*4+104 = 140 = 0x8c
sab = bytes([0x55, 0x0A, 0x06, 0x8C, 0x40, 0x02])
print("sabotage", parse_packet(sab).device_states)

print("should_replace ok")
