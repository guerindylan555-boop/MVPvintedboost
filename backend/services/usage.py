"""Subscription usage helpers and quota enforcement."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy import Select, select

from backend.db import Subscription, SubscriptionPlan, UsageCounter, db_session
from backend.services.admin import has_admin_configuration, is_admin_identifier
from backend.services.polar import PolarPlan, get_plan
from backend.services.usage_rules import (
    USAGE_PRECISION,
    amount_to_units,
    get_operation_costs,
    units_to_amount,
)

_ACTIVE_STATUSES = {"active", "trialing", "past_due"}


def _now_utc() -> datetime:
    return datetime.utcnow()


@dataclass(slots=True)
class UsageIdentity:
    """Identity data used to evaluate quota and admin overrides."""

    user_id: str
    email: str | None = None
    is_admin_hint: bool = False

    @property
    def is_admin(self) -> bool:
        if self.is_admin_hint:
            return True
        if is_admin_identifier(self.email):
            return True
        if has_admin_configuration():
            return is_admin_identifier(self.user_id)
        return False


@dataclass(slots=True)
class UsageSummary:
    """Represents a user's usage status for the current billing period."""

    user_id: str
    plan_id: str | None
    plan_name: str | None
    plan_interval: str | None
    currency: str | None
    status: str | None
    cancel_at_period_end: bool
    allowance: float | None
    used: float
    remaining: float | None
    period_start: datetime | None
    period_end: datetime | None
    allowance_units: int
    used_units: int
    remaining_units: int
    precision: int
    is_unlimited: bool
    costs: dict[str, float]

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan": {
                "id": self.plan_id,
                "name": self.plan_name,
                "interval": self.plan_interval,
                "currency": self.currency,
                "status": self.status,
                "cancel_at_period_end": self.cancel_at_period_end,
            },
            "allowance": self.allowance,
            "used": self.used,
            "remaining": self.remaining,
            "period": {
                "start": self.period_start.isoformat() if self.period_start else None,
                "end": self.period_end.isoformat() if self.period_end else None,
            },
            "precision": self.precision,
            "is_unlimited": self.is_unlimited,
            "costs": dict(self.costs),
        }

    def apply_plan(self, plan: PolarPlan) -> None:
        if plan.id:
            self.plan_id = plan.id
        if plan.name:
            self.plan_name = plan.name
        if plan.interval:
            self.plan_interval = plan.interval
        if plan.currency:
            self.currency = plan.currency
        if self.status in _ACTIVE_STATUSES and not self.is_unlimited:
            allowance_units = amount_to_units(plan.allowance)
            self.allowance_units = allowance_units
            self.allowance = units_to_amount(allowance_units)
            self.remaining_units = max(allowance_units - self.used_units, 0)
            self.remaining = units_to_amount(self.remaining_units)


class QuotaError(RuntimeError):
    """Raised when a user attempts to operate without quota."""

    def __init__(self, summary: UsageSummary) -> None:
        super().__init__("quota exceeded")
        self.summary = summary


def build_usage_identity(
    user_id: str,
    *,
    email: str | None = None,
    is_admin_hint: bool | None = None,
) -> UsageIdentity:
    return UsageIdentity(
        user_id=user_id,
        email=email,
        is_admin_hint=bool(is_admin_hint),
    )


def _coerce_identity(
    identity: UsageIdentity | str,
    *,
    email: str | None = None,
    is_admin: bool | None = None,
) -> UsageIdentity:
    if isinstance(identity, UsageIdentity):
        return UsageIdentity(
            user_id=identity.user_id,
            email=identity.email if identity.email is not None else email,
            is_admin_hint=identity.is_admin_hint or bool(is_admin),
        )
    return UsageIdentity(user_id=identity, email=email, is_admin_hint=bool(is_admin))


async def _select_subscription(session, user_id: str) -> Subscription | None:
    stmt: Select[Subscription] = (
        select(Subscription)
        .where(Subscription.user_id == user_id)
        .order_by(Subscription.current_period_end.desc().nullslast(), Subscription.created_at.desc())
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalars().first()


async def _ensure_usage_record(
    session,
    user_id: str,
    subscription: Subscription | None,
) -> UsageCounter | None:
    if not subscription:
        return None
    period_start = subscription.current_period_start
    if not period_start:
        return None
    period_end = subscription.current_period_end

    stmt: Select[UsageCounter] = select(UsageCounter).where(
        UsageCounter.user_id == user_id,
        UsageCounter.period_start == period_start,
    )
    result = await session.execute(stmt)
    usage = result.scalars().first()

    if usage is None:
        usage = UsageCounter(
            user_id=user_id,
            period_start=period_start,
            period_end=period_end,
            used=0,
        )
        session.add(usage)
        await session.flush()
        return usage

    reset_needed = usage.period_start != period_start
    if reset_needed:
        usage.period_start = period_start
        usage.used = 0
    if usage.period_end != period_end:
        usage.period_end = period_end
    if reset_needed:
        usage.updated_at = _now_utc()
    return usage


async def _load_usage_state(
    session,
    identity: UsageIdentity,
) -> tuple[Subscription | None, SubscriptionPlan | None, UsageCounter | None]:
    subscription = await _select_subscription(session, identity.user_id)
    plan: SubscriptionPlan | None = None
    if subscription and subscription.plan_id:
        plan = await session.get(SubscriptionPlan, subscription.plan_id)
    usage = await _ensure_usage_record(session, identity.user_id, subscription)
    return subscription, plan, usage


def _is_subscription_active(subscription: Subscription | None) -> bool:
    if not subscription:
        return False
    status = (subscription.status or "").lower()
    return status in _ACTIVE_STATUSES


def _build_summary(
    identity: UsageIdentity,
    subscription: Subscription | None,
    plan: SubscriptionPlan | None,
    usage: UsageCounter | None,
) -> UsageSummary:
    plan_id = subscription.plan_id if subscription else None
    plan_name = plan.name if plan else None
    plan_interval = plan.interval if plan else None
    currency = plan.currency if plan else None
    status = subscription.status if subscription else None
    cancel_at_period_end = bool(subscription.cancel_at_period_end) if subscription else False

    allowance_units = 0
    if plan and _is_subscription_active(subscription):
        allowance_units = amount_to_units(plan.allowance)
    used_units = usage.used if usage else 0
    remaining_units = max(allowance_units - used_units, 0)

    allowance = units_to_amount(allowance_units) if allowance_units else 0.0
    used = units_to_amount(used_units)
    remaining = units_to_amount(remaining_units)
    period_start = subscription.current_period_start if subscription else None
    period_end = subscription.current_period_end if subscription else None

    summary = UsageSummary(
        user_id=identity.user_id,
        plan_id=plan_id,
        plan_name=plan_name,
        plan_interval=plan_interval,
        currency=currency,
        status=status,
        cancel_at_period_end=cancel_at_period_end,
        allowance=allowance,
        used=used,
        remaining=remaining,
        period_start=period_start,
        period_end=period_end,
        allowance_units=allowance_units,
        used_units=used_units,
        remaining_units=remaining_units,
        precision=USAGE_PRECISION,
        is_unlimited=identity.is_admin,
        costs=get_operation_costs(),
    )

    if summary.is_unlimited:
        summary.remaining = None
        summary.remaining_units = 0

    return summary


async def get_usage_summary(
    identity: UsageIdentity | str,
    *,
    email: str | None = None,
    is_admin: bool | None = None,
) -> UsageSummary:
    ident = _coerce_identity(identity, email=email, is_admin=is_admin)

    async with db_session() as session:
        subscription, plan, usage = await _load_usage_state(session, ident)

    summary = _build_summary(ident, subscription, plan, usage)
    if subscription and subscription.plan_id and plan is None:
        polar_plan = await get_plan(subscription.plan_id, refresh=False)
        if polar_plan:
            summary.apply_plan(polar_plan)
    return summary


async def ensure_can_consume(
    identity: UsageIdentity | str,
    amount: float = 1.0,
    *,
    email: str | None = None,
    is_admin: bool | None = None,
) -> UsageSummary:
    summary = await get_usage_summary(identity, email=email, is_admin=is_admin)
    ident = _coerce_identity(identity, email=email, is_admin=is_admin)
    if ident.is_admin:
        return summary
    amount_units = amount_to_units(amount)
    if amount_units > 0 and summary.remaining_units < amount_units:
        raise QuotaError(summary)
    return summary


async def _consume_with_session(
    session,
    identity: UsageIdentity,
    amount: float,
) -> UsageSummary:
    if identity.is_admin or amount <= 0:
        subscription, plan, usage = await _load_usage_state(session, identity)
        return _build_summary(identity, subscription, plan, usage)

    amount_units = amount_to_units(amount)
    if amount_units <= 0:
        subscription, plan, usage = await _load_usage_state(session, identity)
        return _build_summary(identity, subscription, plan, usage)

    subscription, plan, usage = await _load_usage_state(session, identity)
    if not subscription:
        summary = _build_summary(identity, None, None, None)
        raise QuotaError(summary)

    summary = _build_summary(identity, subscription, plan, usage)
    if summary.remaining_units < amount_units:
        raise QuotaError(summary)
    if usage is None:
        raise QuotaError(summary)

    usage.used = usage.used + amount_units
    usage.updated_at = _now_utc()
    summary = _build_summary(identity, subscription, plan, usage)
    return summary


async def consume_quota(
    identity: UsageIdentity | str,
    amount: float = 1.0,
    *,
    email: str | None = None,
    is_admin: bool | None = None,
) -> UsageSummary:
    ident = _coerce_identity(identity, email=email, is_admin=is_admin)

    async with db_session() as session:
        summary = await _consume_with_session(session, ident, amount)

    if summary.plan_id and summary.plan_name is None:
        polar_plan = await get_plan(summary.plan_id, refresh=False)
        if polar_plan:
            summary.apply_plan(polar_plan)
    return summary


async def consume_quota_with_session(
    session,
    identity: UsageIdentity | str,
    amount: float,
    *,
    email: str | None = None,
    is_admin: bool | None = None,
) -> UsageSummary:
    ident = _coerce_identity(identity, email=email, is_admin=is_admin)
    summary = await _consume_with_session(session, ident, amount)
    if summary.plan_id and summary.plan_name is None:
        polar_plan = await get_plan(summary.plan_id, refresh=False)
        if polar_plan:
            summary.apply_plan(polar_plan)
    return summary


async def sync_usage_period(user_id: str) -> None:
    identity = UsageIdentity(user_id=user_id)
    async with db_session() as session:
        await _load_usage_state(session, identity)


async def apply_usage_refresh(
    session,
    identities: Iterable[UsageIdentity],
) -> None:
    for identity in identities:
        await _load_usage_state(session, identity)
