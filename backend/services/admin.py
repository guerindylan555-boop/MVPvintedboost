"""Helpers for determining admin privileges."""
from __future__ import annotations

import os
from functools import lru_cache


@lru_cache(maxsize=1)
def _allowed_emails() -> set[str]:
    raw = os.getenv("ADMIN_ALLOWED_EMAILS", "")
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


@lru_cache(maxsize=1)
def _allowed_domain() -> str | None:
    domain = (os.getenv("ADMIN_ALLOWED_DOMAIN") or "").strip().lower()
    return domain or None


@lru_cache(maxsize=1)
def has_admin_configuration() -> bool:
    return bool(_allowed_emails() or _allowed_domain())


def is_admin_identifier(identifier: str | None) -> bool:
    if not identifier:
        return False
    ident = identifier.strip().lower()
    if not ident:
        return False
    emails = _allowed_emails()
    domain = _allowed_domain()
    if not emails and not domain:
        return False
    if ident in emails:
        return True
    if domain and ident.endswith("@" + domain):
        return True
    return False
