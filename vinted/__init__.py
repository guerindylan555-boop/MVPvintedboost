"""Compatibility package for legacy Celery imports.

Celery workers in some environments expect `vinted.celery_app`. Importing
from here forwards to the canonical backend implementation.
"""

from backend.celery_app import celery_app  # re-export

__all__ = ["celery_app"]
