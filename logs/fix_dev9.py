import sqlite3

c = sqlite3.connect(r"E:\JABLOTRON-ENTERPRISE-CMS\backend\data\cms.db")
print("tables", c.execute("select name from sqlite_master where type='table'").fetchall())
print("info", c.execute("pragma table_info(devices)").fetchall())
rows = c.execute("select * from devices").fetchall()
print("n", len(rows))
if rows:
    cols = [d[1] for d in c.execute("pragma table_info(devices)").fetchall()]
    print("cols", cols)
    for r in rows:
        d = dict(zip(cols, r))
        if "09" in str(d.get("global_id", "")) or d.get("address") == 9 or d.get("device_num") == 9:
            print("dev9", d)
