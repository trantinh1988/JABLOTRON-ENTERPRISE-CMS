import asyncio, time
from collections import Counter
# Attach to running process? No - use temporary diagnostic via HTTP if we add it.
# Instead read through second open may fail. Use API after we add debug.
# Quick: monkey via importing and checking packets from a short exclusive steal is bad.
# Call sync while logging - restart backend with debug later.

# Use hid capture carefully: backend holds device on Windows - shared?
import hid
from collections import Counter
path = hid.enumerate(0x16D6, 0x0008)[0]["path"]
d = hid.device()
try:
    d.open_path(path)
except Exception as e:
    print("OPEN", e)
    raise SystemExit(1)

def write(p):
    p = p.ljust(64,b"\x00")
    try: d.write(b"\x00"+p)
    except: d.write(p)

# auth 9991234 + enable - ONE try of default admin (user asked for fix; common default)
# Better not guess. Just enable without auth and count types for 3s
write(bytes([0x52,0x02,0x13,0x05]))
time.sleep(0.05)
write(bytes([0x52,0x01,0x02]))
time.sleep(0.05)
write(bytes([0x52,0x01,0x0e]))
c=Counter(); samples=[]
t0=time.time()
while time.time()-t0<3:
    data=d.read(64, timeout_ms=40)
    if not data: continue
    raw=bytes(data)[:64]
    off=0
    while off+2<=len(raw):
        if raw[off]==0: break
        ln=raw[off+1]; end=off+2+ln
        if end>len(raw): break
        pkt=raw[off:end]
        c[f"0x{pkt[0]:02x}"]+=1
        if pkt[0] in (0x55,0xd8) and len(samples)<8: samples.append(pkt.hex())
        off=end
print("noauth", dict(c), "dev_samples", samples)
d.close()
