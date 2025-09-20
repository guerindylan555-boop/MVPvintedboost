"""Model-related API endpoints."""
from __future__ import annotations

import asyncio
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image
from sqlalchemy import select, text

from backend.config import LOGGER, MODEL
from backend.db import (
    Generation,
    ModelDefault,
    ModelDescription,
    ModelSource,
    db_session,
)
from backend.services.editing import persist_generation_result
from backend.services.genai import (
    first_inline_image_bytes,
    genai_generate_with_retries,
    get_client,
    types as genai_types,
)
from backend.services.usage import (
    QuotaError,
    build_usage_identity,
    ensure_can_consume,
)
from backend.services.usage_rules import get_operation_cost
from backend.storage import (
    delete_objects,
    generate_presigned_get_url,
    get_object_bytes,
    upload_image,
    upload_model_source_image,
)
from backend.utils.normalization import normalize_gender

router = APIRouter()


def _parse_bool_header(value: str | None) -> bool:
    if value is None:
        return False
    value = value.strip().lower()
    return value in {"1", "true", "yes", "on"}


MODEL_GENERATION_COST = get_operation_cost("studio.model")


def _quota_json(exc: QuotaError) -> JSONResponse:
    return JSONResponse(
        {"error": "quota exceeded", "usage": exc.summary.to_dict()}, status_code=402
    )


def build_model_prompt(gender: str, user_prompt: Optional[str]) -> str:
    """Prompt for generating a reusable person model reference."""

    def q(text: Optional[str]) -> str:
        return (text or "").strip()

    lines: list[str] = []
    lines.append("TASK")
    lines.append(
        f"Generate a photorealistic {gender} model portrait/full-body for try-on catalogs. "
        "Use the attached person image as the reference: keep the SAME clothing and the SAME background; "
        "change only the person identity to a different, plausible {gender}."
    )
    lines.append("")
    lines.append("HARD CONSTRAINTS")
    lines.append("- Natural, friendly expression; neutral makeup (if applicable).")
    lines.append("- Balanced body proportions; realistic hands.")
    lines.append(
        "- Clothing: preserve EXACTLY what the source person wears (same garments, colors, materials, prints, logos if present). "
        "Do not alter fit or style."
    )
    lines.append(
        "- Background/scene: preserve EXACTLY what is in the source (same location, props, lighting, palette, depth of field). "
        "Do not replace or restage."
    )
    lines.append("- No explicit content; keep PG-13.")
    lines.append("")
    lines.append("CAMERA & LIGHT")
    lines.append("- Preserve the source camera perspective and lighting as part of the unchanged background.")
    lines.append("- Framing: 3/4 body if plausible from the source; otherwise match source framing.")
    lines.append("")
    lines.append("RANDOMIZATION")
    lines.append("- Randomize identity ONLY (different person of the same gender). DO NOT change clothing or background.")
    if q(user_prompt):
        lines.append("")
        lines.append("USER WISHES")
        lines.append(f"\"{q(user_prompt)}\"")
        lines.append("Apply only if consistent with realism and constraints above.")
    lines.append("")
    lines.append("NEGATIVE GUIDANCE")
    lines.append("over-retouched skin, plastic look, extreme stylization, caricature, heavy vignettes, AI artifacts")
    return "\n".join(lines)


@router.post("/model/generate")
async def model_generate(
    image: UploadFile | None = File(None),
    gender: str = Form("man"),
    prompt: str = Form(""),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
    x_user_admin: str | None = Header(default=None, alias="X-User-Is-Admin"),
):
    try:
        gender = normalize_gender(gender)
        user_prompt = (prompt or "").strip()

        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)

        identity = build_usage_identity(
            x_user_id,
            email=x_user_email,
            is_admin_hint=_parse_bool_header(x_user_admin),
        )
        await ensure_can_consume(identity, amount=MODEL_GENERATION_COST)

        instruction = build_model_prompt(gender, user_prompt if user_prompt else None)
        parts: list[genai_types.Part] = [genai_types.Part.from_text(text=instruction)]

        src_png_bytes: Optional[bytes] = None
        if image and getattr(image, "filename", None):
            raw_bytes = await image.read()
            if len(raw_bytes) > 10 * 1024 * 1024:
                return JSONResponse({"error": "image too large (max ~10MB)"}, status_code=413)
            src = Image.open(BytesIO(raw_bytes))
            buf = BytesIO()
            src.convert("RGBA").save(buf, format="PNG")
            buf.seek(0)
            src_png_bytes = buf.getvalue()
            try:
                _, src_key = upload_model_source_image(src_png_bytes, gender=gender, mime="image/png")
                async with db_session() as session:
                    session.add(ModelSource(gender=gender, s3_key=src_key))
            except Exception:
                pass
        else:
            async with db_session() as session:
                stmt = text(
                    "SELECT s3_key FROM model_sources WHERE gender = :g ORDER BY created_at DESC LIMIT 1"
                )
                res = await session.execute(stmt, {"g": gender})
                row = res.first()
            if not row:
                return JSONResponse({"error": f"no model sources uploaded for gender '{gender}'"}, status_code=400)
            src_bytes, _ = get_object_bytes(row[0])
            src_png_bytes = src_bytes

        parts.append(genai_types.Part.from_bytes(data=src_png_bytes, mime_type="image/png"))

        resp = await asyncio.to_thread(
            get_client().models.generate_content,
            model=MODEL,
            contents=genai_types.Content(role="user", parts=parts),
        )
        png_bytes = first_inline_image_bytes(resp)
        if png_bytes:
            _, key = upload_image(png_bytes, pose=f"model-{gender}")
            try:
                usage = await persist_generation_result(
                    s3_key=key,
                    pose=f"model-{gender}",
                    prompt=instruction,
                    options={
                        "mode": "model",
                        "gender": gender,
                        "user_prompt": user_prompt,
                        "user_id": x_user_id,
                    },
                    model_name=MODEL,
                    usage_identity=identity,
                    usage_amount=MODEL_GENERATION_COST,
                )
            except QuotaError as exc:
                LOGGER.warning("quota exceeded after model generate", extra={"gender": gender})
                return _quota_json(exc)
            try:
                describe_prompt = (
                    "Describe this person precisely for identity reference (plain text, MINIMUM 500 words). "
                    "Focus strictly on identity cues, not clothing or background. Include: perceived gender; approximate age range; "
                    "height impression; build; posture; skin tone with nuance; undertone; face shape; forehead; hairline; hair color; "
                    "highlights/lowlights; hair length; hair texture; parting; typical styles; eyebrows (shape, thickness, arch); "
                    "eyes (color, shape, spacing, eyelids); eyelashes; nose (bridge, tip, width); cheeks; lips (shape, fullness, "
                    "Cupid's bow); chin; jawline; ears; facial hair (if any, density and shape); teeth and smile; notable features "
                    "(freckles, moles, scars, dimples, birthmarks); accessories (glasses, earrings, piercings). "
                    "Use neutral, respectful language; avoid judgments; avoid clothing/brand/background mentions; no lists of "
                    "instructions—write a cohesive, descriptive paragraph or two with at least 500 words."
                )
                desc_parts = [
                    genai_types.Part.from_text(text=describe_prompt),
                    genai_types.Part.from_bytes(data=png_bytes, mime_type="image/png"),
                ]
                desc_resp = get_client().models.generate_content(
                    model=MODEL,
                    contents=genai_types.Content(role="user", parts=desc_parts),
                )
                description_text = None
                for candidate in getattr(desc_resp, "candidates", []) or []:
                    content = getattr(candidate, "content", None)
                    parts_iter = getattr(content, "parts", None) if content is not None else None
                    if parts_iter:
                        for part in parts_iter:
                            if getattr(part, "text", None):
                                description_text = part.text
                                break
                    if description_text:
                        break
                if description_text:
                    async with db_session() as session:
                        session.add(ModelDescription(s3_key=key, description=description_text))
            except Exception:
                pass
            response = StreamingResponse(BytesIO(png_bytes), media_type="image/png")
            if usage:
                response.headers["X-Usage-Allowance"] = str(usage.allowance)
                response.headers["X-Usage-Used"] = str(usage.used)
                response.headers["X-Usage-Remaining"] = (
                    str(usage.remaining) if usage.remaining is not None else ""
                )
                if usage.plan_id:
                    response.headers["X-Usage-Plan-Id"] = usage.plan_id
            return response
        return JSONResponse({"error": "no image from model"}, status_code=502)
    except Exception as exc:
        LOGGER.exception("model generate failed")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/model/generated")
async def list_model_generated(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        async with db_session() as session:
            if x_user_id:
                stmt = (
                    select(Generation.s3_key, Generation.created_at, Generation.options_json)
                    .where(Generation.pose.in_(["model-man", "model-woman"]))
                    .where(text("(options_json->>'user_id') = :uid")).params(uid=x_user_id)
                    .order_by(Generation.created_at.desc())
                    .limit(200)
                )
            else:
                stmt = select(Generation.s3_key, Generation.created_at, Generation.options_json).where(text("1=0"))
            res = await session.execute(stmt)
            rows = res.all()
            items = []
            for key, created, options in rows:
                gender = (options or {}).get("gender")
                desc_text = None
                try:
                    dres = await session.execute(text("SELECT description FROM model_descriptions WHERE s3_key = :k"), {"k": key})
                    drow = dres.first()
                    if drow:
                        desc_text = drow[0]
                except Exception:
                    pass
                try:
                    url = generate_presigned_get_url(key)
                except Exception:
                    url = None
                items.append({
                    "s3_key": key,
                    "created_at": created.isoformat(),
                    "gender": gender,
                    "url": url,
                    "description": desc_text,
                })
        return {"ok": True, "items": items}
    except Exception as exc:
        LOGGER.exception("Failed to list model generated images")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/model/defaults")
async def list_model_defaults():
    try:
        async with db_session() as session:
            stmt = select(ModelDefault.gender, ModelDefault.s3_key, ModelDefault.name)
            res = await session.execute(stmt)
            rows = res.all()
            keys = [row[1] for row in rows]
            desc_map: dict[str, Optional[str]] = {}
            if keys:
                try:
                    dstmt = select(ModelDescription.s3_key, ModelDescription.description).where(
                        ModelDescription.s3_key.in_(keys)
                    )
                    dres = await session.execute(dstmt)
                    for s3_key, desc in dres.all():
                        desc_map[s3_key] = desc
                except Exception:
                    desc_map = {}
            items = []
            for gender, key, name in rows:
                try:
                    url = generate_presigned_get_url(key)
                except Exception:
                    url = None
                items.append(
                    {
                        "gender": gender,
                        "s3_key": key,
                        "name": name,
                        "url": url,
                        "description": desc_map.get(key),
                    }
                )
        return {"ok": True, "items": items}
    except Exception as exc:
        LOGGER.exception("Failed to list model defaults")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/model/defaults")
async def set_model_default(gender: str = Form(...), s3_key: str = Form(...), name: str = Form("Default")):
    try:
        gender = normalize_gender(gender)
        async with db_session() as session:
            await session.execute(text("DELETE FROM model_defaults WHERE gender = :g"), {"g": gender})
            session.add(ModelDefault(gender=gender, s3_key=s3_key, name=(name or "").strip() or "Default"))
        return {"ok": True}
    except Exception as exc:
        LOGGER.exception("Failed to set model default")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.delete("/model/defaults")
async def unset_model_default(gender: str):
    try:
        gender = normalize_gender(gender)
        async with db_session() as session:
            await session.execute(text("DELETE FROM model_defaults WHERE gender = :g"), {"g": gender})
        return {"ok": True}
    except Exception as exc:
        LOGGER.exception("Failed to unset model default")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.delete("/model/generated")
async def delete_model_generated(s3_key: str):
    try:
        delete_objects([s3_key])
        async with db_session() as session:
            await session.execute(text("DELETE FROM generations WHERE s3_key = :k"), {"k": s3_key})
            await session.execute(text("DELETE FROM model_defaults WHERE s3_key = :k"), {"k": s3_key})
        return {"ok": True}
    except Exception as exc:
        LOGGER.exception("Failed to delete model generated image")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/model/sources/upload")
async def upload_model_sources(gender: str = Form(...), files: list[UploadFile] = File(...)):
    try:
        gender = normalize_gender(gender)
        stored: list[dict[str, str]] = []
        for upload in files:
            data = await upload.read()
            _, key = upload_model_source_image(data, gender=gender, mime=upload.content_type)
            async with db_session() as session:
                session.add(ModelSource(gender=gender, s3_key=key))
            stored.append({"gender": gender, "s3_key": key})
        return {"ok": True, "count": len(stored), "items": stored}
    except Exception as exc:
        LOGGER.exception("Failed to upload model sources")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/model/sources")
async def list_model_sources(gender: str | None = None):
    try:
        async with db_session() as session:
            stmt = select(ModelSource.gender, ModelSource.s3_key).order_by(ModelSource.created_at.desc())
            if gender:
                stmt = stmt.where(ModelSource.gender == normalize_gender(gender))
            res = await session.execute(stmt)
            rows = res.all()
            items = []
            for gender_value, key in rows:
                try:
                    url = generate_presigned_get_url(key)
                except Exception:
                    url = None
                items.append({"gender": gender_value, "s3_key": key, "url": url})
        return {"ok": True, "items": items}
    except Exception as exc:
        LOGGER.exception("Failed to list model sources")
        return JSONResponse({"error": str(exc)}, status_code=500)
