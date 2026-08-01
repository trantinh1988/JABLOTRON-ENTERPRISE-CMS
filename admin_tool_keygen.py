#!/usr/bin/env python3
"""
Admin-only offline license tool for Jablotron Enterprise CMS.

- Generate RSA-2048 keypair (private_key.pem / public_key.pem)
- Sign a .req file into a .lic file (payload + Base64 signature)

NEVER distribute private_key.pem with the CMS application.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey, RSAPublicKey

APP_CODE = "JABLOTRON_CMS_ENTERPRISE"
DEFAULT_KEYS_DIR = Path("keys")
DEFAULT_VALIDITY_DAYS = 365


def canonical_json(payload: dict[str, Any]) -> bytes:
    """Deterministic JSON bytes used for signing and verification."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def generate_keypair(output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()

    private_path = output_dir / "private_key.pem"
    public_path = output_dir / "public_key.pem"

    private_path.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    public_path.write_bytes(
        public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    return private_path, public_path


def load_private_key(path: Path) -> RSAPrivateKey:
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, RSAPrivateKey):
        raise TypeError(f"Expected RSA private key at {path}")
    return key


def load_public_key(path: Path) -> RSAPublicKey:
    key = serialization.load_pem_public_key(path.read_bytes())
    if not isinstance(key, RSAPublicKey):
        raise TypeError(f"Expected RSA public key at {path}")
    return key


def sign_payload(private_key: RSAPrivateKey, payload: dict[str, Any]) -> str:
    signature = private_key.sign(
        canonical_json(payload),
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("ascii")


def verify_payload(public_key: RSAPublicKey, payload: dict[str, Any], signature_b64: str) -> bool:
    try:
        public_key.verify(
            base64.b64decode(signature_b64),
            canonical_json(payload),
            padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
            hashes.SHA256(),
        )
        return True
    except Exception:
        return False


def build_license_payload(
    req: dict[str, Any],
    validity_days: int,
    expires_at: str | None = None,
) -> dict[str, Any]:
    hwid = req.get("hwid")
    app_code = req.get("app_code", APP_CODE)
    if not hwid or not isinstance(hwid, str):
        raise ValueError(".req missing required field: hwid")
    if app_code != APP_CODE:
        raise ValueError(f"Unsupported app_code: {app_code!r} (expected {APP_CODE!r})")

    now = datetime.now(timezone.utc)
    if expires_at:
        exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
    else:
        exp = now + timedelta(days=validity_days)

    payload: dict[str, Any] = {
        "hwid": hwid.strip().upper(),
        "app_code": APP_CODE,
        "issued_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": exp.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "features": ["multi_panel", "group_arm", "websocket_events"],
    }
    if req.get("customer"):
        payload["customer"] = req["customer"]
    return payload


def sign_request(
    req_path: Path,
    private_key_path: Path,
    out_lic: Path,
    validity_days: int = DEFAULT_VALIDITY_DAYS,
    expires_at: str | None = None,
) -> Path:
    req = json.loads(req_path.read_text(encoding="utf-8"))
    if not isinstance(req, dict):
        raise ValueError(".req must be a JSON object")

    private_key = load_private_key(private_key_path)
    payload = build_license_payload(req, validity_days=validity_days, expires_at=expires_at)
    signature = sign_payload(private_key, payload)

    lic_doc = {"payload": payload, "signature": signature}
    out_lic.parent.mkdir(parents=True, exist_ok=True)
    out_lic.write_text(json.dumps(lic_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out_lic


def cmd_gen_keys(args: argparse.Namespace) -> int:
    private_path, public_path = generate_keypair(Path(args.out_dir))
    print(f"Generated private key: {private_path}")
    print(f"Generated public key:  {public_path}")
    print("Keep private_key.pem offline on the Admin machine only.")
    return 0


def cmd_sign(args: argparse.Namespace) -> int:
    out = sign_request(
        req_path=Path(args.req),
        private_key_path=Path(args.private_key),
        out_lic=Path(args.out),
        validity_days=args.days,
        expires_at=args.expires_at,
    )
    print(f"Signed license written to: {out}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    lic = json.loads(Path(args.lic).read_text(encoding="utf-8"))
    public_key = load_public_key(Path(args.public_key))
    ok = verify_payload(public_key, lic["payload"], lic["signature"])
    print("VALID" if ok else "INVALID")
    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Jablotron Enterprise CMS — Admin offline license keygen"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_gen = sub.add_parser("gen-keys", help="Generate RSA-2048 private/public PEM keys")
    p_gen.add_argument("--out-dir", default=str(DEFAULT_KEYS_DIR), help="Output directory for PEMs")
    p_gen.set_defaults(func=cmd_gen_keys)

    p_sign = sub.add_parser("sign", help="Sign a .req file into a .lic license")
    p_sign.add_argument("--req", required=True, help="Path to .req JSON")
    p_sign.add_argument(
        "--private-key",
        default=str(DEFAULT_KEYS_DIR / "private_key.pem"),
        help="Path to private_key.pem",
    )
    p_sign.add_argument("--out", required=True, help="Output .lic path")
    p_sign.add_argument("--days", type=int, default=DEFAULT_VALIDITY_DAYS, help="Validity days")
    p_sign.add_argument(
        "--expires-at",
        default=None,
        help="Optional ISO8601 expiry (overrides --days), e.g. 2027-07-31T00:00:00Z",
    )
    p_sign.set_defaults(func=cmd_sign)

    p_verify = sub.add_parser("verify", help="Verify a .lic against public_key.pem")
    p_verify.add_argument("--lic", required=True, help="Path to .lic JSON")
    p_verify.add_argument(
        "--public-key",
        default=str(DEFAULT_KEYS_DIR / "public_key.pem"),
        help="Path to public_key.pem",
    )
    p_verify.set_defaults(func=cmd_verify)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as exc:  # noqa: BLE001 — CLI surface
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
