"""Celery task definitions for the VintedBoost backend."""
from __future__ import annotations

import asyncio
from typing import Any

from celery import shared_task


@shared_task(name="backend.tasks.ping")
def ping() -> str:
    """Return a simple pong string so monitoring/health checks work."""
    return "pong"


@shared_task(name="backend.tasks.sleep")
def sleep(seconds: float = 1.0) -> float:
    """Non-blocking sleep helper to validate async compatibility."""
    async def _sleep(duration: float) -> float:
        await asyncio.sleep(max(0.0, duration))
        return duration

    return asyncio.run(_sleep(seconds))


@shared_task(bind=True, name="backend.tasks.dispatch_async")
def dispatch_async(self, coroutine_path: str, *args: Any, **kwargs: Any) -> Any:
    """Utility task to run lightweight async callables by dotted path.

    This keeps the worker flexible without forcing every background call
    into a bespoke task during the initial Celery rollout.
    """
    module_name, _, attr = coroutine_path.rpartition(".")
    if not module_name:
        raise ValueError("coroutine_path must include module, e.g. 'backend.main.some_coroutine'")
    module = __import__(module_name, fromlist=[attr])
    target = getattr(module, attr, None)
    if target is None or not asyncio.iscoroutinefunction(target):
        raise ValueError(f"No async callable named '{coroutine_path}'")

    async def _run() -> Any:
        return await target(*args, **kwargs)

    return asyncio.run(_run())
