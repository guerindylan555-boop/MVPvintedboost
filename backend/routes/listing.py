"""Listing management endpoints."""
from __future__ import annotations

import uuid
from io import BytesIO

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from sqlalchemy import text

from backend.config import LOGGER
from backend.db import Listing, ListingImage, db_session
from backend.services.usage import (
    QuotaError,
    consume_quota_with_session,
    ensure_can_consume,
    get_usage_cost,
)
from backend.storage import generate_presigned_get_url, upload_product_source_image

router = APIRouter()

LISTING_CREATE_COST = get_usage_cost("listing_create") or 0
LISTING_IMAGE_COST = get_usage_cost("listing_image") or 0


def _normalize_to_png(raw_bytes: bytes) -> bytes:
    src = Image.open(BytesIO(raw_bytes))
    buf = BytesIO()
    try:
        src.convert("RGBA").save(buf, format="PNG")
    finally:
        try:
            src.close()
        except Exception:
            pass
    buf.seek(0)
    return buf.getvalue()


@router.post("/listing")
async def create_listing(
    image: UploadFile = File(...),
    gender: str = Form("woman"),
    environment: str = Form("studio"),
    poses: list[str] = Form(None),
    extra: str = Form(""),
    env_default_s3_key: str | None = Form(None),
    model_default_s3_key: str | None = Form(None),
    use_model_image: str | None = Form(None),
    prompt_override: str | None = Form(None),
    title: str | None = Form(None),
    garment_type_override: str | None = Form(None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        try:
            await ensure_can_consume(x_user_id, amount=max(LISTING_CREATE_COST, 0))
        except QuotaError as exc:
            return JSONResponse(
                {"error": "quota exceeded", "usage": exc.summary.to_dict()}, status_code=402
            )
        if not image or not image.filename:
            return JSONResponse({"error": "image file required"}, status_code=400)
        raw_bytes = await image.read()
        if len(raw_bytes) > 10 * 1024 * 1024:
            return JSONResponse({"error": "image too large (max ~10MB)"}, status_code=413)
        try:
            src_png = _normalize_to_png(raw_bytes)
        except Exception:
            return JSONResponse({"error": "invalid or unsupported image format"}, status_code=400)

        try:
            _, src_key = upload_product_source_image(src_png, mime="image/png")
        except Exception as exc:
            return JSONResponse({"error": f"failed to persist source image: {exc}"}, status_code=500)

        settings = {
            "gender": (gender or "").strip().lower(),
            "environment": (environment or "").strip().lower(),
            "poses": poses if isinstance(poses, list) else ([poses] if poses else []),
            "extra": (extra or "").strip(),
            "env_default_s3_key": env_default_s3_key,
            "model_default_s3_key": model_default_s3_key,
            "use_model_image": (str(use_model_image).lower() == "true") if use_model_image is not None else None,
            "prompt_override": (prompt_override or "").strip() or None,
            "title": (title or "").strip() or None,
            "garment_type_override": (garment_type_override or None),
        }

        lid = uuid.uuid4().hex
        usage = None
        try:
            async with db_session() as session:
                session.add(
                    Listing(
                        id=lid,
                        user_id=x_user_id,
                        source_s3_key=src_key,
                        settings_json=settings,
                        description_text=None,
                        cover_s3_key=None,
                    )
                )
                usage = await consume_quota_with_session(
                    session,
                    x_user_id,
                    max(LISTING_CREATE_COST, 0),
                )
        except QuotaError as exc:
            LOGGER.warning("quota exceeded after listing creation", extra={"listing_id": lid})
            return JSONResponse(
                {"error": "quota exceeded", "usage": exc.summary.to_dict()}, status_code=402
            )

        try:
            src_url = generate_presigned_get_url(src_key)
        except Exception:
            src_url = None

        return {
            "ok": True,
            "id": lid,
            "source_s3_key": src_key,
            "source_url": src_url,
            "settings": settings,
            "usage": usage.to_dict() if usage else None,
        }
    except Exception as exc:
        LOGGER.exception("failed to create listing")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/listings")
async def list_listings(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        async with db_session() as session:
            lres = await session.execute(
                text(
                    "SELECT id, created_at, cover_s3_key, settings_json FROM listings "
                    "WHERE user_id = :uid ORDER BY created_at DESC LIMIT 200"
                ),
                {"uid": x_user_id},
            )
            rows = lres.all()
            ids = [r[0] for r in rows]
            counts: dict[str, int] = {}
            if ids:
                cres = await session.execute(
                    text(
                        "SELECT listing_id, COUNT(*) FROM listing_images "
                        "WHERE listing_id = ANY(:ids) GROUP BY listing_id"
                    ),
                    {"ids": ids},
                )
                for lid_value, cnt in cres.all():
                    counts[str(lid_value)] = int(cnt)
        items = []
        for lid_value, created_at, cover_key, settings_json in rows:
            try:
                cover_url = generate_presigned_get_url(cover_key) if cover_key else None
            except Exception:
                cover_url = None
            items.append(
                {
                    "id": lid_value,
                    "created_at": created_at.isoformat(),
                    "cover_s3_key": cover_key,
                    "cover_url": cover_url,
                    "images_count": counts.get(str(lid_value), 0),
                    "settings": settings_json or {},
                }
            )
        return {"ok": True, "items": items}
    except Exception as exc:
        LOGGER.exception("failed to list listings")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/listing/{lid}")
async def get_listing(lid: str, x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        async with db_session() as session:
            lres = await session.execute(
                text(
                    "SELECT id, user_id, source_s3_key, settings_json, description_text, cover_s3_key, created_at "
                    "FROM listings WHERE id = :id"
                ),
                {"id": lid},
            )
            lrow = lres.first()
            if not lrow or lrow[1] != x_user_id:
                return JSONResponse({"error": "not found"}, status_code=404)
            ires = await session.execute(
                text(
                    "SELECT s3_key, pose, prompt, created_at FROM listing_images "
                    "WHERE listing_id = :id ORDER BY created_at DESC"
                ),
                {"id": lid},
            )
            irows = ires.all()
        try:
            source_url = generate_presigned_get_url(lrow[2]) if lrow[2] else None
        except Exception:
            source_url = None
        try:
            cover_url = generate_presigned_get_url(lrow[5]) if lrow[5] else None
        except Exception:
            cover_url = None
        images = []
        for s3_key, pose, prompt_text, created_at in irows:
            try:
                url = generate_presigned_get_url(s3_key)
            except Exception:
                url = None
            images.append(
                {
                    "s3_key": s3_key,
                    "pose": pose,
                    "prompt": prompt_text,
                    "created_at": created_at.isoformat(),
                    "url": url,
                }
            )
        return {
            "ok": True,
            "id": lrow[0],
            "created_at": lrow[6].isoformat(),
            "source_s3_key": lrow[2],
            "source_url": source_url,
            "settings": lrow[3] or {},
            "description_text": lrow[4],
            "cover_s3_key": lrow[5],
            "cover_url": cover_url,
            "images": images,
        }
    except Exception as exc:
        LOGGER.exception("failed to get listing")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.patch("/listing/{lid}/cover")
async def set_listing_cover(
    lid: str,
    s3_key: str = Form(...),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        async with db_session() as session:
            lres = await session.execute(text("SELECT user_id FROM listings WHERE id = :id"), {"id": lid})
            row = lres.first()
            if not row or row[0] != x_user_id:
                return JSONResponse({"error": "not found"}, status_code=404)
            ires = await session.execute(
                text("SELECT 1 FROM listing_images WHERE listing_id = :id AND s3_key = :k LIMIT 1"),
                {"id": lid, "k": s3_key},
            )
            if not ires.first():
                return JSONResponse({"error": "image not part of listing"}, status_code=400)
            await session.execute(text("UPDATE listings SET cover_s3_key = :k WHERE id = :id"), {"k": s3_key, "id": lid})
        return {"ok": True}
    except Exception as exc:
        LOGGER.exception("failed to set listing cover")
        return JSONResponse({"error": str(exc)}, status_code=500)
