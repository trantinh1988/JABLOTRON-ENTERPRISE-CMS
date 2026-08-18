import sqlite3

c = sqlite3.connect(r"E:\JABLOTRON-ENTERPRISE-CMS\backend\data\cms.db")
print("panels", c.execute("select panel_id, length(stream_code), stream_code, armed_state from panels").fetchall())
print(
    "devs",
    c.execute(
        "select device_num, state from devices where panel_id=? order by device_num",
        ("PANEL_1",),
    ).fetchall(),
)
