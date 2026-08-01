from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

from app.core.config import get_settings


def canonical_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def load_public_key(path: Path | None = None) -> RSAPublicKey:
    settings = get_settings()
    key_path = path or settings.public_key_path
    if not key_path.exists():
        raise FileNotFoundError(
            f"Không tìm thấy public_key.pem tại {key_path}. "
            "Chạy: python admin_tool_keygen.py gen-keys"
        )
    key = serialization.load_pem_public_key(key_path.read_bytes())
    if not isinstance(key, RSAPublicKey):
        raise TypeError("public_key.pem không phải khóa công khai RSA")
    return key


def verify_signature(public_key: RSAPublicKey, payload: dict[str, Any], signature_b64: str) -> bool:
    try:
        public_key.verify(
            base64.b64decode(signature_b64),
            canonical_json(payload),
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
            hashes.SHA256(),
        )
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def parse_lic_document(raw: dict[str, Any] | str | bytes) -> tuple[dict[str, Any], str]:
    if isinstance(raw, (str, bytes)):
        doc = json.loads(raw)
    else:
        doc = raw
    if not isinstance(doc, dict) or "payload" not in doc or "signature" not in doc:
        raise ValueError("Định dạng .lic không hợp lệ: cần {payload, signature}")
    payload = doc["payload"]
    signature = doc["signature"]
    if not isinstance(payload, dict) or not isinstance(signature, str):
        raise ValueError("Kiểu payload/signature trong .lic không hợp lệ")
    return payload, signature


def is_expired(expires_at: str, now: datetime | None = None) -> bool:
    current = now or datetime.now(timezone.utc)
    exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return current >= exp


def validate_license(
    lic_raw: dict[str, Any] | str | bytes,
    expected_hwid: str,
    expected_app_code: str,
    public_key_path: Path | None = None,
) -> dict[str, Any]:
    """
    Validate .lic and return structured result:
    {ok, status, reason, payload}
    status: active | invalid_signature | hwid_mismatch | app_mismatch | expired | malformed
    """
    try:
        payload, signature = parse_lic_document(lic_raw)
    except (ValueError, json.JSONDecodeError) as exc:
        return {"ok": False, "status": "malformed", "reason": str(exc), "payload": None}

    try:
        public_key = load_public_key(public_key_path)
    except FileNotFoundError as exc:
        return {"ok": False, "status": "malformed", "reason": str(exc), "payload": payload}

    if not verify_signature(public_key, payload, signature):
        return {
            "ok": False,
            "status": "invalid_signature",
            "reason": "Xác minh chữ ký số RSA thất bại",
            "payload": payload,
        }

    if str(payload.get("app_code", "")) != expected_app_code:
        return {
            "ok": False,
            "status": "app_mismatch",
            "reason": "Mã ứng dụng (app_code) không khớp",
            "payload": payload,
        }

    lic_hwid = str(payload.get("hwid", "")).strip().upper()
    if lic_hwid != expected_hwid.strip().upper():
        return {
            "ok": False,
            "status": "hwid_mismatch",
            "reason": "HWID bản quyền không khớp với máy chủ này",
            "payload": payload,
        }

    expires_at = str(payload.get("expires_at", ""))
    if not expires_at:
        return {
            "ok": False,
            "status": "malformed",
            "reason": "Thiếu trường expires_at",
            "payload": payload,
        }
    if is_expired(expires_at):
        return {
            "ok": False,
            "status": "expired",
            "reason": "Bản quyền đã hết hạn",
            "payload": payload,
        }

    return {
        "ok": True,
        "status": "active",
        "reason": "ok",
        "payload": payload,
        "signature": signature,
    }
