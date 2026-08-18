"""Camera snapshot helpers — no live camera required."""

import asyncio
import base64

import httpx
import pytest

from app.iot_core.camera_service import (
    CameraCaptureError,
    capture_camera_snapshot,
    decrypt_secret,
    encrypt_secret,
    probe_camera_connection,
    validate_http_url,
    validate_rtsp_url,
)

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"


def test_validate_http_url_ok():
    assert validate_http_url("http://192.168.1.50/cgi-bin/snapshot.cgi").startswith("http://")


def test_validate_http_url_rejects_file():
    with pytest.raises(CameraCaptureError) as exc:
        validate_http_url("file:///etc/passwd")
    assert exc.value.code == "invalid_url"


def test_validate_rtsp_url_ok():
    assert validate_rtsp_url("rtsp://192.168.1.50:554/stream1").startswith("rtsp://")


def test_validate_rtsp_url_rejects_http():
    with pytest.raises(CameraCaptureError) as exc:
        validate_rtsp_url("http://192.168.1.50/stream")
    assert exc.value.code == "invalid_url"


def test_encrypt_decrypt_roundtrip():
    token = encrypt_secret("admin-secret")
    assert token.startswith("enc:")
    assert "admin-secret" not in token
    assert decrypt_secret(token) == "admin-secret"
    assert decrypt_secret("") == ""
    assert decrypt_secret("plain-legacy") == "plain-legacy"


def test_capture_http_basic_ok():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/snapshot.cgi")
        auth = request.headers.get("authorization", "")
        assert auth.lower().startswith("basic ")
        return httpx.Response(200, content=JPEG, headers={"content-type": "image/jpeg"})

    transport = httpx.MockTransport(handler)
    result = asyncio.run(
        capture_camera_snapshot(
            {
                "snapshot_url": "http://192.168.1.50/cgi-bin/snapshot.cgi",
                "username": "admin",
                "password": "12345",
            },
            transport=transport,
        )
    )
    assert result.source == "http"
    assert result.content_type == "image/jpeg"
    assert result.image_bytes.startswith(b"\xff\xd8\xff")
    assert base64.b64decode(result.to_base64()) == result.image_bytes


def test_capture_http_auth_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="Unauthorized")

    with pytest.raises(CameraCaptureError) as exc:
        asyncio.run(
            probe_camera_connection(
                {"snapshot_url": "http://192.168.1.50/cgi-bin/snapshot.cgi", "username": "a", "password": "b"},
                transport=httpx.MockTransport(handler),
            )
        )
    assert exc.value.code == "auth"


def test_capture_requires_source():
    with pytest.raises(CameraCaptureError) as exc:
        asyncio.run(capture_camera_snapshot({"snapshot_url": "", "rtsp_url": ""}))
    assert exc.value.code == "no_source"


def test_capture_rejects_html_body():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>login</html>", headers={"content-type": "text/html"})

    with pytest.raises(CameraCaptureError) as exc:
        asyncio.run(
            capture_camera_snapshot(
                {"snapshot_url": "http://192.168.1.50/cgi-bin/snapshot.cgi"},
                transport=httpx.MockTransport(handler),
            )
        )
    assert exc.value.code == "bad_image"
