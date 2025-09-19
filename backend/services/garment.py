"""Garment classification helpers with optional Redis caching."""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from typing import Any, Optional

from google.genai import types

from backend.config import (
    GARMENT_TYPE_CACHE_PREFIX,
    GARMENT_TYPE_CACHE_VERSION,
    GARMENT_TYPE_CLASSIFY,
    GARMENT_TYPE_LOCK_TTL_SECONDS,
    GARMENT_TYPE_LOCK_WAIT_SECONDS,
    GARMENT_TYPE_TTL_SECONDS,
    MODEL,
    REDIS_OP_TIMEOUT_SECONDS,
    REDIS_OPERATION_RETRIES,
)
from backend.core.redis import get_redis_client, record_redis_failure
from backend.services.genai import genai_generate_with_retries

_garment_type_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_local_singleflight_locks: dict[str, asyncio.Lock] = {}
_local_singleflight_guard = asyncio.Lock()


def _hash_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def _cache_key(image_hash: str) -> str:
    return f"{GARMENT_TYPE_CACHE_PREFIX}:{GARMENT_TYPE_CACHE_VERSION}:{image_hash}"


def _lock_key(image_hash: str) -> str:
    return f"{GARMENT_TYPE_CACHE_PREFIX}:lock:{GARMENT_TYPE_CACHE_VERSION}:{image_hash}"


def _build_cache_payload(garment_type: str, *, origin: str, ts: float) -> dict[str, Any]:
    return {
        "type": garment_type,
        "origin": origin,
        "ts": ts,
        "model_id": MODEL,
    }


async def _get_local_singleflight_lock(image_hash: str) -> asyncio.Lock:
    async with _local_singleflight_guard:
        lock = _local_singleflight_locks.get(image_hash)
        if lock is None:
            lock = asyncio.Lock()
            _local_singleflight_locks[image_hash] = lock
        return lock


async def _redis_execute(fn):
    attempts = max(1, REDIS_OPERATION_RETRIES + 1)
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            return await asyncio.wait_for(fn(), timeout=REDIS_OP_TIMEOUT_SECONDS)
        except (asyncio.TimeoutError, Exception) as exc:
            last_exc = exc
            if attempt >= attempts - 1:
                raise
            await asyncio.sleep(min(0.2, 0.05 * (attempt + 1)))
    if last_exc is not None:
        raise last_exc
    return None


def _decode_cache_payload(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw_str = raw.decode("utf-8", "ignore")
    else:
        raw_str = str(raw)
    try:
        payload = json.loads(raw_str)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    garment_type = payload.get("type")
    if not isinstance(garment_type, str):
        return None
    normalized = _normalize_garment_type(garment_type)
    if not normalized:
        return None
    payload["type"] = normalized
    return payload


async def _redis_get_payload(redis_client: Any, redis_key: str) -> dict[str, Any] | None:
    raw = await _redis_execute(lambda: redis_client.get(redis_key))
    return _decode_cache_payload(raw)


async def _redis_set_payload(redis_client: Any, redis_key: str, payload: dict[str, Any]) -> None:
    data = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    await _redis_execute(lambda: redis_client.set(redis_key, data, ex=GARMENT_TYPE_TTL_SECONDS))


async def _acquire_redis_lock(redis_client: Any, lock_key: str, token: str) -> bool:
    result = await _redis_execute(
        lambda: redis_client.set(lock_key, token, nx=True, ex=GARMENT_TYPE_LOCK_TTL_SECONDS)
    )
    return bool(result)


async def _release_redis_lock(redis_client: Any, lock_key: str, token: str) -> None:
    script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
    try:
        await _redis_execute(lambda: redis_client.eval(script, 1, lock_key, token))
    except Exception:
        pass


async def _wait_for_redis_payload(
    redis_client: Any, redis_key: str, lock_key: str, *, deadline: float
) -> dict[str, Any] | None:
    loop = asyncio.get_running_loop()
    while loop.time() < deadline:
        try:
            payload = await _redis_get_payload(redis_client, redis_key)
        except Exception as exc:
            await record_redis_failure(exc)
            return None
        if payload:
            return payload
        try:
            lock_exists = await _redis_execute(lambda: redis_client.exists(lock_key))
        except Exception as exc:
            await record_redis_failure(exc)
            return None
        if not lock_exists:
            try:
                payload = await _redis_get_payload(redis_client, redis_key)
            except Exception as exc:
                await record_redis_failure(exc)
                return None
            return payload
        await asyncio.sleep(0.1)
    return None


def _normalize_garment_type(label: str) -> Optional[str]:
    s = (label or "").strip().lower()
    if s in ("top", "bottom", "full"):
        return s
    if any(
        k in s
        for k in (
            "dress",
            "jumpsuit",
            "romper",
            "boilersuit",
            "overalls",
            "pinafore",
            "catsuit",
            "unitard",
            "one-piece",
            "one piece",
        )
    ):
        return "full"
    if any(k in s for k in ("jeans", "pants", "trousers", "shorts", "skirt", "leggings", "bottom")):
        return "bottom"
    if any(
        k in s
        for k in (
            "t-shirt",
            "tshirt",
            "shirt",
            "blouse",
            "sweater",
            "jumper",
            "hoodie",
            "cardigan",
            "jacket",
            "coat",
            "vest",
            "bodysuit",
            "top",
        )
    ):
        return "top"
    return None


async def classify_garment_type(image_png: bytes, override: Optional[str] = None) -> str:
    """Classify garment coverage. Returns one of: top|bottom|full."""

    normalized_override = _normalize_garment_type(override or "") if override else None
    if normalized_override:
        return normalized_override
    if not GARMENT_TYPE_CLASSIFY:
        return "full"

    loop = asyncio.get_running_loop()
    image_hash = _hash_bytes(image_png)
    now = loop.time()
    cached_entry = _garment_type_cache.get(image_hash)
    if cached_entry and cached_entry[0] > now:
        return cached_entry[1]["type"]

    redis_client = await get_redis_client()
    redis_key = _cache_key(image_hash)
    lock_key = _lock_key(image_hash)
    if redis_client and GARMENT_TYPE_TTL_SECONDS > 0:
        try:
            payload = await _redis_get_payload(redis_client, redis_key)
        except Exception as exc:  # pragma: no cover - network errors
            await record_redis_failure(exc)
            redis_client = None
        else:
            if payload:
                _garment_type_cache[image_hash] = (
                    loop.time() + GARMENT_TYPE_TTL_SECONDS,
                    payload,
                )
                return payload["type"]

    lock_token = uuid.uuid4().hex
    redis_lock_acquired = False
    lock_client: Any | None = None
    local_lock: asyncio.Lock | None = None
    local_lock_acquired = False
    try:
        if redis_client:
            try:
                redis_lock_acquired = await _acquire_redis_lock(redis_client, lock_key, lock_token)
            except Exception as exc:  # pragma: no cover - network errors
                await record_redis_failure(exc)
                redis_client = None
            else:
                if not redis_lock_acquired:
                    deadline = loop.time() + GARMENT_TYPE_LOCK_WAIT_SECONDS
                    payload = await _wait_for_redis_payload(redis_client, redis_key, lock_key, deadline=deadline)
                    if payload:
                        if GARMENT_TYPE_TTL_SECONDS > 0:
                            _garment_type_cache[image_hash] = (
                                loop.time() + GARMENT_TYPE_TTL_SECONDS,
                                payload,
                            )
                        return payload["type"]
                else:
                    lock_client = redis_client
        if not redis_lock_acquired:
            local_lock = await _get_local_singleflight_lock(image_hash)
            await local_lock.acquire()
            local_lock_acquired = True

        now = loop.time()
        cached_entry = _garment_type_cache.get(image_hash)
        if cached_entry and cached_entry[0] > now:
            return cached_entry[1]["type"]

        if redis_client:
            try:
                payload = await _redis_get_payload(redis_client, redis_key)
            except Exception as exc:  # pragma: no cover - network errors
                await record_redis_failure(exc)
                redis_client = None
            else:
                if payload:
                    if GARMENT_TYPE_TTL_SECONDS > 0:
                        _garment_type_cache[image_hash] = (
                            loop.time() + GARMENT_TYPE_TTL_SECONDS,
                            payload,
                        )
                    return payload["type"]

        instruction = (
            "From the attached garment image, classify coverage for try-on. "
            "Return ONLY one word: top (upper body), bottom (lower body), or full (one piece covering upper+lower like dress/jumpsuit/romper/overalls). "
            "Output: top|bottom|full."
        )
        parts = [
            types.Part.from_text(text=instruction),
            types.Part.from_bytes(data=image_png, mime_type="image/png"),
        ]
        try:
            resp = await genai_generate_with_retries(parts, attempts=2)
            label_text: Optional[str] = None
            for candidate in getattr(resp, "candidates", []) or []:
                content = getattr(candidate, "content", None)
                prts = getattr(content, "parts", None) if content is not None else None
                if not prts:
                    continue
                for part in prts:
                    if getattr(part, "text", None):
                        label_text = part.text
                        break
                if label_text:
                    break
            t = _normalize_garment_type(label_text or "")
            garment_type = t or "full"
        except Exception:
            garment_type = "full"
        payload = _build_cache_payload(garment_type, origin="classifier", ts=time.time())
        if GARMENT_TYPE_TTL_SECONDS > 0:
            _garment_type_cache[image_hash] = (
                loop.time() + GARMENT_TYPE_TTL_SECONDS,
                payload,
            )
        if redis_client and GARMENT_TYPE_TTL_SECONDS > 0:
            try:
                await _redis_set_payload(redis_client, redis_key, payload)
            except Exception as exc:  # pragma: no cover - network errors
                await record_redis_failure(exc)
        return garment_type
    finally:
        if local_lock_acquired and local_lock is not None and local_lock.locked():
            local_lock.release()
        if lock_client is not None and redis_lock_acquired:
            try:
                await _release_redis_lock(lock_client, lock_key, lock_token)
            except Exception:
                pass


__all__ = ["classify_garment_type"]
