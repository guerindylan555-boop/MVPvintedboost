"""Billing and subscription management endpoints."""
from __future__ import annotations

import base64
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from standardwebhooks import Webhook, WebhookVerificationError

from backend.config import LOGGER, POLAR_WEBHOOK_SECRET
from backend.db import Subscription, db_session
from backend.services.polar import (
    PolarAPIError,
    PolarConfigurationError,
    create_checkout_session,
    create_customer_portal_session,
    upsert_plan_from_payload,
)
from backend.services.usage import get_usage_summary

router = APIRouter()


class CheckoutRequest(BaseModel):
    plan_id: str = Field(..., description="Polar product identifier")
    success_url: str | None = Field(None, description="URL to redirect the user after success")
    cancel_url: str | None = Field(None, description="URL to redirect the user if checkout is cancelled")
    customer_email: str | None = Field(None, description="Pre-fill customer email if available")


class PortalRequest(BaseModel):
    return_url: str | None = Field(None, description="Optional URL to navigate to after closing the portal")


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def _verify_webhook(request: Request) -> dict[str, Any]:
    secret = POLAR_WEBHOOK_SECRET.strip() if POLAR_WEBHOOK_SECRET else ""
    if not secret:
        LOGGER.error("Polar webhook received but secret is not configured")
        raise HTTPException(status_code=500, detail="webhook secret not configured")

    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}

    candidates: list[str] = [secret]
    if not secret.startswith("whsec_"):
        candidates.append(base64.b64encode(secret.encode()).decode())
    else:
        raw = secret[len("whsec_") :]
        candidates.append(raw)

    last_error: Exception | None = None
    for candidate in candidates:
        try:
            webhook = Webhook(candidate)
            payload = webhook.verify(body, headers)
            return payload  # type: ignore[return-value]
        except WebhookVerificationError as exc:  # pragma: no cover - depends on secret correctness
            last_error = exc
            continue

    LOGGER.warning("Polar webhook signature verification failed")
    raise HTTPException(status_code=400, detail="invalid signature") from last_error


async def _handle_subscription_event(data: dict[str, Any]) -> None:
    subscription_id = data.get("id")
    if not subscription_id:
        LOGGER.warning("Subscription event missing id: %s", data)
        return

    customer = data.get("customer") or {}
    user_id = customer.get("external_id") or (data.get("metadata") or {}).get("user_id")
    if not user_id:
        LOGGER.warning("Subscription event missing external user id", extra={"id": subscription_id})
        return

    plan = data.get("product") or {}
    await upsert_plan_from_payload(plan)

    plan_id = data.get("product_id") or plan.get("id")
    prices = data.get("prices") or []
    price_id = prices[0].get("id") if prices else None

    async with db_session() as session:
        record = await session.get(Subscription, subscription_id)
        fields = {
            "user_id": user_id,
            "status": data.get("status") or "unknown",
            "plan_id": plan_id,
            "product_id": plan_id,
            "price_id": price_id,
            "cancel_at_period_end": bool(data.get("cancel_at_period_end")),
            "current_period_start": _parse_datetime(data.get("current_period_start")),
            "current_period_end": _parse_datetime(data.get("current_period_end")),
            "customer_id": data.get("customer_id") or customer.get("id"),
            "customer_external_id": user_id,
            "raw_product_json": plan,
            "raw_subscription_json": data,
        }
        if record is None:
            record = Subscription(id=subscription_id, **fields)
            session.add(record)
        else:
            for key, value in fields.items():
                setattr(record, key, value)


@router.post("/billing/checkout")
async def create_checkout_endpoint(request: CheckoutRequest, x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    if not x_user_id:
        return JSONResponse({"error": "missing user id"}, status_code=400)
    try:
        checkout = await create_checkout_session(
            user_id=x_user_id,
            plan_id=request.plan_id,
            success_url=request.success_url,
            cancel_url=request.cancel_url,
            customer_email=request.customer_email,
        )
        usage = await get_usage_summary(x_user_id)
        return {"ok": True, "checkout": checkout, "usage": usage.to_dict()}
    except PolarConfigurationError:
        LOGGER.warning("Checkout attempted without Polar configuration")
        return JSONResponse({"error": "billing not configured"}, status_code=503)
    except PolarAPIError as exc:
        LOGGER.exception("Failed to create Polar checkout")
        return JSONResponse({"error": str(exc)}, status_code=502)


@router.post("/billing/portal")
async def create_portal_endpoint(
    request: PortalRequest,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    if not x_user_id:
        return JSONResponse({"error": "missing user id"}, status_code=400)
    try:
        session = await create_customer_portal_session(user_id=x_user_id)
        usage = await get_usage_summary(x_user_id)
        payload = {"session": session, "return_url": request.return_url} if request.return_url else session
        return {"ok": True, "portal": payload, "usage": usage.to_dict()}
    except PolarConfigurationError:
        LOGGER.warning("Portal requested without Polar configuration")
        return JSONResponse({"error": "billing not configured"}, status_code=503)
    except PolarAPIError as exc:
        LOGGER.exception("Failed to create Polar customer portal session")
        return JSONResponse({"error": str(exc)}, status_code=502)


@router.get("/billing/usage")
async def usage_endpoint(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    if not x_user_id:
        return JSONResponse({"error": "missing user id"}, status_code=400)
    summary = await get_usage_summary(x_user_id)
    return {"ok": True, "usage": summary.to_dict()}


@router.post("/billing/webhook")
async def webhook_endpoint(request: Request):
    payload = await _verify_webhook(request)
    event_type = payload.get("type")
    data = payload.get("data") or {}

    try:
        if event_type and event_type.startswith("subscription."):
            await _handle_subscription_event(data)
        return {"ok": True}
    except Exception:  # pragma: no cover - defensive logging
        LOGGER.exception("Failed to process Polar webhook", extra={"event_type": event_type})
        return JSONResponse({"error": "internal error"}, status_code=500)
