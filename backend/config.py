"""Application configuration constants."""
from __future__ import annotations

import logging
import os
from typing import List


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "")
    try:
        return int(raw) if raw.strip() else default
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "")
    try:
        return float(raw) if raw.strip() else default
    except (TypeError, ValueError):
        return default


MODEL = os.getenv("GENAI_MODEL", "gemini-2.5-flash-image-preview")
API_KEY = os.getenv("GOOGLE_API_KEY", "")
GARMENT_TYPE_CLASSIFY = os.getenv("GARMENT_TYPE_CLASSIFY", "1").strip().lower() not in ("0", "false", "no")
GARMENT_TYPE_TTL_SECONDS = _env_int("GARMENT_TYPE_TTL_SECONDS", 86400)
REDIS_URL = os.getenv("REDIS_URL", "").strip()
GARMENT_TYPE_CACHE_VERSION = os.getenv("GARMENT_TYPE_CACHE_VERSION", "v1").strip() or "v1"
GARMENT_TYPE_CACHE_PREFIX = os.getenv("GARMENT_TYPE_CACHE_PREFIX", "garment_type").strip() or "garment_type"
GARMENT_TYPE_LOCK_TTL_SECONDS = max(1, _env_int("GARMENT_TYPE_LOCK_TTL_SECONDS", 30))
GARMENT_TYPE_LOCK_WAIT_SECONDS = max(0.5, _env_float("GARMENT_TYPE_LOCK_WAIT_SECONDS", 5.0))
REDIS_OP_TIMEOUT_SECONDS = max(0.1, _env_float("REDIS_OP_TIMEOUT_SECONDS", 0.5))
REDIS_OPERATION_RETRIES = max(0, _env_int("REDIS_OPERATION_RETRIES", 1))
REDIS_RETRY_BACKOFF_SECONDS = max(5.0, _env_float("REDIS_RETRY_BACKOFF_SECONDS", 60.0))

_POLAR_API_BASE_RAW = os.getenv("POLAR_API_BASE", "https://api.polar.sh/v1").strip()
POLAR_API_BASE = _POLAR_API_BASE_RAW.rstrip("/") or "https://api.polar.sh/v1"
POLAR_OAT = os.getenv("POLAR_OAT") or os.getenv("POLAR_ACCESS_TOKEN", "")
POLAR_ORG_ID = os.getenv("POLAR_ORG_ID", "").strip()
POLAR_WEBHOOK_SECRET = os.getenv("POLAR_WEBHOOK_SECRET", "").strip()

_env_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
CORS_ALLOW_ORIGINS: List[str] = [o.strip() for o in _env_origins.split(",") if o.strip()]

LOGGER = logging.getLogger("uvicorn.error")

__all__ = [
    "API_KEY",
    "CORS_ALLOW_ORIGINS",
    "GARMENT_TYPE_CACHE_PREFIX",
    "GARMENT_TYPE_CACHE_VERSION",
    "GARMENT_TYPE_CLASSIFY",
    "GARMENT_TYPE_LOCK_TTL_SECONDS",
    "GARMENT_TYPE_LOCK_WAIT_SECONDS",
    "GARMENT_TYPE_TTL_SECONDS",
    "LOGGER",
    "MODEL",
    "POLAR_API_BASE",
    "POLAR_OAT",
    "POLAR_ORG_ID",
    "POLAR_WEBHOOK_SECRET",
    "REDIS_OP_TIMEOUT_SECONDS",
    "REDIS_OPERATION_RETRIES",
    "REDIS_RETRY_BACKOFF_SECONDS",
    "REDIS_URL",
]
