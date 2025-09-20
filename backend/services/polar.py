"""Helpers for interacting with the Polar API."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Iterable, Optional

import httpx
from polar_sdk import Polar, models as polar_models
from polar_sdk.sdkconfiguration import SERVER_PRODUCTION, SERVER_SANDBOX, SERVERS
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


_sdk: Polar | None = None
_sdk_lock = asyncio.Lock()
_plan_cache: dict[str, PolarPlan] = {}
_plan_cache_expiry: float = 0.0
_plan_cache_lock = asyncio.Lock()
_PLAN_CACHE_TTL_SECONDS = 300.0


def _resolve_server() -> tuple[Optional[str], Optional[str]]:
    base = (POLAR_API_BASE or "https://api.polar.sh/v1").strip()
    base = base.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]

    if base == SERVERS[SERVER_PRODUCTION]:
        return SERVER_PRODUCTION, None
    if base == SERVERS[SERVER_SANDBOX]:
        return SERVER_SANDBOX, None
    if base:
        return None, base
    return SERVER_PRODUCTION, None


def _build_polar_client() -> Polar:
    server, server_url = _resolve_server()
    client = Polar(
        access_token=POLAR_OAT,
        server=server,
        server_url=server_url,
        timeout_ms=20_000,
    )
    # Preserve prior custom user agent for observability parity
    client.sdk_configuration.user_agent = "vintedboost-backend/1.0"
    return client


async def _get_client() -> Polar:
    if not POLAR_API_BASE or not POLAR_OAT:
        raise PolarConfigurationError("Polar API base or access token not configured")

    async with _sdk_lock:
        global _sdk
        if _sdk is None:
            _sdk = _build_polar_client()
        return _sdk


async def close_polar_client() -> None:
    """Close the shared Polar SDK client, if created."""

    async with _sdk_lock:
        global _sdk
        if _sdk is None:
            return

        cfg = _sdk.sdk_configuration
        try:
            if cfg.client is not None and not cfg.client_supplied:
                try:
                    cfg.client.close()
                finally:
                    cfg.client = None
            if cfg.async_client is not None and not cfg.async_client_supplied:
                try:
                    await cfg.async_client.aclose()
                finally:
                    cfg.async_client = None
        finally:
            _sdk = None


def _extract_allowance(data: dict[str, Any] | None) -> int:
    if not data:
        return 0
    metadata = data.get("metadata") or {}

    def pick(meta: dict[str, Any]) -> Any:
        for key in ("gen_allowance", "allowance", "usage_allowance", "quota"):
            if key in meta:
                return meta[key]
            if f"{key}:" in meta:
                return meta[f"{key}:"]
        # handle sloppy keys with whitespace
        for k, v in meta.items():
            if isinstance(k, str) and k.strip(": ") in {"gen_allowance", "allowance", "usage_allowance", "quota"}:
                return v
        return None

    raw = pick(metadata)
    if raw is None and data.get("prices"):
        for price in data.get("prices") or []:
            raw = pick(price.get("metadata") or {})
            if raw is not None:
                break
    try:
        return max(0, int(raw)) if raw is not None else 0
    except (TypeError, ValueError):
        return 0


def _coerce_dict(payload: Any) -> dict[str, Any]:
    if payload is None:
        return {}
    if isinstance(payload, dict):
        return dict(payload)
    if hasattr(payload, "model_dump"):
        try:
            return payload.model_dump(mode="json")  # type: ignore[call-arg]
        except TypeError:
            return payload.model_dump()  # type: ignore[call-arg]
    return {}


def _plan_from_product(product_obj: Any) -> PolarPlan:
    product = _coerce_dict(product_obj)
    prices_raw = product.get("prices") or []
    prices = [_coerce_dict(price) for price in prices_raw]
    default_price = prices[0] if prices else {}
    currency = (
        default_price.get("currency")
        or default_price.get("price_currency")
        or default_price.get("priceCurrency")
    )
    return PolarPlan(
        id=product.get("id", ""),
        name=product.get("name", ""),
        allowance=_extract_allowance(product),
        interval=product.get("recurring_interval"),
        currency=currency,
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


async def refresh_plan_cache(force: bool = False) -> dict[str, PolarPlan]:
    """Fetch subscription plans from Polar and refresh cache/DB."""

    global _plan_cache_expiry

    now = asyncio.get_running_loop().time()
    async with _plan_cache_lock:
        if not force and _plan_cache and now < _plan_cache_expiry:
            return dict(_plan_cache)

    client = await _get_client()
    request_kwargs: dict[str, Any] = {
        "is_recurring": True,
        "is_archived": False,
        "limit": 50,
    }
    if POLAR_ORG_ID:
        request_kwargs["organization_id"] = POLAR_ORG_ID

    try:
        response = await client.products.list_async(**request_kwargs)
    except (polar_models.SDKError, polar_models.HTTPValidationError) as exc:
        LOGGER.exception("Polar products request failed")
        raise PolarAPIError(f"Polar products request failed: {exc}") from exc
    except httpx.HTTPError as exc:
        LOGGER.exception("Polar products transport error")
        raise PolarAPIError(f"Polar transport error: {exc}") from exc

    products: list[dict[str, Any]] = []
    while response is not None:
        result = getattr(response, "result", None)
        if result and getattr(result, "items", None):
            products.extend(_coerce_dict(item) for item in result.items)
        fetch_next = getattr(response, "next", None)
        if callable(fetch_next):
            try:
                response = await fetch_next()
            except (polar_models.SDKError, polar_models.HTTPValidationError) as exc:
                LOGGER.exception("Polar products pagination failed")
                raise PolarAPIError(f"Polar products pagination failed: {exc}") from exc
            except httpx.HTTPError as exc:
                LOGGER.exception("Polar products pagination transport error")
                raise PolarAPIError(f"Polar transport error: {exc}") from exc
        else:
            break

    plans = [_plan_from_product(item) for item in products if item.get("id")]

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

    product_data = _coerce_dict(product)
    if not product_data or not product_data.get("id"):
        return None

    plan = _plan_from_product(product_data)
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

    client = await _get_client()
    try:
        checkout = await client.checkouts.create_async(request=payload)
    except (polar_models.SDKError, polar_models.HTTPValidationError) as exc:
        LOGGER.exception("Polar checkout creation failed", extra={"plan_id": plan_id, "user_id": user_id})
        raise PolarAPIError(f"Polar checkout creation failed: {exc}") from exc
    except httpx.HTTPError as exc:
        LOGGER.exception("Polar checkout transport error", extra={"plan_id": plan_id, "user_id": user_id})
        raise PolarAPIError(f"Polar transport error: {exc}") from exc

    return _coerce_dict(checkout)


async def create_customer_portal_session(*, user_id: str) -> dict[str, Any]:
    """Create a Polar customer session using the external user identifier."""

    client = await _get_client()
    try:
        session = await client.customer_sessions.create_async(
            request={"external_customer_id": user_id}
        )
    except (polar_models.SDKError, polar_models.HTTPValidationError) as exc:
        LOGGER.exception("Polar portal session failed", extra={"user_id": user_id})
        raise PolarAPIError(f"Polar portal session failed: {exc}") from exc
    except httpx.HTTPError as exc:
        LOGGER.exception("Polar portal transport error", extra={"user_id": user_id})
        raise PolarAPIError(f"Polar transport error: {exc}") from exc

    return _coerce_dict(session)


async def ingest_events(events: Iterable[dict[str, Any]]) -> None:
    """Ingest usage events into Polar."""

    normalized: list[dict[str, Any]] = []
    for event in events:
        payload = _coerce_dict(event)
        if not payload.get("name") or not payload.get("external_customer_id"):
            continue
        if POLAR_ORG_ID and not payload.get("organization_id"):
            payload["organization_id"] = POLAR_ORG_ID
        normalized.append(payload)

    if not normalized:
        return

    client = await _get_client()
    try:
        await client.events.ingest_async(request={"events": normalized})
    except (polar_models.SDKError, polar_models.HTTPValidationError) as exc:
        LOGGER.exception("Polar event ingestion failed", extra={"count": len(normalized)})
        raise PolarAPIError(f"Polar event ingestion failed: {exc}") from exc
    except httpx.HTTPError as exc:
        LOGGER.exception("Polar event ingestion transport error", extra={"count": len(normalized)})
        raise PolarAPIError(f"Polar transport error: {exc}") from exc


async def list_customer_meters(
    *,
    external_customer_id: str,
    meter_id: str | None = None,
) -> list[dict[str, Any]]:
    """Fetch customer meter balances for a user."""

    if not external_customer_id:
        return []

    client = await _get_client()
    params: dict[str, Any] = {
        "external_customer_id": external_customer_id,
        "limit": 50,
    }
    if meter_id:
        params["meter_id"] = meter_id
    if POLAR_ORG_ID:
        params["organization_id"] = POLAR_ORG_ID

    try:
        response = await client.customer_meters.list_async(**params)
    except (polar_models.SDKError, polar_models.HTTPValidationError) as exc:
        LOGGER.exception("Polar customer meters request failed", extra={"external_customer_id": external_customer_id})
        raise PolarAPIError(f"Polar customer meters request failed: {exc}") from exc
    except httpx.HTTPError as exc:
        LOGGER.exception("Polar customer meters transport error", extra={"external_customer_id": external_customer_id})
        raise PolarAPIError(f"Polar transport error: {exc}") from exc

    meters: list[dict[str, Any]] = []
    while response is not None:
        result = getattr(response, "result", None)
        if result and getattr(result, "items", None):
            meters.extend(_coerce_dict(item) for item in result.items)
        fetch_next = getattr(response, "next", None)
        if callable(fetch_next):
            try:
                response = await fetch_next()
            except (polar_models.SDKError, polar_models.HTTPValidationError) as exc:
                LOGGER.exception("Polar customer meters pagination failed", extra={"external_customer_id": external_customer_id})
                raise PolarAPIError(f"Polar customer meters pagination failed: {exc}") from exc
            except httpx.HTTPError as exc:
                LOGGER.exception("Polar customer meters pagination transport error", extra={"external_customer_id": external_customer_id})
                raise PolarAPIError(f"Polar transport error: {exc}") from exc
        else:
            break

    return meters
