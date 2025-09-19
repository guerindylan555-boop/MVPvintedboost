"""Admin and health endpoints."""
from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException, status

from backend.config import LOGGER, MODEL
from backend.db import init_db

router = APIRouter()


def _require_admin(authorization: str | None) -> None:
    token = os.getenv("ADMIN_BEARER_TOKEN")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_BEARER_TOKEN not configured",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    if authorization.split(" ", 1)[1] != token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


@router.get("/health")
async def health():
    return {"ok": True, "model": MODEL}


@router.post("/admin/init-db")
async def admin_init_db(authorization: str | None = Header(default=None, alias="Authorization")):
    """Admin-only endpoint to recreate SQL tables using SQLAlchemy metadata."""

    _require_admin(authorization)
    try:
        await init_db()
        return {"ok": True, "message": "DB initialized"}
    except Exception as exc:  # pragma: no cover - defensive logging
        LOGGER.exception("Admin init-db failed")
        raise HTTPException(status_code=500, detail=str(exc))
