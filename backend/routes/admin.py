"""Admin and health endpoints."""
from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from backend.config import LOGGER, MODEL
from backend.db import UsageCounter, db_session, init_db
from backend.services.usage import get_usage_costs_mapping, get_usage_summaries, set_usage_costs

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


class UsageCostPayload(BaseModel):
    costs: dict[str, int] = Field(..., description="Map of usage cost identifiers to integer values")


@router.get("/admin/usage")
async def admin_usage_overview(authorization: str | None = Header(default=None, alias="Authorization")):
    _require_admin(authorization)

    async with db_session() as session:
        stmt = (
            select(UsageCounter.user_id, func.max(UsageCounter.updated_at).label("updated_at"))
            .group_by(UsageCounter.user_id)
            .order_by(func.max(UsageCounter.updated_at).desc())
            .limit(500)
        )
        res = await session.execute(stmt)
        rows = res.all()

    user_ids = [row[0] for row in rows if row[0]]
    summaries = await get_usage_summaries(user_ids)

    items: list[dict] = []
    total_allowance = 0
    total_used = 0
    total_remaining = 0
    for summary in summaries:
        payload = summary.to_dict()
        payload.pop("costs", None)
        payload["user_id"] = summary.user_id
        items.append(payload)
        total_allowance += payload.get("allowance", 0) or 0
        total_used += payload.get("used", 0) or 0
        total_remaining += payload.get("remaining", 0) or 0

    totals = {
        "users": len(items),
        "allowance": total_allowance,
        "used": total_used,
        "remaining": total_remaining,
    }

    return {
        "ok": True,
        "items": items,
        "totals": totals,
        "costs": get_usage_costs_mapping(),
    }


@router.get("/admin/usage/costs")
async def admin_get_usage_costs(authorization: str | None = Header(default=None, alias="Authorization")):
    _require_admin(authorization)
    return {"ok": True, "costs": get_usage_costs_mapping()}


@router.post("/admin/usage/costs")
async def admin_set_usage_costs(
    payload: UsageCostPayload,
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    _require_admin(authorization)
    try:
        costs = set_usage_costs(payload.costs)
        return {"ok": True, "costs": costs}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive logging
        LOGGER.exception("Admin update usage costs failed")
        raise HTTPException(status_code=500, detail="Failed to update usage costs") from exc
