"""Async Redis client helpers used across the API."""
from __future__ import annotations

import asyncio
from typing import Any

from backend.config import (
    LOGGER,
    REDIS_OP_TIMEOUT_SECONDS,
    REDIS_OPERATION_RETRIES,
    REDIS_RETRY_BACKOFF_SECONDS,
    REDIS_URL,
)

try:  # optional dependency
    from redis import asyncio as redis_asyncio  # type: ignore[attr-defined]
except Exception:  # pragma: no cover - optional dependency guard
    redis_asyncio = None  # type: ignore[assignment]


_redis_client: Any | None = None
_redis_retry_at: float | None = None
_redis_connect_lock = asyncio.Lock()


async def get_redis_client() -> Any | None:
    """Return a shared Redis client when REDIS_URL is configured."""

    global _redis_client, _redis_retry_at
    if not REDIS_URL or redis_asyncio is None:
        return None
    if _redis_client is not None:
        return _redis_client
    loop = asyncio.get_running_loop()
    now = loop.time()
    if _redis_retry_at and now < _redis_retry_at:
        return None
    async with _redis_connect_lock:
        if _redis_client is not None:
            return _redis_client
        loop = asyncio.get_running_loop()
        now = loop.time()
        if _redis_retry_at and now < _redis_retry_at:
            return None
        candidate: Any | None = None
        try:
            candidate = redis_asyncio.from_url(  # type: ignore[union-attr]
                REDIS_URL,
                encoding="utf-8",
                decode_responses=False,
                socket_timeout=REDIS_OP_TIMEOUT_SECONDS,
                socket_connect_timeout=REDIS_OP_TIMEOUT_SECONDS,
                retry_on_timeout=False,
            )
            await asyncio.wait_for(candidate.ping(), timeout=REDIS_OP_TIMEOUT_SECONDS)
        except Exception as exc:  # pragma: no cover - network errors
            LOGGER.warning("Failed to initialize Redis client: %s", exc)
            _redis_client = None
            _redis_retry_at = now + REDIS_RETRY_BACKOFF_SECONDS
            if candidate is not None:
                try:
                    await candidate.close()
                except Exception:
                    pass
            return None
        _redis_client = candidate
        _redis_retry_at = None
        return _redis_client


async def record_redis_failure(exc: Exception) -> None:
    """Invalidate the active Redis client following an operational error."""

    global _redis_client, _redis_retry_at
    loop = asyncio.get_running_loop()
    _redis_retry_at = loop.time() + REDIS_RETRY_BACKOFF_SECONDS
    client = _redis_client
    _redis_client = None
    if client is not None:
        try:
            await client.close()
        except Exception:
            pass
    LOGGER.warning("Redis unavailable, falling back to local cache: %s", exc)


async def close_redis_client() -> None:
    """Close and clear the global Redis client."""

    global _redis_client
    client = _redis_client
    _redis_client = None
    if client is not None:
        try:
            await client.close()
        except Exception:
            pass


__all__ = ["close_redis_client", "get_redis_client", "record_redis_failure", "redis_asyncio"]
