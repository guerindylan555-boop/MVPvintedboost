"""Celery application instance for the VintedBoost backend."""
from __future__ import annotations

import os
from celery import Celery


def _celery_url(name: str, fallback: str | None = None) -> str:
    value = os.getenv(name)
    if value and value.strip():
        return value.strip()
    if fallback and fallback.strip():
        return fallback.strip()
    # Final fallback to a local Redis instance so the worker can boot even without env vars
    return "redis://localhost:6379/1"


def create_celery_app() -> Celery:
    broker_url = _celery_url("CELERY_BROKER_URL", os.getenv("REDIS_URL"))
    backend_url = _celery_url("CELERY_RESULT_BACKEND", broker_url)

    app = Celery(
        "vintedboost",
        broker=broker_url,
        backend=backend_url,
        include=["backend.tasks"],
    )

    app.conf.update(
        task_default_queue=os.getenv("CELERY_DEFAULT_QUEUE", "default"),
        broker_connection_retry_on_startup=True,
        worker_disable_rate_limits=True,
        timezone=os.getenv("CELERY_TIMEZONE", "UTC"),
        enable_utc=True,
        result_expires=int(os.getenv("CELERY_RESULT_EXPIRES", "3600")),
    )

    return app


celery_app = create_celery_app()


@celery_app.task(name="backend.tasks.healthcheck")
def healthcheck() -> str:
    """Simple task so the worker has something to register immediately."""
    return "ok"
