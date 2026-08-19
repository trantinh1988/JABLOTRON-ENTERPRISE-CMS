"""Full CMS backup archive — SQLite + map media + workstation files."""

from __future__ import annotations

import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from app.iot_core import system_backup as bak


def _make_db(path: Path) -> None:
    con = sqlite3.connect(path)
    try:
        con.execute("CREATE TABLE floor_maps (id INTEGER PRIMARY KEY, name TEXT)")
        con.execute("CREATE TABLE devices (id INTEGER PRIMARY KEY, label TEXT, map_id INTEGER)")
        con.execute("CREATE TABLE panels (id INTEGER PRIMARY KEY, panel_id TEXT)")
        con.execute("INSERT INTO floor_maps (name) VALUES ('Tầng 1')")
        con.execute("INSERT INTO devices (label, map_id) VALUES ('PIR cửa', 1)")
        con.execute("INSERT INTO panels (panel_id) VALUES ('PANEL_1')")
        con.commit()
    finally:
        con.close()


def _seed(root: Path, db_path: Path) -> None:
    _make_db(db_path)
    maps = root / "map_backgrounds"
    maps.mkdir(parents=True)
    (maps / "floor1.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"map")
    sounds = root / "alert_sounds"
    sounds.mkdir()
    (sounds / "manifest.json").write_text(
        json.dumps({"sound_enabled": True, "trail_enabled": True, "site_title": "Site A", "sounds": {}}),
        encoding="utf-8",
    )
    (root / "acked_always.json").write_text('{"PANEL_1": [1]}', encoding="utf-8")
    (root / "camera.key").write_bytes(b"secret-key")
    (root / "host_ports.json").write_text('{"ui_port": 8080, "api_port": 8010}', encoding="utf-8")


def test_roundtrip_includes_maps(tmp_path: Path):
    src = tmp_path / "src"
    src.mkdir()
    db = src / "cms.db"
    _seed(src, db)
    zip_path = tmp_path / "backup.zip"
    manifest = bak.build_archive(zip_path, root=src, db_path=db)
    assert manifest["format"] == bak.FORMAT_ID
    assert manifest["contents"]["maps"] == 1
    assert manifest["contents"]["map_backgrounds"] == 1
    assert manifest["contents"]["devices"] == 1
    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
    assert "cms.db" in names
    assert "media/map_backgrounds/floor1.png" in names
    assert "files/camera.key" in names
    assert "files/host_ports.json" in names

    dest = tmp_path / "dest"
    dest.mkdir()
    dest_db = dest / "cms.db"
    _make_db(dest_db)
    con = sqlite3.connect(dest_db)
    con.execute("UPDATE floor_maps SET name='Khác'")
    con.execute("DELETE FROM devices")
    con.commit()
    con.close()
    (dest / "map_backgrounds").mkdir()
    (dest / "map_backgrounds" / "stale.jpg").write_bytes(b"old")
    (dest / "host_ports.json").write_text('{"ui_port": 9090, "api_port": 8011}', encoding="utf-8")

    restored = bak.restore_archive(zip_path, root=dest, db_path=dest_db)
    assert restored["maps"] == 1
    assert restored["map_backgrounds"] == 1
    assert restored["devices"] == 1
    con = sqlite3.connect(dest_db)
    assert con.execute("SELECT name FROM floor_maps").fetchone()[0] == "Tầng 1"
    assert con.execute("SELECT label FROM devices").fetchone()[0] == "PIR cửa"
    con.close()
    assert (dest / "map_backgrounds" / "floor1.png").read_bytes().endswith(b"map")
    assert not (dest / "map_backgrounds" / "stale.jpg").exists()
    assert (dest / "camera.key").read_bytes() == b"secret-key"
    assert (dest / "acked_always.json").read_text(encoding="utf-8") == '{"PANEL_1": [1]}'
    assert json.loads((dest / "host_ports.json").read_text(encoding="utf-8"))["ui_port"] == 9090


def test_reject_plain_zip(tmp_path: Path):
    path = tmp_path / "other.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("readme.txt", "hello")
    with pytest.raises(bak.BackupError, match="not_backup"):
        bak.read_manifest(path)


def test_reject_path_traversal(tmp_path: Path):
    path = tmp_path / "evil.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(
            "manifest.json",
            json.dumps({"format": bak.FORMAT_ID, "version": 1}),
        )
        zf.writestr("cms.db", b"not-a-db")
        zf.writestr("../secret.txt", "nope")
    with pytest.raises(bak.BackupError, match="unsafe_path"):
        bak.read_manifest(path)
