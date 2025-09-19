"""Product description endpoints."""
from __future__ import annotations

import asyncio
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from sqlalchemy import text

from backend.config import LOGGER, MODEL
from backend.db import ProductDescription, db_session
from backend.services.genai import get_client, types as genai_types
from backend.storage import get_object_bytes, upload_product_source_image
from backend.utils.normalization import normalize_gender

router = APIRouter()


@router.post("/describe")
async def generate_product_description(
    image: UploadFile = File(...),
    gender: str = Form(""),
    brand: str = Form(""),
    model_name: str = Form(""),
    size: str = Form(""),
    condition: str = Form(""),
    prompt_override: str | None = Form(None),
    listing_id: str | None = Form(None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not image or not image.filename:
            return JSONResponse({"error": "image file required"}, status_code=400)
        raw_bytes = await image.read()
        if len(raw_bytes) > 10 * 1024 * 1024:
            return JSONResponse({"error": "image too large (max ~10MB)"}, status_code=413)
        try:
            src = Image.open(BytesIO(raw_bytes))
        except Exception:
            return JSONResponse({"error": "invalid or unsupported image format"}, status_code=400)
        buf = BytesIO()
        try:
            src.convert("RGBA").save(buf, format="PNG")
        finally:
            try:
                src.close()
            except Exception:
                pass
        buf.seek(0)

        try:
            _, src_key = upload_product_source_image(buf.getvalue(), mime="image/png")
        except Exception:
            src_key = None

        def norm(value: Optional[str]) -> str:
            return (value or "").strip()

        meta_lines = []
        if norm(brand):
            meta_lines.append(f"Brand: {norm(brand)}")
        if norm(model_name):
            meta_lines.append(f"Model: {norm(model_name)}")
        if norm(size):
            meta_lines.append(f"Size: {norm(size)}")
        if norm(condition):
            meta_lines.append(f"Condition: {norm(condition)}")
        if norm(gender):
            meta_lines.append(f"Gender: {norm(gender)}")

        if prompt_override and prompt_override.strip():
            instruction = prompt_override.strip()
        else:
            instruction = (
                "You are a helpful assistant that writes high-quality Vinted product listings from a product photo.\n"
                "Output format EXACTLY as sections (plain text):\n"
                "Title: <search-optimized; use brand, item, size, color, material, 1-2 key features; MAX 100 characters>\n\n"
                "Description:\n"
                "- Aim for 200–400 words (MIN 50 words; keep total under 3,000 characters).\n"
                "- Use short paragraphs and hyphen bullets for measurements and unique features.\n"
                "- Include brand, item type, size, color, material, fit, style keywords, unique features, and any visible flaws (be honest).\n"
                "- Include measurements ONLY if clearly inferable; otherwise omit.\n\n"
                "Condition: <one short line; use provided condition if present>\n"
                "Extras: <one short line like 'Open to offers; bundle discounts' or leave empty>\n\n"
                "Rules:\n"
                "- Plain text only; no emojis; no markdown other than hyphen bullets; no price or shipping info.\n"
                "- Keep PG-13.\n"
            )
            if meta_lines:
                instruction += "\nKNOWN FIELDS (apply faithfully if present)\n" + "\n".join(meta_lines) + "\n"

        parts = [
            genai_types.Part.from_text(text=instruction),
            genai_types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png"),
        ]
        client = get_client()
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL,
            contents=genai_types.Content(role="user", parts=parts),
        )
        description_text = None
        for candidate in getattr(resp, "candidates", []) or []:
            content = getattr(candidate, "content", None)
            parts_iter = getattr(content, "parts", None) if content is not None else None
            if parts_iter:
                for part in parts_iter:
                    if getattr(part, "text", None):
                        description_text = part.text
                        break
            if description_text:
                break
        if not description_text:
            return JSONResponse({"error": "no description from model"}, status_code=502)

        async with db_session() as session:
            session.add(
                ProductDescription(
                    user_id=x_user_id,
                    s3_key=src_key or "",
                    gender=normalize_gender(gender) if gender else None,
                    brand=norm(brand) or None,
                    model=norm(model_name) or None,
                    size=norm(size) or None,
                    condition=norm(condition) or None,
                    description=description_text.strip(),
                )
            )
            if listing_id and x_user_id:
                owns = await session.execute(
                    text("SELECT 1 FROM listings WHERE id = :id AND user_id = :uid"),
                    {"id": listing_id, "uid": x_user_id},
                )
                if owns.first():
                    await session.execute(
                        text("UPDATE listings SET description_text = :d WHERE id = :id"),
                        {"d": description_text.strip(), "id": listing_id},
                    )

        return {"ok": True, "description": description_text}
    except Exception as exc:
        LOGGER.exception("description generation failed")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/listing/{lid}/describe")
async def describe_from_listing(
    lid: str,
    gender: str | None = Form(None),
    brand: str | None = Form(None),
    model_name: str | None = Form(None),
    size: str | None = Form(None),
    condition: str | None = Form(None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        async with db_session() as session:
            res = await session.execute(
                text("SELECT user_id, source_s3_key, settings_json FROM listings WHERE id = :id"),
                {"id": lid},
            )
            row = res.first()
        if not row or row[0] != x_user_id:
            return JSONResponse({"error": "not found"}, status_code=404)
        src_key = row[1]
        settings = row[2] or {}

        try:
            src_bytes, mime = get_object_bytes(src_key)
        except Exception as exc:
            return JSONResponse({"error": f"failed to load source image: {exc}"}, status_code=500)

        def norm(value: Optional[str]) -> str:
            return (value or "").strip()

        gg = norm(gender) or norm(settings.get("gender"))
        meta_lines = []
        if norm(brand):
            meta_lines.append(f"Brand: {norm(brand)}")
        if norm(model_name):
            meta_lines.append(f"Model: {norm(model_name)}")
        if norm(size):
            meta_lines.append(f"Size: {norm(size)}")
        if norm(condition):
            meta_lines.append(f"Condition: {norm(condition)}")
        if gg:
            meta_lines.append(f"Gender: {gg}")

        instruction = (
            "You are a helpful assistant that writes high-quality Vinted product listings from a product photo.\n"
            "Output format EXACTLY as sections (plain text):\n"
            "Title: <search-optimized; use brand, item, size, color, material, 1-2 key features; MAX 100 characters>\n\n"
            "Description:\n"
            "- Aim for 200–400 words (MIN 50 words; keep total under 3,000 characters).\n"
            "- Use short paragraphs and hyphen bullets for measurements and unique features.\n"
            "- Include brand, item type, size, color, material, fit, style keywords, unique features, and any visible flaws (be honest).\n"
            "- Include measurements ONLY if clearly inferable; otherwise omit.\n\n"
            "Condition: <one short line; use provided condition if present>\n"
            "Extras: <one short line like 'Open to offers; bundle discounts' or leave empty>\n\n"
            "Rules:\n"
            "- Plain text only; no emojis; no markdown other than hyphen bullets; no price or shipping info.\n"
            "- Keep PG-13.\n"
        )
        if meta_lines:
            instruction += "\nKNOWN FIELDS (apply faithfully if present)\n" + "\n".join(meta_lines) + "\n"

        parts = [
            genai_types.Part.from_text(text=instruction),
            genai_types.Part.from_bytes(data=src_bytes, mime_type=mime or "image/png"),
        ]
        client = get_client()
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL,
            contents=genai_types.Content(role="user", parts=parts),
        )
        description_text = None
        for candidate in getattr(resp, "candidates", []) or []:
            content = getattr(candidate, "content", None)
            parts_iter = getattr(content, "parts", None) if content is not None else None
            if parts_iter:
                for part in parts_iter:
                    if getattr(part, "text", None):
                        description_text = part.text
                        break
            if description_text:
                break
        if not description_text:
            return JSONResponse({"error": "no description from model"}, status_code=502)

        async with db_session() as session:
            session.add(
                ProductDescription(
                    user_id=x_user_id,
                    s3_key=src_key or "",
                    gender=normalize_gender(gg) if gg else None,
                    brand=norm(brand) or None,
                    model=norm(model_name) or None,
                    size=norm(size) or None,
                    condition=norm(condition) or None,
                    description=description_text.strip(),
                )
            )
            await session.execute(
                text("UPDATE listings SET description_text = :d WHERE id = :id"),
                {"d": description_text.strip(), "id": lid},
            )

        return {"ok": True, "description": description_text}
    except Exception as exc:
        LOGGER.exception("description from listing failed")
        return JSONResponse({"error": str(exc)}, status_code=500)
