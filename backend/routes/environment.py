"""Environment-related API endpoints."""
from __future__ import annotations

from io import BytesIO
from typing import Any, Optional

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select, text

from backend.config import LOGGER, MODEL
from backend.db import EnvDefaultUser, EnvSource, Generation, db_session
from backend.services.genai import (
    first_inline_image_bytes,
    genai_generate_with_retries,
    types as genai_types,
)
from backend.storage import (
    delete_objects,
    generate_presigned_get_url,
    get_object_bytes,
    upload_image,
    upload_source_image,
)

router = APIRouter()


def build_env_prompt(user_prompt: Optional[str] = None) -> str:
    """Build the Studio Environment generation instruction."""

    def q(text: Optional[str]) -> str:
        return (text or "").strip()

    lines: list[str] = []
    lines.append("TASK")
    lines.append(
        "Generate a new photorealistic mirror environment image for future garment try-ons. "
        "Use the attached environment image as the reference: keep the MIRROR and its placement consistent, "
        "but redesign the surrounding scene with tasteful variation."
    )
    lines.append("")
    lines.append("HARD CONSTRAINTS")
    lines.append("- Keep mirror frame, size, and placement consistent; do not remove it.")
    lines.append("- Preserve basic room geometry (walls, floor) and perspective from the source image.")
    lines.append("- Lighting must remain plausible and consistent with reflections.")
    lines.append("- Avoid people, animals, or text overlays.")
    lines.append("- Maintain PG-13 content.")
    lines.append("")
    lines.append("STYLE & CAMERA")
    lines.append("- Mirror selfie aesthetic; natural smartphone camera vibe.")
    lines.append("- Keep camera angle close to the source reference; minor tweaks allowed but no drastic angle changes.")
    lines.append("- Lighting should feel realistic; soft bokeh acceptable.")
    lines.append("")
    lines.append("VARIATIONS")
    lines.append(
        "- Refresh decor, wall colors, props, and ambiance; keep mirror region recognizable."
    )
    lines.append("- Ensure the mirror reflection still shows a plausible empty room ready for try-ons.")
    if q(user_prompt):
        lines.append("")
        lines.append("USER WISHES")
        lines.append(f"\"{q(user_prompt)}\"")
        lines.append("Apply only if consistent with realism and constraints above.")
    lines.append("")
    lines.append("NEGATIVE GUIDANCE")
    lines.append("AI artifacts, warped mirrors, text overlays, people, over-saturated neon lighting, cluttered mess")
    return "\n".join(lines)


async def _generate_env_with_random_source(prompt_text: str, *, options: dict[str, Any]):
    async with db_session() as session:
        stmt = text("SELECT s3_key FROM env_sources ORDER BY RANDOM() LIMIT 1")
        res = await session.execute(stmt)
        row = res.first()
    if not row:
        return JSONResponse({"error": "no sources uploaded"}, status_code=400)

    source_key = row[0]
    src_bytes, mime = get_object_bytes(source_key)
    parts = [
        genai_types.Part.from_text(text=prompt_text),
        genai_types.Part.from_bytes(data=src_bytes, mime_type=mime),
    ]
    resp = await genai_generate_with_retries(parts, attempts=2)
    png_bytes = first_inline_image_bytes(resp)
    if not png_bytes:
        return JSONResponse({"error": "no image from model"}, status_code=502)

    _, key = upload_image(png_bytes, pose="env")
    payload = dict(options)
    payload["source_s3_key"] = source_key
    async with db_session() as session:
        rec = Generation(
            s3_key=key,
            pose="env",
            prompt=prompt_text,
            options_json=payload,
            model=MODEL,
        )
        session.add(rec)
    return StreamingResponse(BytesIO(png_bytes), media_type="image/png")


@router.post("/env/sources/upload")
async def upload_env_sources(files: list[UploadFile] = File(...)):
    try:
        stored = []
        for upload in files:
            data = await upload.read()
            _, key = upload_source_image(data, mime=upload.content_type)
            async with db_session() as session:
                session.add(EnvSource(s3_key=key))
            stored.append({"s3_key": key})
        return {"ok": True, "count": len(stored), "items": stored}
    except Exception as exc:  # pragma: no cover - defensive logging
        LOGGER.exception("Failed to upload env sources")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/env/sources")
async def list_env_sources():
    try:
        async with db_session() as session:
            stmt = select(EnvSource.s3_key).order_by(EnvSource.created_at.desc())
            res = await session.execute(stmt)
            items = [row[0] for row in res.all()]
        return {"ok": True, "count": len(items), "items": items}
    except Exception as exc:
        LOGGER.exception("Failed to list env sources")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.delete("/env/sources")
async def delete_env_sources():
    try:
        async with db_session() as session:
            stmt = select(EnvSource.s3_key)
            res = await session.execute(stmt)
            keys = [row[0] for row in res.all()]
        delete_objects(keys)
        async with db_session() as session:
            await session.execute(text("DELETE FROM env_sources"))
        return {"ok": True, "deleted": len(keys)}
    except Exception as exc:
        LOGGER.exception("Failed to delete env sources")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/env/random")
async def generate_env_random(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        instruction = build_env_prompt()
        return await _generate_env_with_random_source(
            instruction,
            options={"mode": "random", "user_id": x_user_id},
        )
    except Exception as exc:
        LOGGER.exception("env random failed")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/env/generate")
async def generate_env(prompt: str = Form(""), x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        full = build_env_prompt(prompt)
        user_prompt = (prompt or "").strip()
        return await _generate_env_with_random_source(
            full,
            options={
                "mode": "prompt",
                "user_prompt": user_prompt,
                "user_id": x_user_id,
            },
        )
    except Exception as exc:
        LOGGER.exception("env generate failed")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/env/generated")
async def list_generated(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        async with db_session() as session:
            if x_user_id:
                stmt = (
                    select(Generation.s3_key, Generation.created_at)
                    .where(Generation.pose == "env")
                    .where(text("(options_json->>'user_id') = :uid")).params(uid=x_user_id)
                    .order_by(Generation.created_at.desc())
                    .limit(200)
                )
            else:
                stmt = select(Generation.s3_key, Generation.created_at).where(text("1=0"))
            res = await session.execute(stmt)
            rows = res.all()
            items = []
            for key, created in rows:
                try:
                    url = generate_presigned_get_url(key)
                except Exception:
                    url = None
                items.append({
                    "s3_key": key,
                    "created_at": created.isoformat(),
                    "url": url,
                })
        return {"ok": True, "count": len(items), "items": items}
    except Exception as exc:
        LOGGER.exception("Failed to list generated images")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/env/image")
async def get_generated_image(s3_key: str):
    try:
        data, content_type = get_object_bytes(s3_key)
        return StreamingResponse(BytesIO(data), media_type=content_type)
    except Exception as exc:
        LOGGER.exception("Failed to fetch generated image")
        return JSONResponse({"error": str(exc)}, status_code=404)


@router.get("/env/defaults")
async def list_defaults(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        async with db_session() as session:
            if not x_user_id:
                rows: list[tuple[str, str]] = []
            else:
                stmt = (
                    select(EnvDefaultUser.s3_key, EnvDefaultUser.name)
                    .where(EnvDefaultUser.user_id == x_user_id)
                    .order_by(EnvDefaultUser.created_at.desc())
                )
                res = await session.execute(stmt)
                rows = res.all()
            items = []
            for key, name in rows:
                try:
                    url = generate_presigned_get_url(key)
                except Exception:
                    url = None
                items.append({"s3_key": key, "name": name, "url": url})
        return {"ok": True, "items": items}
    except Exception as exc:
        LOGGER.exception("Failed to list defaults")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/env/defaults")
async def set_defaults(
    s3_keys: list[str] = Form(...),
    names: list[str] = Form(...),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        if len(s3_keys) != len(names):
            return JSONResponse({"error": "mismatched arrays"}, status_code=400)
        if len(s3_keys) > 5:
            return JSONResponse({"error": "max 5 defaults"}, status_code=400)
        async with db_session() as session:
            await session.execute(text("DELETE FROM env_defaults_user WHERE user_id = :uid"), {"uid": x_user_id})
            for key, name in zip(s3_keys, names):
                session.add(EnvDefaultUser(user_id=x_user_id, s3_key=key, name=name.strip() or "Untitled"))
        return {"ok": True}
    except Exception as exc:
        LOGGER.exception("Failed to set defaults")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.delete("/env/defaults")
async def unset_default(s3_key: str):
    try:
        async with db_session() as session:
            await session.execute(text("DELETE FROM env_defaults_user WHERE s3_key = :k"), {"k": s3_key})
        return {"ok": True}
    except Exception as exc:
        LOGGER.exception("Failed to unset default")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.patch("/env/defaults")
async def rename_default(
    s3_key: str = Form(...),
    name: str = Form(...),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        name = (name or "").strip() or "Untitled"
        async with db_session() as session:
            await session.execute(
                text("UPDATE env_defaults_user SET name = :n WHERE user_id = :uid AND s3_key = :k"),
                {"n": name, "uid": x_user_id, "k": s3_key},
            )
        return {"ok": True}
    except Exception as exc:
        LOGGER.exception("Failed to rename default")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.delete("/env/generated")
async def delete_generated(s3_key: str):
    try:
        delete_objects([s3_key])
        async with db_session() as session:
            await session.execute(text("DELETE FROM generations WHERE s3_key = :k"), {"k": s3_key})
            await session.execute(text("DELETE FROM env_defaults_user WHERE s3_key = :k"), {"k": s3_key})
        return {"ok": True}
    except Exception as exc:
        LOGGER.exception("Failed to delete generated image")
        return JSONResponse({"error": str(exc)}, status_code=500)
