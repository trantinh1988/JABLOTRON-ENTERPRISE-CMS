import json
import urllib.request

BASE = "http://127.0.0.1:8010"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read().decode())


def post(path):
    req = urllib.request.Request(BASE + path, method="POST", data=b"")
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


print("=== before ===")
for d in get("/api/devices"):
    if d["global_id"].endswith(("_DEV_08", "_DEV_09", "_DEV_10")):
        print({k: d.get(k) for k in ("global_id", "state", "disable")})

panels = get("/api/panels")
print("=== panels ===")
for p in panels:
    print(
        {
            k: p.get(k)
            for k in (
                "panel_id",
                "connection",
                "has_stream_code",
                "device_stream_ok",
                "armed_state",
            )
        }
    )

print("=== sync ===")
try:
    sync = post("/api/panels/PANEL_1/sync-devices")
    keys = [
        "ok",
        "error",
        "synced",
        "hid_device_updates",
        "matched_declared",
        "has_stream_code",
        "device_stream_ok",
        "needs_stream_code",
        "packet_types",
        "disable_probe",
        "states",
        "disables",
        "hid_device_nums",
        "last_55_by_device",
        "recent_device_packets",
    ]
    out = {k: sync.get(k) for k in keys if k in sync}
    print(json.dumps(out, ensure_ascii=True, indent=2)[:8000])
except Exception as e:
    print("SYNC FAIL", e)
    if hasattr(e, "read"):
        print(e.read().decode())

print("=== after ===")
for d in get("/api/devices"):
    if d["global_id"].endswith(("_DEV_08", "_DEV_09", "_DEV_10")):
        print({k: d.get(k) for k in ("global_id", "state", "disable")})
