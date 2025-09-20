"""Usage reporting endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from backend.services.usage import get_usage_summary

router = APIRouter()


@router.get("/usage/me")
async def usage_me(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    if not x_user_id:
        return JSONResponse({"error": "missing user id"}, status_code=400)

    summary = await get_usage_summary(x_user_id)
    payload = summary.to_dict()
    return {
        "ok": True,
        "current_period_start": payload.get("current_period_start"),
        "current_period_end": payload.get("current_period_end"),
        "allowance": payload.get("allowance", 0),
        "used": payload.get("used", 0),
        "remaining": payload.get("remaining", 0),
        "plan": payload.get("plan"),
        "usage": payload,
    }
