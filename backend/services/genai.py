"""Gemini client helpers shared across route modules."""
from __future__ import annotations

import asyncio
from typing import Any, Optional

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from backend.config import API_KEY, MODEL

_client: Optional[genai.Client] = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        if not API_KEY:
            raise RuntimeError("GOOGLE_API_KEY env var is required")
        _client = genai.Client(api_key=API_KEY)
    return _client


def first_inline_image_bytes(response: Any) -> bytes | None:
    """Return the first inline image payload from a Gemini response."""

    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) if content is not None else None
        if not parts:
            continue
        for part in parts:
            inline_data = getattr(part, "inline_data", None)
            data = getattr(inline_data, "data", None) if inline_data is not None else None
            if data:
                return data
    return None


async def genai_generate_with_retries(parts: list[types.Part], *, attempts: int = 2):
    """Call GenAI with short retries for transient 5xx/429 errors."""

    last_exc: Exception | None = None
    for i in range(max(1, attempts)):
        try:
            return await asyncio.to_thread(
                get_client().models.generate_content,
                model=MODEL,
                contents=types.Content(role="user", parts=parts),
            )
        except genai_errors.APIError as exc:
            last_exc = exc
            code = getattr(exc, "code", None)
            msg = (getattr(exc, "message", "") or "").lower()
            if code in (500, 502, 503) or "internal" in msg or code == 429:
                await asyncio.sleep(0.6 + 0.4 * i)
                continue
            raise
    assert last_exc is not None
    raise last_exc


__all__ = [
    "first_inline_image_bytes",
    "genai_generate_with_retries",
    "get_client",
    "types",
]
