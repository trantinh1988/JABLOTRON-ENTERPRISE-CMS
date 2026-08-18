"""Diagnose HID packet mix via running CMS USB session is not possible;
sample by briefly taking the device — DO NOT run while CMS holds HID.

Instead dump packet-type histogram by asking backend sync repeatedly is better.
This script uses the protocol helpers against an open path ONLY if --steal.
"""
from __future__ import annotations

import asyncio
import sys
import time
from collections import Counter

sys.path.insert(0, r"E:\JABLOTRON-ENTERPRISE-CMS\backend")

from app.iot_core.jablotron_protocol import (  # noqa: E402
    build_device_stream_keepalive,
    build_poll_sequence,
    pad_hid_packet,
    parse_packet,
    split_packets,
    strip_hid_report_id,
)

try:
    import hid
except Exception as exc:  # noqa: BLE001
    print("no hid", exc)
    raise SystemExit(1)


def main() -> None:
    code = sys.argv[1] if len(sys.argv) > 1 else "1234"
    vids = hid.enumerate(0x16D6, 0x0008)
    print("found", len(vids))
    if not vids:
        return
    # Cannot open if CMS holds exclusive — expect fail
    d = hid.device()
    try:
        d.open_path(vids[0]["path"])
    except Exception as e:
        print("OPEN_FAIL (CMS probably holds device):", e)
        return

    def write(pkt: bytes) -> None:
        padded = pad_hid_packet(pkt)
        try:
            d.write(b"\x00" + padded)
        except Exception:
            d.write(padded)

    for pkt in build_device_stream_keepalive(code):
        write(pkt)
        time.sleep(0.08)
        print("TX", pkt.hex())

    counts: Counter[str] = Counter()
    device_hits: Counter[int] = Counter()
    samples: list[str] = []
    t0 = time.time()
    while time.time() - t0 < 6.0:
        for pkt in build_poll_sequence():
            write(pkt)
            time.sleep(0.02)
        raw = d.read(64, timeout_ms=80)
        if not raw:
            continue
        for packet in split_packets(strip_hid_report_id(bytes(raw))):
            ptype = f"0x{packet[0]:02x}"
            counts[ptype] += 1
            if len(samples) < 40:
                samples.append(packet.hex())
            upd = parse_packet(packet)
            for n in upd.device_states:
                device_hits[n] += 1

    print("counts", dict(counts))
    print("device_hits", dict(device_hits))
    print("samples:")
    for s in samples:
        print(s)
    d.close()


if __name__ == "__main__":
    main()
