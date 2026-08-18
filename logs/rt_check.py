import asyncio, json, time, urllib.request
from datetime import datetime, timezone

def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.loads(r.read().decode())

# sample states twice with delay
s1 = {d["global_id"]: d["state"] for d in get("http://127.0.0.1:8010/api/devices")}
p1 = get("http://127.0.0.1:8010/api/panels")[0]
print("t0 last_seen", p1.get("last_seen_at"), "states", s1)
time.sleep(3)
s2 = {d["global_id"]: d["state"] for d in get("http://127.0.0.1:8010/api/devices")}
p2 = get("http://127.0.0.1:8010/api/panels")[0]
print("t1 last_seen", p2.get("last_seen_at"), "states", s2)
print("last_seen_changed", p1.get("last_seen_at") != p2.get("last_seen_at"))
print("states_changed", s1 != s2)
diff = {k: (s1[k], s2[k]) for k in s1 if s1[k] != s2[k]}
print("diff", diff)

# sync and see result
req = urllib.request.Request("http://127.0.0.1:8010/api/panels/PANEL_1/sync-devices", method="POST")
with urllib.request.urlopen(req, timeout=30) as r:
    sync = json.loads(r.read().decode())
print("sync", {k: sync.get(k) for k in ("ok","synced","hid_device_updates","hid_device_nums","matched_declared")})
