"""Helpers for interacting with the Polar API."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Iterable

import httpx
from sqlalchemy import select

from backend.config import LOGGER, POLAR_API_BASE, POLAR_OAT, POLAR_ORG_ID
from backend.db import SubscriptionPlan, db_session


class PolarConfigurationError(RuntimeError):
    """Raised when Polar is not configured but an operation was attempted."""


class PolarAPIError(RuntimeError):
    """Raised when the Polar API returns an error."""


@dataclass(slots=True)
class PolarPlan:
    """Cached representation of a subscription plan/product."""

    id: str
    name: str
    allowance: int
    interval: str | None
    currency: str | None
    default_price_id: str | None
    metadata: Dict[str, Any]
    is_active: bool


_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()
_plan_cache: dict[str, PolarPlan] = {}
_plan_cache_expiry: float = 0.0
_plan_cache_lock = asyncio.Lock()
_PLAN_CACHE_TTL_SECONDS = 300.0


async def _get_client() -> httpx.AsyncClient:
    if not POLAR_API_BASE or not POLAR_OAT:
        raise PolarConfigurationError("Polar API base or access token not configured")

    async with _client_lock:
        global _client
        if _client is None:
            headers = {
                "authorization": f"Bearer {POLAR_OAT}",
                "accept": "application/json",
                "user-agent": "vintedboost-backend/1.0",
            }
            _client = httpx.AsyncClient(
                base_url=POLAR_API_BASE.rstrip("/"),
                timeout=httpx.Timeout(20.0, connect=10.0),
                headers=headers,
            )
        return _client


async def close_polar_client() -> None:
    """Close the shared HTTP client, if created."""

    async with _client_lock:
        global _client
        if _client is not None:
            try:
                await _client.aclose()
            finally:
                _client = None


def _extract_allowance(data: dict[str, Any] | None) -> int:
    if not data:
        return 0
    raw = (
        data.get("metadata", {}).get("allowance")
        or data.get("metadata", {}).get("usage_allowance")
        or data.get("metadata", {}).get("quota")
    )
    if raw is None and data.get("prices"):
        for price in data.get("prices") or []:
            raw = (
                price.get("metadata", {}).get("allowance")
                or price.get("metadata", {}).get("usage_allowance")
                or price.get("metadata", {}).get("quota")
            )
            if raw is not None:
                break
    try:
        return max(0, int(raw)) if raw is not None else 0
    except (TypeError, ValueError):
        return 0


def _plan_from_product(product: dict[str, Any]) -> PolarPlan:
    prices = product.get("prices") or []
    default_price = prices[0] if prices else {}
    return PolarPlan(
        id=product.get("id", ""),
        name=product.get("name", ""),
        allowance=_extract_allowance(product),
        interval=product.get("recurring_interval"),
        currency=default_price.get("currency"),
        default_price_id=default_price.get("id"),
        metadata=product.get("metadata") or {},
        is_active=not product.get("is_archived", False),
    )


async def _persist_plans(plans: Iterable[PolarPlan]) -> None:
    plans = list(plans)
    if not plans:
        return

    async with db_session() as session:
        result = await session.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.id.in_([p.id for p in plans]))
        )
        existing = {plan.id: plan for plan in result.scalars()}
        for plan in plans:
            record = existing.get(plan.id)
            if record:
                record.name = plan.name
                record.allowance = plan.allowance
                record.interval = plan.interval
                record.currency = plan.currency
                record.default_price_id = plan.default_price_id
                record.metadata_json = plan.metadata
                record.is_active = plan.is_active
            else:
                session.add(
                    SubscriptionPlan(
                        id=plan.id,
                        name=plan.name,
                        allowance=plan.allowance,
                        interval=plan.interval,
                        currency=plan.currency,
                        default_price_id=plan.default_price_id,
                        metadata_json=plan.metadata,
                        is_active=plan.is_active,
                    )
                )


async def _request(method: str, path: str, *, json: Any | None = None, params: dict[str, Any] | None = None) -> Any:
    client = await _get_client()
    try:
        response = await client.request(method, path, json=json, params=params)
    except httpx.HTTPError as exc:
        LOGGER.exception("Polar request transport error", extra={"path": path})
        raise PolarAPIError(f"Polar request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text or response.reason_phrase
        LOGGER.error(
            "Polar API error", extra={"status": response.status_code, "path": path, "detail": detail[:256]}
        )
        raise PolarAPIError(f"Polar API {response.status_code}: {detail}")

    if response.status_code == 204:
        return None
    return response.json()


async def refresh_plan_cache(force: bool = False) -> dict[str, PolarPlan]:
    """Fetch subscription plans from Polar and refresh cache/DB."""

    now = asyncio.get_running_loop().time()
    async with _plan_cache_lock:
        if not force and _plan_cache and now < _plan_cache_expiry:
            return dict(_plan_cache)

    params: dict[str, Any] = {
        "is_recurring": True,
        "is_archived": False,
        "limit": 50,
    }
    if POLAR_ORG_ID:
        params["organization_id"] = POLAR_ORG_ID

    payload = await _request("GET", "/products/", params=params)
    items = payload.get("items", []) if isinstance(payload, dict) else []
    plans = [_plan_from_product(item) for item in items if item.get("id")]

    await _persist_plans(plans)

    async with _plan_cache_lock:
        _plan_cache.clear()
        _plan_cache.update({plan.id: plan for plan in plans})
        _plan_cache_expiry = asyncio.get_running_loop().time() + _PLAN_CACHE_TTL_SECONDS
        return dict(_plan_cache)


async def list_cached_plans() -> list[PolarPlan]:
    """Return cached plans, refreshing if necessary."""

    plans = await refresh_plan_cache(force=False)
    return list(plans.values())


async def get_plan(plan_id: str, *, refresh: bool = True) -> PolarPlan | None:
    if not plan_id:
        return None
    async with _plan_cache_lock:
        plan = _plan_cache.get(plan_id)
    if plan and not refresh:
        return plan

    if refresh or plan is None:
        plans = await refresh_plan_cache(force=plan is None)
        plan = plans.get(plan_id)

    if plan is None:
        # Last attempt: try loading from DB without hitting the API again.
        async with db_session() as session:
            record = await session.get(SubscriptionPlan, plan_id)
            if record:
                plan = PolarPlan(
                    id=record.id,
                    name=record.name,
                    allowance=record.allowance,
                    interval=record.interval,
                    currency=record.currency,
                    default_price_id=record.default_price_id,
                    metadata=record.metadata_json or {},
                    is_active=record.is_active,
                )
                async with _plan_cache_lock:
                    _plan_cache[plan.id] = plan
    return plan


async def upsert_plan_from_payload(product: dict[str, Any] | None) -> PolarPlan | None:
    """Update plan cache/DB using a product payload embedded in a webhook."""

    if not product or not product.get("id"):
        return None

    plan = _plan_from_product(product)
    await _persist_plans([plan])
    async with _plan_cache_lock:
        _plan_cache[plan.id] = plan
        return plan


async def create_checkout_session(
    *,
    user_id: str,
    plan_id: str,
    success_url: str | None = None,
    cancel_url: str | None = None,
    customer_email: str | None = None,
) -> dict[str, Any]:
    """Create a Polar checkout session for the given plan."""

    payload: dict[str, Any] = {
        "products": [plan_id],
        "external_customer_id": user_id,
        "metadata": {"user_id": user_id},
        "customer_metadata": {"user_id": user_id},
    }
    if success_url:
        payload["success_url"] = success_url
    if cancel_url:
        payload["cancel_url"] = cancel_url
    if customer_email:
        payload["customer_email"] = customer_email

    data = await _request("POST", "/checkouts/", json=payload)
    if isinstance(data, dict):
        return data
    return {"id": None, "url": None}


async def create_customer_portal_session(*, user_id: str) -> dict[str, Any]:
    """Create a Polar customer session using the external user identifier."""

    payload = {"external_customer_id": user_id}
    return await _request("POST", "/customer-sessions/", json=payload)
