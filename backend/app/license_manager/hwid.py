from __future__ import annotations

import hashlib
import platform
import re
import subprocess
import uuid
from pathlib import Path

from app.core.config import get_settings


def _run_cmd(args: list[str]) -> str:
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return (result.stdout or "").strip()
    except Exception:
        return ""


def _mac_fingerprint() -> str:
    node = uuid.getnode()
    return f"{node:012X}"


def _cpu_serial_windows() -> str:
    out = _run_cmd(["wmic", "cpu", "get", "ProcessorId"])
    lines = [ln.strip() for ln in out.splitlines() if ln.strip() and ln.strip().upper() != "PROCESSORID"]
    return lines[0] if lines else ""


def _board_serial_windows() -> str:
    out = _run_cmd(["wmic", "baseboard", "get", "SerialNumber"])
    lines = [
        ln.strip()
        for ln in out.splitlines()
        if ln.strip() and ln.strip().upper() != "SERIALNUMBER"
    ]
    return lines[0] if lines else ""


def _cpu_serial_linux() -> str:
    for path in (Path("/sys/class/dmi/id/product_uuid"), Path("/etc/machine-id")):
        try:
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return value
        except OSError:
            continue
    return ""


def collect_raw_machine_id() -> str:
    parts = [
        platform.system(),
        platform.machine(),
        _mac_fingerprint(),
    ]
    if platform.system() == "Windows":
        parts.append(_cpu_serial_windows())
        parts.append(_board_serial_windows())
    else:
        parts.append(_cpu_serial_linux())

    cleaned = "|".join(p for p in parts if p)
    return cleaned or f"FALLBACK-{uuid.getnode():012X}"


def compute_hwid(raw: str | None = None) -> str:
    material = raw if raw is not None else collect_raw_machine_id()
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest().upper()
    return digest


def get_or_create_hwid(cache_path: Path | None = None) -> str:
    settings = get_settings()
    path = cache_path or settings.hwid_cache_path
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        cached = path.read_text(encoding="utf-8").strip().upper()
        if re.fullmatch(r"[0-9A-F]{64}", cached):
            return cached
    hwid = compute_hwid()
    path.write_text(hwid + "\n", encoding="utf-8")
    return hwid
