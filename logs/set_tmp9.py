import sqlite3
import time
import json
import urllib.request

db = r"E:\JABLOTRON-ENTERPRISE-CMS\backend\data\cms.db"
c = sqlite3.connect(db)
c.execute(
    "UPDATE devices SET state=?, disable=? WHERE global_id=?",
    ("tamper", "none", "PANEL_1_DEV_09"),
)
c.commit()
print("db", c.execute(
    "SELECT global_id, state, disable FROM devices WHERE global_id='PANEL_1_DEV_09'"
).fetchall())
c.close()

# touch for reload
path = r"E:\JABLOTRON-ENTERPRISE-CMS\backend\app\iot_core\usb_manager.py"
with open(path, "ab") as f:
    pass

time.sleep(5)
with urllib.request.urlopen("http://127.0.0.1:8010/api/devices", timeout=8) as r:
    devices = json.loads(r.read().decode())
for d in devices:
    if d["global_id"].endswith(("_DEV_07", "_DEV_08", "_DEV_09", "_DEV_10")):
        print(d["global_id"], d["state"], d.get("disable"))
