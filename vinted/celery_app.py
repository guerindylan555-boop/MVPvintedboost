"""Expose the Celery application under the legacy import path."""

from backend.celery_app import celery_app

__all__ = ["celery_app"]
