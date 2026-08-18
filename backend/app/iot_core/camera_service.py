"""Lightweight camera snapshot: HTTP Basic/Digest first, optional ffmpeg RTSP."""

from __future__ import annotations

import asyncio
import base64
import logging
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote, urlparse, urlunparse

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import BACKEND_ROOT

log = logging.getLogger(__name__)

HTTP_TIMEOUT = httpx.Timeout(6.0, connect=3.0)
MAX_IMAGE_BYTES = 4 * 1024 * 1024
RTSP_TIMEOUT_SEC = 8.0
SECRET_PREFIX = "enc:"
KEY_PATH = BACKEND_ROOT / "data" / "camera.key"
THUMB_DIR = BACKEND_ROOT / "data" / "camera_thumbs"

_BLOCKED_HOSTS = frozenset({"169.254.169.254", "metadata.google.internal"})
_IMAGE_MAGICS = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),
    (b"BM", "image/bmp"),
)

SnapshotSource = Literal["http", "rtsp"]


class CameraCaptureError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass
class SnapshotResult:
    image_bytes: bytes
    content_type: str
    source: SnapshotSource
    latency_ms: int
    captured_at: str

    def to_base64(self) -> str:
        return base64.b64encode(self.image_bytes).decode("ascii")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fernet() -> Fernet:
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    if KEY_PATH.exists():
        key = KEY_PATH.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        KEY_PATH.write_bytes(key)
        try:
            KEY_PATH.chmod(0o600)
        except OSError:
            pass
    return Fernet(key)


def encrypt_secret(plain: str) -> str:
    if not plain:
        return ""
    token = _fernet().encrypt(plain.encode("utf-8")).decode("ascii")
    return f"{SECRET_PREFIX}{token}"


def decrypt_secret(stored: str) -> str:
    if not stored:
        return ""
    if not stored.startswith(SECRET_PREFIX):
        return stored
    try:
        return _fernet().decrypt(stored[len(SECRET_PREFIX) :].encode("ascii")).decode("utf-8")
    except InvalidToken:
        return ""


def ensure_camera_thumb_dir() -> Path:
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    return THUMB_DIR


def camera_thumb_path(camera_id: str) -> Path:
    return THUMB_DIR / f"{camera_id}.jpg"


def camera_thumb_url(camera_id: str) -> str | None:
    path = camera_thumb_path(camera_id)
    if path.is_file():
        return f"/media/camera-thumbs/{camera_id}.jpg"
    return None


def save_camera_thumb(camera_id: str, image_bytes: bytes) -> str | None:
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        return None
    ensure_camera_thumb_dir()
    path = camera_thumb_path(camera_id)
    try:
        path.write_bytes(image_bytes)
    except OSError as exc:
        log.warning("Could not write camera thumb %s: %s", path, exc)
        return None
    return f"/media/camera-thumbs/{camera_id}.jpg"


def unlink_camera_thumb(camera_id: str) -> None:
    path = camera_thumb_path(camera_id)
    try:
        if path.is_file():
            path.unlink()
    except OSError as exc:
        log.warning("Could not remove camera thumb %s: %s", path, exc)


def _host_of(parsed: Any) -> str:
    host = (parsed.hostname or "").strip().lower()
    return host


def _clean_netloc(parsed: Any) -> str:
    host = parsed.hostname or ""
    if not host:
        return ""
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    if parsed.port:
        return f"{host}:{parsed.port}"
    return host


def split_url_auth(url: str) -> tuple[str, str, str]:
    """Return (url_without_userinfo, username, password)."""
    parsed = urlparse(url.strip())
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    netloc = _clean_netloc(parsed)
    clean = urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))
    return clean, user, password


def validate_http_url(url: str) -> str:
    text = (url or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"}:
        raise CameraCaptureError("invalid_url", "Snapshot URL phải bắt đầu bằng http:// hoặc https://")
    host = _host_of(parsed)
    if not host:
        raise CameraCaptureError("invalid_url", "Snapshot URL thiếu địa chỉ IP / hostname.")
    if host in _BLOCKED_HOSTS:
        raise CameraCaptureError("invalid_url", "Địa chỉ Snapshot URL không được phép.")
    if len(text) > 1024:
        raise CameraCaptureError("invalid_url", "Snapshot URL quá dài.")
    return text


def validate_rtsp_url(url: str) -> str:
    text = (url or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if parsed.scheme not in {"rtsp", "rtsps"}:
        raise CameraCaptureError("invalid_url", "RTSP URL phải bắt đầu bằng rtsp:// hoặc rtsps://")
    host = _host_of(parsed)
    if not host:
        raise CameraCaptureError("invalid_url", "RTSP URL thiếu địa chỉ IP / hostname.")
    if host in _BLOCKED_HOSTS:
        raise CameraCaptureError("invalid_url", "Địa chỉ RTSP URL không được phép.")
    if len(text) > 1024:
        raise CameraCaptureError("invalid_url", "RTSP URL quá dài.")
    return text


def detect_image_type(data: bytes, declared: str | None = None) -> str:
    if not data:
        raise CameraCaptureError("bad_image", "Camera không trả về dữ liệu ảnh.")
    for magic, mime in _IMAGE_MAGICS:
        if data.startswith(magic):
            if magic == b"RIFF" and (len(data) < 12 or data[8:12] != b"WEBP"):
                continue
            return mime
    if declared and declared.lower().startswith("image/"):
        return declared.split(";")[0].strip().lower()
    raise CameraCaptureError("bad_image", "Phản hồi không phải ảnh JPEG/PNG (kiểm tra lại Snapshot URL).")


def classify_http_error(exc: BaseException | None = None, status_code: int | None = None) -> CameraCaptureError:
    if isinstance(exc, httpx.TimeoutException):
        return CameraCaptureError("timeout", "Hết thời gian chờ — camera không phản hồi (timeout).")
    if isinstance(exc, httpx.ConnectError):
        return CameraCaptureError("unreachable", "Không tìm thấy IP / không kết nối được camera.")
    if isinstance(exc, (httpx.NetworkError, httpx.RemoteProtocolError)):
        return CameraCaptureError("unreachable", "Mất kết nối tới camera.")
    if status_code in {401, 403}:
        return CameraCaptureError("auth", "Sai tài khoản hoặc mật khẩu camera.")
    if status_code == 404:
        return CameraCaptureError("not_found", "Không tìm thấy Snapshot URL trên camera (404).")
    if status_code is not None:
        return CameraCaptureError("failed", f"Camera trả về HTTP {status_code}.")
    return CameraCaptureError("failed", "Không chụp được ảnh từ camera.")


def _field(obj: Any, name: str, default: str = "") -> str:
    if isinstance(obj, dict):
        value = obj.get(name, default)
    else:
        value = getattr(obj, name, default)
    return str(value or default)


def _credentials_of(camera_obj: Any) -> tuple[str, str]:
    username = _field(camera_obj, "username")
    password = _field(camera_obj, "password")
    if not username and (_field(camera_obj, "username_enc") or hasattr(camera_obj, "username_enc")):
        username = decrypt_secret(_field(camera_obj, "username_enc"))
        password = decrypt_secret(_field(camera_obj, "password_enc"))
    return username, password


async def _http_get_image(
    url: str,
    username: str,
    password: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> bytes:
    clean, url_user, url_pass = split_url_auth(url)
    user = username or url_user
    pwd = password if username else (password or url_pass)
    limits = httpx.Limits(max_keepalive_connections=0, max_connections=2)
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        follow_redirects=False,
        verify=False,
        limits=limits,
        transport=transport,
    ) as client:
        response = await _request_with_auth(client, clean, user, pwd)
        if response.status_code == 401 and user:
            response = await _request_with_auth(client, clean, user, pwd, prefer_digest=True)
        if response.status_code >= 400:
            raise classify_http_error(status_code=response.status_code)
        data = response.content or b""
        if len(data) > MAX_IMAGE_BYTES:
            raise CameraCaptureError("too_large", "Ảnh snapshot vượt quá 4MB — bỏ qua để giữ CMS nhẹ.")
        detect_image_type(data, response.headers.get("content-type"))
        return data


async def _request_with_auth(
    client: httpx.AsyncClient,
    url: str,
    username: str,
    password: str,
    *,
    prefer_digest: bool = False,
) -> httpx.Response:
    auth: httpx.Auth | None = None
    if username:
        auth = httpx.DigestAuth(username, password) if prefer_digest else httpx.BasicAuth(username, password)
    try:
        return await client.get(url, auth=auth, headers={"Accept": "image/*,*/*;q=0.8"})
    except httpx.HTTPError as exc:
        raise classify_http_error(exc) from exc


async def _rtsp_frame(rtsp_url: str) -> bytes:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise CameraCaptureError(
            "rtsp_unavailable",
            "Không có ffmpeg trên máy — hãy điền Snapshot URL HTTP (nhẹ hơn RTSP).",
        )
    clean, url_user, url_pass = split_url_auth(rtsp_url)
    if url_user or url_pass:
        parsed = urlparse(rtsp_url.strip())
        user = url_user
        pwd = url_pass
        netloc = _clean_netloc(parsed)
        if user:
            cred = user if not pwd else f"{user}:{pwd}"
            netloc = f"{cred}@{netloc}"
        target = urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))
    else:
        target = clean
    proc = await asyncio.create_subprocess_exec(
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-i",
        target,
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-vcodec",
        "mjpeg",
        "pipe:1",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=RTSP_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        proc.kill()
        try:
            await proc.wait()
        except Exception:
            pass
        raise CameraCaptureError("timeout", "RTSP hết thời gian chờ — camera không gửi frame.") from None
    if proc.returncode not in (0, None) or not stdout:
        hint = (stderr or b"").decode("utf-8", errors="replace").strip().splitlines()
        last = hint[-1] if hint else ""
        if "401" in last or "Unauthorized" in last or "auth" in last.lower():
            raise CameraCaptureError("auth", "Sai tài khoản hoặc mật khẩu RTSP.")
        raise CameraCaptureError("failed", "Không lấy được frame từ RTSP.")
    if len(stdout) > MAX_IMAGE_BYTES:
        raise CameraCaptureError("too_large", "Frame RTSP vượt quá 4MB.")
    detect_image_type(stdout, "image/jpeg")
    return stdout


async def capture_camera_snapshot(
    camera_obj: Any,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> SnapshotResult:
    snapshot_url = validate_http_url(_field(camera_obj, "snapshot_url"))
    rtsp_url = validate_rtsp_url(_field(camera_obj, "rtsp_url"))
    username, password = _credentials_of(camera_obj)
    if not snapshot_url and not rtsp_url:
        raise CameraCaptureError("no_source", "Cần ít nhất Snapshot URL hoặc RTSP URL.")

    started = datetime.now(timezone.utc)
    last_error: CameraCaptureError | None = None
    if snapshot_url:
        try:
            data = await _http_get_image(snapshot_url, username, password, transport=transport)
            elapsed = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
            return SnapshotResult(
                image_bytes=data,
                content_type=detect_image_type(data),
                source="http",
                latency_ms=elapsed,
                captured_at=_now_iso(),
            )
        except CameraCaptureError as exc:
            last_error = exc
            if not rtsp_url:
                raise

    if rtsp_url:
        try:
            data = await _rtsp_frame(rtsp_url)
            elapsed = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
            return SnapshotResult(
                image_bytes=data,
                content_type=detect_image_type(data, "image/jpeg"),
                source="rtsp",
                latency_ms=elapsed,
                captured_at=_now_iso(),
            )
        except CameraCaptureError as exc:
            if last_error and exc.code == "rtsp_unavailable":
                raise last_error from exc
            raise

    raise last_error or CameraCaptureError("failed", "Không chụp được ảnh từ camera.")


async def probe_camera_connection(
    camera_data: Any,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> SnapshotResult:
    """Capture one frame without touching the database."""
    return await capture_camera_snapshot(camera_data, transport=transport)
