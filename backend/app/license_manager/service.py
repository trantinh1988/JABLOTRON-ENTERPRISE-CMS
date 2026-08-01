from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models import LicenseRecord
from app.db.session import SessionLocal
from app.license_manager.hwid import get_or_create_hwid
from app.license_manager.verifier import is_expired, validate_license


class LicenseStatus(BaseModel):
    status: str  # missing | active | expired | invalid_signature | hwid_mismatch | app_mismatch | malformed
    mode: str  # full | read-only
    hwid: str
    app_code: str
    expires_at: str | None = None
    issued_at: str | None = None
    features: list[str] = Field(default_factory=list)
    customer: str | None = None
    reason: str | None = None


class LicenseService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._cached_payload: dict[str, Any] | None = None
        self._cached_signature: str | None = None
        self._loaded = False

    @property
    def hwid(self) -> str:
        return get_or_create_hwid(self.settings.hwid_cache_path)

    def build_request_document(self, customer: str | None = None) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "hwid": self.hwid,
            "app_code": self.settings.app_code,
            "requested_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        if customer:
            doc["customer"] = customer
        return doc

    async def load_from_db(self) -> None:
        async with SessionLocal() as session:
            row = await self._latest_license(session)
            if row is None:
                self._cached_payload = None
                self._cached_signature = None
            else:
                self._cached_payload = json.loads(row.payload_json)
                self._cached_signature = row.signature
        self._loaded = True

    async def _latest_license(self, session: AsyncSession) -> LicenseRecord | None:
        result = await session.execute(
            select(LicenseRecord).order_by(LicenseRecord.id.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    def get_status(self) -> LicenseStatus:
        hwid = self.hwid
        if not self._cached_payload or not self._cached_signature:
            return LicenseStatus(
                status="missing",
                mode="read-only",
                hwid=hwid,
                app_code=self.settings.app_code,
                reason="Chưa nhập bản quyền",
            )

        result = validate_license(
            {"payload": self._cached_payload, "signature": self._cached_signature},
            expected_hwid=hwid,
            expected_app_code=self.settings.app_code,
            public_key_path=self.settings.public_key_path,
        )
        payload = result.get("payload") or {}
        status = result["status"]
        mode = "full" if result["ok"] else "read-only"
        # Soft-expire check if signature was valid but we only had cached fields
        if result["ok"] is False and status == "expired":
            mode = "read-only"
        return LicenseStatus(
            status=status,
            mode=mode,
            hwid=hwid,
            app_code=self.settings.app_code,
            expires_at=payload.get("expires_at"),
            issued_at=payload.get("issued_at"),
            features=list(payload.get("features") or []),
            customer=payload.get("customer"),
            reason="Hợp lệ" if result.get("reason") == "ok" else result.get("reason"),
        )

    def is_write_allowed(self) -> bool:
        return self.get_status().mode == "full"

    async def import_license(self, lic_raw: dict[str, Any] | str | bytes) -> LicenseStatus:
        result = validate_license(
            lic_raw,
            expected_hwid=self.hwid,
            expected_app_code=self.settings.app_code,
            public_key_path=self.settings.public_key_path,
        )
        if not result["ok"]:
            # Still persist expired? No — only accept active signatures matched to this machine.
            # Exception: allow storing expired only if you want audit — we reject non-ok.
            return LicenseStatus(
                status=result["status"],
                mode="read-only",
                hwid=self.hwid,
                app_code=self.settings.app_code,
                expires_at=(result.get("payload") or {}).get("expires_at"),
                issued_at=(result.get("payload") or {}).get("issued_at"),
                features=list((result.get("payload") or {}).get("features") or []),
                customer=(result.get("payload") or {}).get("customer"),
                reason=result.get("reason"),
            )

        payload = result["payload"]
        signature = result["signature"]
        assert payload is not None and signature is not None

        async with SessionLocal() as session:
            row = LicenseRecord(
                hwid=str(payload["hwid"]).upper(),
                app_code=str(payload["app_code"]),
                payload_json=json.dumps(payload, ensure_ascii=False),
                signature=signature,
                expires_at=str(payload["expires_at"]),
                status="active" if not is_expired(str(payload["expires_at"])) else "expired",
            )
            session.add(row)
            await session.commit()

        self._cached_payload = payload
        self._cached_signature = signature
        self._loaded = True
        return self.get_status()


_license_service: LicenseService | None = None


def get_license_service() -> LicenseService:
    global _license_service
    if _license_service is None:
        _license_service = LicenseService()
    return _license_service
