from __future__ import annotations

import json
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response

from app.core.deps import LicenseServiceDep, SettingsDep
from app.schemas.common import LicenseImportResult, LicenseStatusOut

router = APIRouter(prefix="/api/license", tags=["license"])


@router.get("/status", response_model=LicenseStatusOut)
async def license_status(license_service: LicenseServiceDep) -> LicenseStatusOut:
    return LicenseStatusOut.model_validate(license_service.get_status().model_dump())


@router.get("/export-req")
async def export_req(
    license_service: LicenseServiceDep,
    customer: str | None = Query(default=None),
) -> Response:
    doc = license_service.build_request_document(customer=customer)
    body = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    ts = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"jablotron_cms_{ts}.req"
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"
        },
    )


@router.post("/import-lic", response_model=LicenseImportResult)
async def import_lic(
    license_service: LicenseServiceDep,
    settings: SettingsDep,
    file: UploadFile = File(..., description="File bản quyền .lic đã ký"),
) -> LicenseImportResult:
    if not settings.public_key_path.exists():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Thiếu public_key.pem tại {settings.public_key_path}",
        )
    raw = await file.read()
    try:
        result = await license_service.import_license(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ok = result.mode == "full"
    if not ok:
        # Return 400 for clearly bad licenses so UI can show reason; expired/mismatch included
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "ok": False,
                "license": result.model_dump(),
            },
        )
    return LicenseImportResult(ok=True, license=LicenseStatusOut.model_validate(result.model_dump()))
