"""Subscription usage helpers and quota enforcement."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Select, select

from backend.db import Subscription, SubscriptionPlan, UsageCounter, db_session
from backend.services.polar import PolarPlan, get_plan

_ACTIVE_STATUSES = {"active", "trialing", "past_due"}


def _now_utc() -> datetime:
    return datetime.utcnow()


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
    allowance: int
    used: int
    remaining: int
    period_start: datetime | None
    period_end: datetime | None

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
        if self.status in _ACTIVE_STATUSES:
            self.allowance = max(plan.allowance, 0)
            self.remaining = max(self.allowance - self.used, 0)


class QuotaError(RuntimeError):
    """Raised when a user attempts to operate without quota."""

    def __init__(self, summary: UsageSummary) -> None:
        super().__init__("quota exceeded")
        self.summary = summary


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


def _is_subscription_active(subscription: Subscription | None) -> bool:
    if not subscription:
        return False
    status = (subscription.status or "").lower()
    return status in _ACTIVE_STATUSES


def _build_summary(
    user_id: str,
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
    allowance = max(plan.allowance, 0) if plan else 0
    used = usage.used if usage else 0
    period_start = subscription.current_period_start if subscription else None
    period_end = subscription.current_period_end if subscription else None

    if not _is_subscription_active(subscription):
        allowance = 0

    remaining = max(allowance - used, 0)

    return UsageSummary(
        user_id=user_id,
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
    )


async def get_usage_summary(user_id: str) -> UsageSummary:
    subscription: Subscription | None = None
    plan: SubscriptionPlan | None = None
    usage: UsageCounter | None = None

    async with db_session() as session:
        subscription = await _select_subscription(session, user_id)
        if subscription and subscription.plan_id:
            plan = await session.get(SubscriptionPlan, subscription.plan_id)
        usage = await _ensure_usage_record(session, user_id, subscription)

    summary = _build_summary(user_id, subscription, plan, usage)
    if subscription and subscription.plan_id and plan is None:
        polar_plan = await get_plan(subscription.plan_id, refresh=False)
        if polar_plan:
            summary.apply_plan(polar_plan)
    return summary


async def ensure_can_consume(user_id: str, amount: int = 1) -> UsageSummary:
    summary = await get_usage_summary(user_id)
    if amount > 0 and summary.remaining < amount:
        raise QuotaError(summary)
    return summary


async def consume_quota(user_id: str, amount: int = 1) -> UsageSummary:
    if amount <= 0:
        return await get_usage_summary(user_id)

    subscription: Subscription | None = None
    plan: SubscriptionPlan | None = None
    usage: UsageCounter | None = None

    async with db_session() as session:
        subscription = await _select_subscription(session, user_id)
        if not subscription:
            summary = _build_summary(user_id, None, None, None)
            raise QuotaError(summary)

        if subscription.plan_id:
            plan = await session.get(SubscriptionPlan, subscription.plan_id)
        usage = await _ensure_usage_record(session, user_id, subscription)
        summary = _build_summary(user_id, subscription, plan, usage)
        if summary.remaining < amount:
            raise QuotaError(summary)
        if usage is None:
            raise QuotaError(summary)

        usage.used = usage.used + amount
        usage.updated_at = _now_utc()
        summary = _build_summary(user_id, subscription, plan, usage)

    if subscription and subscription.plan_id and plan is None:
        polar_plan = await get_plan(subscription.plan_id, refresh=False)
        if polar_plan:
            summary.apply_plan(polar_plan)
    return summary
