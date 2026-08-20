"""Serve the built React SPA from the native backend.

GET / is the index. Client routes fall through to a 404 handler that returns
index.html. Reserved /api /ws /media /docs stay JSON 404 and are never stolen
from StaticFiles mounts (logo, snaps, sounds).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import REPO_ROOT

logger = logging.getLogger("uvicorn.error")

_RESERVED_PREFIXES = ("/api", "/ws", "/media")
_RESERVED_PATHS = frozenset({"/docs", "/redoc", "/openapi.json"})


def spa_disabled() -> bool:
    return os.environ.get("CMS_SPA_DISABLED", "").strip().lower() in {"1", "true", "yes"}


def _is_spa_dir(path: Path) -> bool:
    return path.is_dir() and (path / "index.html").is_file()


def spa_dist_dir() -> Path | None:
    if spa_disabled():
        return None
    override = os.environ.get("CMS_SPA_DIST", "").strip()
    if override:
        candidate = Path(override)
        return candidate if _is_spa_dir(candidate) else None
    candidate = REPO_ROOT / "frontend" / "dist"
    return candidate if _is_spa_dir(candidate) else None


def is_reserved_path(path: str) -> bool:
    normalized = path if path.startswith("/") else f"/{path}"
    if normalized in _RESERVED_PATHS:
        return True
    for prefix in _RESERVED_PREFIXES:
        if normalized == prefix or normalized.startswith(f"{prefix}/"):
            return True
    return False


def safe_dist_file(dist: Path, rel: str) -> Path | None:
    if not rel or rel.endswith("/") or "\\" in rel:
        return None
    dist_root = dist.resolve()
    try:
        candidate = (dist_root / rel).resolve()
        candidate.relative_to(dist_root)
    except (OSError, ValueError):
        return None
    if candidate.is_file():
        return candidate
    return None


_INDEX_HEADERS = {"Cache-Control": "no-store, no-cache, must-revalidate"}


def _index_file(dist: Path) -> FileResponse:
    return FileResponse(dist / "index.html", headers=_INDEX_HEADERS)


def _index_or_404() -> FileResponse:
    dist = spa_dist_dir()
    if dist is None:
        raise HTTPException(status_code=404)
    return _index_file(dist)


def spa_fallback_response(request: Request) -> FileResponse | None:
    if request.method not in {"GET", "HEAD"}:
        return None
    path = request.url.path
    if is_reserved_path(path):
        return None
    dist = spa_dist_dir()
    if dist is None:
        return None
    rel = path.lstrip("/")
    if rel:
        found = safe_dist_file(dist, rel)
        if found is not None:
            return FileResponse(found)
        if "." in Path(rel).name:
            return None
    index = dist / "index.html"
    if not index.is_file():
        return None
    return _index_file(dist)


def mount_spa(app: FastAPI) -> bool:
    """Attach SPA index + 404 fallback. Dist may appear later."""
    if spa_disabled():
        return False

    @app.get("/", include_in_schema=False)
    async def spa_index() -> FileResponse:
        return _index_or_404()

    @app.exception_handler(StarletteHTTPException)
    async def spa_http_exc(request: Request, exc: StarletteHTTPException) -> JSONResponse | FileResponse:
        if exc.status_code == 404:
            page = spa_fallback_response(request)
            if page is not None:
                return page
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    logger.info("SPA routes attached (dist=%s)", spa_dist_dir() or "pending")
    return True
