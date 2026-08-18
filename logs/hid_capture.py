import hid, time
from collections import Counter

VID, PID = 0x16D6, 0x0008
devs = hid.enumerate(VID, PID)
print("found", len(devs))
if not devs:
    raise SystemExit(1)
path = devs[0]["path"]
print("path", path)

d = hid.device()
try:
    d.open_path(path)
except Exception as e:
    print("OPEN_FAIL", e)
    raise SystemExit(2)

def pkt_type(b):
    return f"0x{b[0]:02x}" if b else "empty"

# enable device states like CMS
def write_cmd(payload):
    # payload already packet
    padded = payload.ljust(64, b"\x00")[:64]
    try:
        d.write(b"\x00" + padded)
    except Exception:
        d.write(padded)

# 0x52 cmd enable 0x13 timeout 5; heartbeat 0x02; get sections 0x0e
write_cmd(bytes([0x52, 0x02, 0x13, 0x05]))
time.sleep(0.05)
write_cmd(bytes([0x52, 0x01, 0x02]))
time.sleep(0.05)
write_cmd(bytes([0x52, 0x01, 0x0e]))
time.sleep(0.1)

counts = Counter()
samples = []
t0 = time.time()
while time.time() - t0 < 4.0:
    data = d.read(64, timeout_ms=50)
    if not data:
        continue
    raw = bytes(data)
    if len(raw) > 64 and raw[0] == 0:
        raw = raw[1:65]
    else:
        raw = raw[:64]
    # split
    off = 0
    while off + 2 <= len(raw):
        if raw[off] == 0:
            break
        ln = raw[off+1]
        end = off + 2 + ln
        if end > len(raw):
            break
        pkt = raw[off:end]
        counts[pkt_type(pkt)] += 1
        if len(samples) < 30:
            samples.append(pkt.hex())
        off = end

print("counts", dict(counts))
print("samples:")
for s in samples[:20]:
    print(s)
d.close()
