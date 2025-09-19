"""Re-export the Celery application from the backend package."""

from backend.celery_app import celery_app

__all__ = ["celery_app"]
