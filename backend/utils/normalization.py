"""Input normalization helpers shared across route modules."""
from __future__ import annotations


def normalize_choice(value: str, allowed: list[str], default: str) -> str:
    value = (value or "").strip().lower()
    return value if value in allowed else default


def normalize_gender(g: str) -> str:
    g = (g or "").strip().lower()
    return g if g in ("man", "woman") else "man"


__all__ = ["normalize_choice", "normalize_gender"]
