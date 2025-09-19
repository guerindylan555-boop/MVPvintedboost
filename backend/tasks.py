"""Celery task definitions wired to backend workflows."""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Iterable

from celery import group
from celery.exceptions import TimeoutError as CeleryTimeoutError
from google import genai
from google.genai import types
from sqlalchemy import select

from .celery_app import celery_app
from .db import db_session, PoseDescription
from .storage import get_object_bytes

logger = logging.getLogger("backend.tasks")

GENAI_MODEL = os.getenv("GENAI_MODEL", "gemini-2.5-flash-image-preview")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "").strip()
POSE_TASK_TIMEOUT = int(os.getenv("POSE_DESCRIPTION_TIMEOUT", "120"))
POSE_BATCH_TIMEOUT = int(os.getenv("POSE_DESCRIPTION_BATCH_TIMEOUT", "300"))

_POSE_INSTRUCTION = (
    "Analyze this image and output a detailed pose description in plain text (AT LEAST 1000 WORDS, split into 2–4 paragraphs). "
    "Describe ONLY the person's body pose in a mirror-selfie context. Explicitly state that the subject is taking a mirror selfie with a smartphone; "
    "specify which hand holds the phone, where the phone is positioned relative to the face/torso, and how much of the face is occluded by it. "
    "Include: overall orientation toward the mirror/camera, stance (feet placement and weight distribution), center of gravity, torso rotation and tilt, "
    "shoulder alignment and elevation, spine curvature, neck alignment, head orientation/tilt, elbows/forearms/wrists angles, the non-phone hand visibility/gesture "
    "and any contact points (e.g., on hip, hanging relaxed), leg bends and knee angles, and approximate distance to the mirror if inferable. "
    "Do NOT describe clothing, identity, background, brand names, age, or ethnicity. Use neutral anatomical language. Output plain text only."
)

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not GOOGLE_API_KEY:
            raise RuntimeError("GOOGLE_API_KEY env var is required for pose description tasks")
        _client = genai.Client(api_key=GOOGLE_API_KEY)
    return _client


def _env_inline_execution() -> bool:
    if celery_app.conf.task_always_eager:
        return True
    raw = os.getenv("CELERY_FORCE_INLINE")
    return bool(raw and raw.strip().lower() in {"1", "true", "yes", "on"})


async def _generate_pose_description_async(s3_key: str) -> dict[str, Any]:
    """Generate and persist a pose description for the given S3 key."""
    try:
        image_bytes, mime = get_object_bytes(s3_key)
    except Exception as exc:
        raise RuntimeError(f"failed to download pose source: {exc}") from exc

    client = _get_client()
    parts = [
        types.Part.from_text(text=_POSE_INSTRUCTION),
        types.Part.from_bytes(data=image_bytes, mime_type=mime or "image/png"),
    ]
    try:
        response = client.models.generate_content(
            model=GENAI_MODEL,
            contents=types.Content(role="user", parts=parts),
        )
    except Exception as exc:
        raise RuntimeError(f"GenAI request failed: {exc}") from exc

    description_text: str | None = None
    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        if not content:
            continue
        for part in getattr(content, "parts", []) or []:
            candidate_text = getattr(part, "text", None)
            if candidate_text:
                description_text = candidate_text
                break
        if description_text:
            break

    if not description_text:
        raise RuntimeError("model returned no description text")

    async with db_session() as session:
        existing = await session.execute(
            select(PoseDescription).where(PoseDescription.s3_key == s3_key)
        )
        if existing.first():
            return {"s3_key": s3_key, "ok": True, "skipped": True}
        session.add(PoseDescription(s3_key=s3_key, description=description_text))

    return {"s3_key": s3_key, "ok": True, "skipped": False}


@celery_app.task(name="backend.pose.describe")
def describe_pose_task(s3_key: str) -> dict[str, Any]:
    """Celery task entrypoint for generating a pose description."""
    try:
        return asyncio.run(_generate_pose_description_async(s3_key))
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Pose description task failed for %s", s3_key)
        return {"s3_key": s3_key, "ok": False, "error": str(exc)}


def _run_inline(keys: Iterable[str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for key in keys:
        res = describe_pose_task.apply(args=(key,)).get()
        results.append(res)
    return results


def enqueue_pose_descriptions(
    keys: list[str],
    *,
    wait: bool = True,
    timeout: int | None = None,
) -> dict[str, Any]:
    """Queue Celery tasks to generate pose descriptions.

    Returns a dictionary with the Celery job id and any collected results. If no
    worker is available the work is executed inline so the caller still receives
    deterministic behaviour.
    """
    if not keys:
        return {"job_id": None, "results": []}

    if _env_inline_execution():
        return {"job_id": None, "results": _run_inline(keys), "inline": True}

    task_group = group(describe_pose_task.s(key) for key in keys)
    async_result = task_group.apply_async()

    if not wait:
        return {"job_id": async_result.id, "results": []}

    effective_timeout = timeout if timeout is not None else POSE_BATCH_TIMEOUT
    try:
        results = async_result.get(timeout=effective_timeout)
        return {"job_id": async_result.id, "results": results, "inline": False}
    except CeleryTimeoutError:
        logger.warning("Celery pose batch timed out; falling back to inline execution")
        # Collect completed results before falling back
        completed: list[dict[str, Any]] = []
        try:
            for child in async_result.results or []:
                if child.successful():
                    completed.append(child.result)
        except Exception:
            completed = []
        finished_keys = {r.get("s3_key") for r in completed if isinstance(r, dict)}
        remaining = [k for k in keys if k not in finished_keys]
        inline_results = completed + _run_inline(remaining)
        return {"job_id": async_result.id, "results": inline_results, "inline": True, "fallback": True}


__all__ = ["describe_pose_task", "enqueue_pose_descriptions"]
