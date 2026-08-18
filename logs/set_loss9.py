import sqlite3

c = sqlite3.connect(r"E:\JABLOTRON-ENTERPRISE-CMS\backend\data\cms.db")
c.execute("update devices set state=? where global_id=?", ("loss", "PANEL_1_DEV_09"))
c.commit()
print(c.execute("select global_id, state from devices where global_id=?", ("PANEL_1_DEV_09",)).fetchall())
