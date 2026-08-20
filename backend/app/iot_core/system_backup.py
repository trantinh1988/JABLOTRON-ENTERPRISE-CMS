"""Xuất / phục hồi toàn bộ CMS (SQLite + bản đồ + file máy trạm)."""

from __future__ import annotations

import json
import logging
import re
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import BACKEND_ROOT, get_settings

log = logging.getLogger(__name__)

FORMAT_ID = "jablotron-cms-backup"
FORMAT_VERSION = 1
MANIFEST_NAME = "manifest.json"
DB_ARCNAME = "cms.db"

MEDIA_DIRS = (
    "map_backgrounds",
    "map_snaps",
    "alert_sounds",
    "brand",
    "camera_thumbs",
    "alarm_snaps",
)
# host_ports.json stays in the zip for disaster recovery but is skipped on restore
# so the running workstation does not suddenly change UI/API ports.
INCLUDE_FILES = ("acked_always.json", "camera.key", "host_ports.json")
SKIP_RESTORE_FILES = frozenset({"host_ports.json"})

MAX_ZIP_BYTES = 512 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
_SAFE_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class BackupError(ValueError):
    """Invalid or unusable backup archive."""


def data_dir() -> Path:
    return BACKEND_ROOT / "data"


def sqlite_db_path() -> Path:
    from sqlalchemy.engine.url import make_url

    url = make_url(get_settings().database_url)
    if not url.database:
        raise BackupError("sqlite_missing")
    return Path(url.database)


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size if path.is_file() else 0
    except OSError:
        return 0


def _dir_stats(path: Path) -> tuple[int, int]:
    files = 0
    bytes_ = 0
    if not path.is_dir():
        return 0, 0
    for child in path.rglob("*"):
        if not child.is_file():
            continue
        files += 1
        bytes_ += _file_size(child)
    return files, bytes_


def current_inventory(root: Path | None = None, db_path: Path | None = None) -> dict[str, Any]:
    root = root or data_dir()
    db_path = db_path or sqlite_db_path()
    media: dict[str, int] = {}
    extra_files = 0
    total_bytes = _file_size(db_path)
    for name in MEDIA_DIRS:
        count, size = _dir_stats(root / name)
        media[name] = count
        total_bytes += size
    for name in INCLUDE_FILES:
        size = _file_size(root / name)
        if size:
            extra_files += 1
            total_bytes += size
    counts = _sqlite_counts(db_path)
    return {
        "format": FORMAT_ID,
        "version": FORMAT_VERSION,
        "panels": counts.get("panels", 0),
        "devices": counts.get("devices", 0),
        "maps": counts.get("floor_maps", 0),
        "cameras": counts.get("cameras", 0),
        "automation_rules": counts.get("automation_rules", 0),
        "events": counts.get("events", 0),
        "map_backgrounds": media.get("map_backgrounds", 0),
        "extra_files": extra_files,
        "approx_bytes": total_bytes,
    }


def _sqlite_counts(db_path: Path) -> dict[str, int]:
    wanted = ("panels", "devices", "floor_maps", "cameras", "automation_rules", "events")
    out = {name: 0 for name in wanted}
    if not db_path.is_file():
        return out
    try:
        con = sqlite3.connect(f"file:{db_path.resolve().as_posix()}?mode=ro", uri=True)
    except sqlite3.Error:
        return out
    try:
        existing = {
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        for name in wanted:
            if name not in existing or not _SAFE_IDENT.match(name):
                continue
            try:
                row = con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()
                out[name] = int(row[0] if row else 0)
            except sqlite3.Error:
                out[name] = 0
    finally:
        con.close()
    return out


def _copy_sqlite(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    src_con = sqlite3.connect(f"file:{src.resolve().as_posix()}?mode=ro", uri=True)
    try:
        dest_con = sqlite3.connect(dest)
        try:
            src_con.backup(dest_con)
        finally:
            dest_con.close()
    finally:
        src_con.close()


def _add_tree(zf: zipfile.ZipFile, src: Path, arc_prefix: str) -> int:
    count = 0
    if not src.is_dir():
        return 0
    for path in sorted(src.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(src).as_posix()
        zf.write(path, f"{arc_prefix}/{rel}")
        count += 1
    return count


def build_archive(dest: Path, *, root: Path | None = None, db_path: Path | None = None) -> dict[str, Any]:
    root = root or data_dir()
    db_path = db_path or sqlite_db_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    media_counts: dict[str, int] = {}
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        if db_path.is_file():
            with tempfile.TemporaryDirectory(prefix="cms-bak-") as tmp:
                snapshot = Path(tmp) / "cms.db"
                _copy_sqlite(db_path, snapshot)
                zf.write(snapshot, DB_ARCNAME)
        for name in MEDIA_DIRS:
            zf.writestr(f"media/{name}/", "")
            media_counts[name] = _add_tree(zf, root / name, f"media/{name}")
        packed_files: list[str] = []
        for name in INCLUDE_FILES:
            path = root / name
            if path.is_file():
                zf.write(path, f"files/{name}")
                packed_files.append(name)
        counts = _sqlite_counts(db_path)
        manifest = {
            "format": FORMAT_ID,
            "version": FORMAT_VERSION,
            "created_at": _utc_stamp(),
            "app": get_settings().app_name,
            "contents": {
                "database": db_path.is_file(),
                "maps": counts.get("floor_maps", 0),
                "map_backgrounds": media_counts.get("map_backgrounds", 0),
                "panels": counts.get("panels", 0),
                "devices": counts.get("devices", 0),
                "cameras": counts.get("cameras", 0),
                "automation_rules": counts.get("automation_rules", 0),
                "events": counts.get("events", 0),
                "files": packed_files,
            },
        }
        zf.writestr(
            MANIFEST_NAME,
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            compress_type=zipfile.ZIP_DEFLATED,
        )
    return manifest


def _validate_zipinfo(info: zipfile.ZipInfo, uncompressed_total: int) -> int:
    name = info.filename.replace("\\", "/")
    if name.startswith("/") or name.startswith("\\") or ".." in name.split("/"):
        raise BackupError("unsafe_path")
    size = int(info.file_size or 0)
    if size < 0:
        raise BackupError("corrupt")
    next_total = uncompressed_total + size
    if next_total > MAX_UNCOMPRESSED_BYTES:
        raise BackupError("too_big")
    return next_total


def read_manifest(zip_path: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            names = {info.filename.replace("\\", "/") for info in zf.infolist()}
            total = 0
            for info in zf.infolist():
                total = _validate_zipinfo(info, total)
            if MANIFEST_NAME not in names:
                raise BackupError("not_backup")
            raw = json.loads(zf.read(MANIFEST_NAME).decode("utf-8"))
    except zipfile.BadZipFile as exc:
        raise BackupError("not_zip") from exc
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BackupError("corrupt") from exc
    if not isinstance(raw, dict) or raw.get("format") != FORMAT_ID:
        raise BackupError("not_backup")
    version = raw.get("version")
    if not isinstance(version, int) or version < 1 or version > FORMAT_VERSION:
        raise BackupError("unsupported_version")
    if DB_ARCNAME not in names and "cms.db" not in names:
        raise BackupError("missing_db")
    return raw


def _extract_member(zf: zipfile.ZipFile, name: str, dest_dir: Path) -> Path | None:
    info = zf.getinfo(name)
    rel = info.filename.replace("\\", "/")
    target = (dest_dir / rel).resolve()
    try:
        target.relative_to(dest_dir.resolve())
    except ValueError:
        raise BackupError("unsafe_path") from None
    if rel.endswith("/") or info.is_dir():
        target.mkdir(parents=True, exist_ok=True)
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    with zf.open(info, "r") as src, target.open("wb") as out:
        shutil.copyfileobj(src, out)
    return target


def _replace_dir(src: Path, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    if src.is_dir():
        shutil.copytree(src, dest)
    else:
        dest.mkdir(parents=True, exist_ok=True)


def _table_columns(con: sqlite3.Connection, schema: str, table: str) -> list[str]:
    rows = con.execute(f'PRAGMA {schema}.table_info("{table}")').fetchall()
    return [str(row[1]) for row in rows]


def restore_sqlite(live_db: Path, backup_db: Path) -> None:
    live_db.parent.mkdir(parents=True, exist_ok=True)
    if not live_db.is_file():
        shutil.copy2(backup_db, live_db)
        return
    con = sqlite3.connect(live_db)
    try:
        con.execute("PRAGMA busy_timeout=8000")
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        con.execute("ATTACH DATABASE ? AS bak", (str(backup_db.resolve()),))
        con.execute("PRAGMA foreign_keys=OFF")
        main_tables = [
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            if _SAFE_IDENT.match(str(row[0] or ""))
        ]
        bak_tables = {
            row[0]
            for row in con.execute(
                "SELECT name FROM bak.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            if _SAFE_IDENT.match(str(row[0] or ""))
        }
        con.execute("BEGIN")
        for table in main_tables:
            con.execute(f'DELETE FROM main."{table}"')
            if table not in bak_tables:
                continue
            shared = [c for c in _table_columns(con, "main", table) if c in set(_table_columns(con, "bak", table))]
            if not shared:
                continue
            cols = ",".join(f'"{c}"' for c in shared)
            con.execute(f'INSERT INTO main."{table}" ({cols}) SELECT {cols} FROM bak."{table}"')
        seq_main = con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'"
        ).fetchone()
        seq_bak = con.execute(
            "SELECT 1 FROM bak.sqlite_master WHERE type='table' AND name='sqlite_sequence'"
        ).fetchone()
        if seq_main and seq_bak:
            con.execute("DELETE FROM sqlite_sequence")
            con.execute("INSERT INTO sqlite_sequence SELECT * FROM bak.sqlite_sequence")
        con.execute("COMMIT")
        con.execute("DETACH DATABASE bak")
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:
        try:
            con.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        try:
            con.execute("DETACH DATABASE bak")
        except sqlite3.Error:
            pass
        raise
    finally:
        con.close()


def restore_archive(zip_path: Path, *, root: Path | None = None, db_path: Path | None = None) -> dict[str, Any]:
    root = root or data_dir()
    db_path = db_path or sqlite_db_path()
    size = _file_size(zip_path)
    if size <= 0:
        raise BackupError("empty")
    if size > MAX_ZIP_BYTES:
        raise BackupError("too_big")
    manifest = read_manifest(zip_path)
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cms-restore-") as tmp:
        extract_root = Path(tmp)
        with zipfile.ZipFile(zip_path, "r") as zf:
            for info in zf.infolist():
                _validate_zipinfo(info, 0)
                _extract_member(zf, info.filename, extract_root)
        backup_db = extract_root / DB_ARCNAME
        if not backup_db.is_file():
            raise BackupError("missing_db")
        try:
            restore_sqlite(db_path, backup_db)
        except sqlite3.Error as exc:
            raise BackupError("corrupt") from exc
        media_src = extract_root / "media"
        for name in MEDIA_DIRS:
            src = media_src / name
            if src.is_dir():
                _replace_dir(src, root / name)
        files_src = extract_root / "files"
        if files_src.is_dir():
            for path in files_src.iterdir():
                if not path.is_file() or path.name in SKIP_RESTORE_FILES:
                    continue
                if path.name not in INCLUDE_FILES:
                    continue
                shutil.copy2(path, root / path.name)
    return {**current_inventory(root, db_path), "created_at": manifest.get("created_at")}


async def apply_restored_runtime() -> None:
    """Reload in-memory CMS state after files/DB were replaced on disk."""
    from app.db.session import engine
    from app.iot_core.automation_engine import get_automation_engine
    from app.iot_core.event_hub import get_event_hub
    from app.iot_core.panel_bus import get_panel_bus
    from app.iot_core.panel_store import reload_panels_from_db
    from app.iot_core.usb_manager import get_usb_manager
    from app.license_manager.service import get_license_service

    usb = get_usb_manager()
    usb._poll_pause_depth += 1
    try:
        await engine.dispose()
        await reload_panels_from_db(get_panel_bus())
        await get_automation_engine().reload()
        await get_license_service().load_from_db()
        try:
            usb._load_acked_always()
        except Exception as exc:
            log.warning("Could not reload acked-always after restore: %s", exc)
        for panel_id in list(usb._sessions):
            await usb.request_device_stream_refresh(panel_id)
    finally:
        usb._poll_pause_depth = max(0, usb._poll_pause_depth - 1)
    await get_event_hub().publish(
        {
            "type": "system_backup_restored",
            "ts": _utc_stamp(),
        }
    )
