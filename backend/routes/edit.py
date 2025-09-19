"""Editing and generation endpoints."""
from __future__ import annotations

import asyncio
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from google.genai import errors as genai_errors
from PIL import Image
from sqlalchemy import text

from backend.config import LOGGER, MODEL
from backend.db import Generation, ListingImage, db_session
from backend.prompts import (
    classic_concise,
    classic_detailed,
    seq_step1_concise,
    seq_step1_detailed,
    seq_step2_concise,
    seq_step2_detailed,
)
from backend.services.garment import classify_garment_type
from backend.services.genai import first_inline_image_bytes, genai_generate_with_retries, types as genai_types
from backend.storage import generate_presigned_get_url, get_object_bytes, upload_image
from backend.utils.normalization import normalize_choice

router = APIRouter()


def _normalize_to_png_limited(raw_bytes: bytes, *, max_px: int = 2048) -> bytes:
    src = Image.open(BytesIO(raw_bytes))
    try:
        src = src.convert("RGBA")
        w, h = src.size
        if max(w, h) > max_px:
            scale = max_px / float(max(w, h))
            new_size = (int(w * scale), int(h * scale))
            src = src.resize(new_size, Image.LANCZOS)
        out = BytesIO()
        src.save(out, format="PNG")
        out.seek(0)
        return out.getvalue()
    finally:
        try:
            src.close()
        except Exception:
            pass


@router.post("/edit")
async def edit(
    image: UploadFile = File(...),
    gender: str = Form("woman"),
    environment: str = Form("studio"),
    poses: list[str] = Form(None),
    extra: str = Form(""),
    env_default_s3_key: str | None = Form(None),
    model_default_s3_key: str | None = Form(None),
    model_description_text: str | None = Form(None),
    prompt_override: str | None = Form(None),
    garment_type_override: str | None = Form(None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not image or not image.filename:
            return JSONResponse({"error": "image file required"}, status_code=400)
        raw_bytes = await image.read()
        if len(raw_bytes) > 20 * 1024 * 1024:
            return JSONResponse({"error": "image too large (max ~20MB)"}, status_code=413)
        try:
            png_bytes = _normalize_to_png_limited(raw_bytes, max_px=2048)
        except Exception:
            return JSONResponse({"error": "invalid or unsupported image format"}, status_code=400)

        gender = normalize_choice(gender, ["woman", "man"], "woman")
        environment = normalize_choice(environment, ["studio", "street", "bed", "beach", "indoor"], "studio")
        allowed_poses = ["standing", "sitting", "lying down", "walking"]
        if not poses:
            poses = []
        if not isinstance(poses, list):
            poses = [poses]
        norm_poses: list[str] = []
        for pose in poses:
            pose_norm = normalize_choice(pose, allowed_poses, "")
            if pose_norm and pose_norm not in norm_poses:
                norm_poses.append(pose_norm)
            if len(norm_poses) >= 3:
                break
        extra = (extra or "").strip()
        if len(extra) > 200:
            extra = extra[:200]
        if not norm_poses:
            norm_poses = ["standing"]

        garment_type = await classify_garment_type(png_bytes, garment_type_override)

        use_env_image = bool(env_default_s3_key)
        use_person_image = bool(model_default_s3_key)
        pose_str = norm_poses[0] if norm_poses else ""
        prompt_variant = "detailed"
        if prompt_override and prompt_override.strip():
            prompt_text = prompt_override.strip()
        else:
            prompt_text = classic_detailed(
                gender=gender,
                environment=environment,
                pose=pose_str,
                use_person_image=use_person_image,
                use_env_image=use_env_image,
                person_description=(model_description_text if (model_description_text and not use_person_image) else None),
                garment_type=garment_type,
            )
        parts: list[genai_types.Part] = [genai_types.Part.from_text(text=prompt_text)]
        if (not use_person_image) and model_description_text:
            parts.append(genai_types.Part.from_text(text=f"Person description: {model_description_text}"))
        parts.append(genai_types.Part.from_bytes(data=png_bytes, mime_type="image/png"))
        person_key_used: str | None = None
        env_key_used: str | None = None
        if model_default_s3_key:
            try:
                person_bytes, person_mime = get_object_bytes(model_default_s3_key)
                parts.append(genai_types.Part.from_bytes(data=person_bytes, mime_type=person_mime or "image/png"))
                person_key_used = model_default_s3_key
            except Exception:
                person_key_used = None
        if env_default_s3_key:
            try:
                env_bytes, env_mime = get_object_bytes(env_default_s3_key)
                parts.append(genai_types.Part.from_bytes(data=env_bytes, mime_type=env_mime or "image/png"))
                env_key_used = env_default_s3_key
            except Exception:
                env_key_used = None

        resp = await genai_generate_with_retries(parts, attempts=2)
        png_bytes_out = first_inline_image_bytes(resp)
        if png_bytes_out:
            _, key = upload_image(png_bytes_out, pose=norm_poses[0])
            async with db_session() as session:
                rec = Generation(
                    s3_key=key,
                    pose=norm_poses[0],
                    prompt=prompt_text,
                    options_json={
                        "gender": gender,
                        "environment": environment,
                        "poses": norm_poses,
                        "extra": extra,
                        "env_default_s3_key": env_key_used,
                        "model_default_s3_key": person_key_used,
                        "model_description_text": (model_description_text if not person_key_used else None),
                        "garment_type": garment_type,
                        "garment_type_override": (garment_type_override if garment_type_override else None),
                        "user_id": x_user_id,
                        "prompt_variant": prompt_variant,
                    },
                    model=MODEL,
                )
                session.add(rec)
            return StreamingResponse(BytesIO(png_bytes_out), media_type="image/png")

        if not (prompt_override and prompt_override.strip()):
            try:
                prompt_variant = "concise"
                prompt_text = classic_concise(
                    gender=gender,
                    environment=environment,
                    pose=pose_str,
                    use_person_image=use_person_image,
                    use_env_image=use_env_image,
                    person_description=(model_description_text if (model_description_text and not use_person_image) else None),
                    garment_type=garment_type,
                )
                parts[0] = genai_types.Part.from_text(text=prompt_text)
                resp2 = await genai_generate_with_retries(parts, attempts=1)
                png_bytes2 = first_inline_image_bytes(resp2)
                if png_bytes2:
                    _, key = upload_image(png_bytes2, pose=norm_poses[0])
                    async with db_session() as session:
                        rec = Generation(
                            s3_key=key,
                            pose=norm_poses[0],
                            prompt=prompt_text,
                            options_json={
                                "gender": gender,
                                "environment": environment,
                                "poses": norm_poses,
                                "extra": extra,
                                "env_default_s3_key": env_key_used,
                                "model_default_s3_key": person_key_used,
                                "model_description_text": (model_description_text if not person_key_used else None),
                                "garment_type": garment_type,
                                "garment_type_override": (garment_type_override if garment_type_override else None),
                                "user_id": x_user_id,
                                "prompt_variant": prompt_variant,
                            },
                            model=MODEL,
                        )
                        session.add(rec)
                    return StreamingResponse(BytesIO(png_bytes2), media_type="image/png")
            except Exception:
                pass
        try:
            cand_count = len(getattr(resp, "candidates", []) or [])
        except Exception:
            cand_count = -1
        LOGGER.warning(
            "edit: no image from model (candidates=%s, prompt_len=%s, use_env=%s, use_person=%s)",
            cand_count,
            len(prompt_text or ""),
            bool(env_default_s3_key),
            bool(model_default_s3_key),
        )
        return JSONResponse({"error": "no edited image from model"}, status_code=502)
    except genai_errors.APIError as exc:
        LOGGER.exception("GenAI API error on /edit")
        return JSONResponse({"error": exc.message, "code": exc.code}, status_code=502)
    except Exception as exc:
        LOGGER.exception("Unhandled error on /edit")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/edit/json")
async def edit_json(
    image: UploadFile | None = File(None),
    gender: str = Form("woman"),
    environment: str = Form("studio"),
    poses: list[str] = Form(None),
    extra: str = Form(""),
    env_default_s3_key: str | None = Form(None),
    model_default_s3_key: str | None = Form(None),
    model_description_text: str | None = Form(None),
    prompt_override: str | None = Form(None),
    listing_id: str | None = Form(None),
    garment_type_override: str | None = Form(None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        src_png: bytes | None = None
        if image and image.filename:
            raw_bytes = await image.read()
            if len(raw_bytes) > 20 * 1024 * 1024:
                return JSONResponse({"error": "image too large (max ~20MB)"}, status_code=413)
            try:
                src_png = _normalize_to_png_limited(raw_bytes, max_px=2048)
            except Exception:
                return JSONResponse({"error": "invalid or unsupported image format"}, status_code=400)
        elif listing_id and x_user_id:
            async with db_session() as session:
                owns = await session.execute(
                    text("SELECT user_id, source_s3_key FROM listings WHERE id = :id"),
                    {"id": listing_id},
                )
                row = owns.first()
            if not row or row[0] != x_user_id:
                return JSONResponse({"error": "not found"}, status_code=404)
            try:
                src_bytes, _ = get_object_bytes(row[1])
                src_png = _normalize_to_png_limited(src_bytes, max_px=2048)
            except Exception as exc:
                return JSONResponse({"error": f"failed to load source image from listing: {exc}"}, status_code=500)
        else:
            return JSONResponse({"error": "image file or listing_id required"}, status_code=400)

        gender = normalize_choice(gender, ["woman", "man"], "woman")
        environment = normalize_choice(environment, ["studio", "street", "bed", "beach", "indoor"], "studio")
        if not poses:
            poses = []
        if not isinstance(poses, list):
            poses = [poses]
        pose_str = (poses[0] if poses else "") or ""
        extra = (extra or "").strip()
        if len(extra) > 200:
            extra = extra[:200]

        garment_type = await classify_garment_type(src_png, garment_type_override)

        use_env_image = bool(env_default_s3_key)
        use_person_image = bool(model_default_s3_key)
        if prompt_override and prompt_override.strip():
            prompt_text = prompt_override.strip()
            prompt_variant = "override"
        else:
            prompt_text = classic_detailed(
                gender=gender,
                environment=environment,
                pose=pose_str,
                use_person_image=use_person_image,
                use_env_image=use_env_image,
                person_description=(model_description_text if (model_description_text and not use_person_image) else None),
                garment_type=garment_type,
            )
            prompt_variant = "detailed"
        parts: list[genai_types.Part] = [genai_types.Part.from_text(text=prompt_text)]
        if (not use_person_image) and model_description_text:
            parts.append(genai_types.Part.from_text(text=f"Person description: {model_description_text}"))
        parts.append(genai_types.Part.from_bytes(data=src_png, mime_type="image/png"))
        person_key_used: str | None = None
        env_key_used: str | None = None
        if model_default_s3_key:
            try:
                person_bytes, person_mime = get_object_bytes(model_default_s3_key)
                parts.append(genai_types.Part.from_bytes(data=person_bytes, mime_type=person_mime or "image/png"))
                person_key_used = model_default_s3_key
            except Exception:
                person_key_used = None
        if env_default_s3_key:
            try:
                env_bytes, env_mime = get_object_bytes(env_default_s3_key)
                parts.append(genai_types.Part.from_bytes(data=env_bytes, mime_type=env_mime or "image/png"))
                env_key_used = env_default_s3_key
            except Exception:
                env_key_used = None

        resp = await genai_generate_with_retries(parts, attempts=2)
        png_bytes = first_inline_image_bytes(resp)
        if png_bytes:
            _, key = upload_image(png_bytes, pose=pose_str or "pose")
            async with db_session() as session:
                session.add(
                    Generation(
                        s3_key=key,
                        pose=pose_str or "pose",
                        prompt=prompt_text,
                        options_json={
                            "gender": gender,
                            "environment": environment,
                            "poses": poses,
                            "extra": extra,
                            "env_default_s3_key": env_key_used,
                            "model_default_s3_key": person_key_used,
                            "model_description_text": (model_description_text if not person_key_used else None),
                            "garment_type": garment_type,
                            "garment_type_override": (garment_type_override if garment_type_override else None),
                            "user_id": x_user_id,
                            "prompt_variant": prompt_variant,
                        },
                        model=MODEL,
                    )
                )
                if listing_id and x_user_id:
                    owns = await session.execute(
                        text("SELECT 1 FROM listings WHERE id = :id AND user_id = :uid"),
                        {"id": listing_id, "uid": x_user_id},
                    )
                    if owns.first():
                        session.add(
                            ListingImage(
                                listing_id=listing_id,
                                s3_key=key,
                                pose=pose_str or "pose",
                                prompt=prompt_text,
                            )
                        )
                        await session.execute(
                            text("UPDATE listings SET cover_s3_key = COALESCE(cover_s3_key, :k) WHERE id = :id"),
                            {"k": key, "id": listing_id},
                        )
                        try:
                            lres = await session.execute(
                                text("SELECT settings_json FROM listings WHERE id = :id"),
                                {"id": listing_id},
                            )
                            lrow = lres.first()
                            settings = (lrow[0] or {}) if lrow else {}
                            origin = "user" if (garment_type_override and garment_type_override.strip()) else "model"
                            settings.update({
                                "garment_type": garment_type,
                                "garment_type_origin": origin,
                            })
                            await session.execute(
                                text("UPDATE listings SET settings_json = :j WHERE id = :id"),
                                {"j": settings, "id": listing_id},
                            )
                        except Exception:
                            pass
            try:
                url = generate_presigned_get_url(key)
            except Exception:
                url = None
            return {
                "ok": True,
                "s3_key": key,
                "url": url,
                "pose": pose_str or "pose",
                "prompt": prompt_text,
                "listing_id": listing_id,
            }
        if not (prompt_override and prompt_override.strip()):
            try:
                prompt_variant = "concise"
                prompt_text = classic_concise(
                    gender=gender,
                    environment=environment,
                    pose=pose_str,
                    use_person_image=use_person_image,
                    use_env_image=use_env_image,
                    person_description=(model_description_text if (model_description_text and not use_person_image) else None),
                    garment_type=garment_type,
                )
                parts[0] = genai_types.Part.from_text(text=prompt_text)
                resp2 = await genai_generate_with_retries(parts, attempts=1)
                png_bytes = first_inline_image_bytes(resp2)
                if png_bytes:
                    _, key = upload_image(png_bytes, pose=pose_str or "pose")
                    async with db_session() as session:
                        session.add(
                            Generation(
                                s3_key=key,
                                pose=pose_str or "pose",
                                prompt=prompt_text,
                                options_json={
                                    "gender": gender,
                                    "environment": environment,
                                    "poses": poses,
                                    "extra": extra,
                                    "env_default_s3_key": env_key_used,
                                    "model_default_s3_key": person_key_used,
                                    "model_description_text": (model_description_text if not person_key_used else None),
                                    "garment_type": garment_type,
                                    "garment_type_override": (garment_type_override if garment_type_override else None),
                                    "user_id": x_user_id,
                                    "prompt_variant": prompt_variant,
                                },
                                model=MODEL,
                            )
                        )
                        if listing_id and x_user_id:
                            owns = await session.execute(
                                text("SELECT 1 FROM listings WHERE id = :id AND user_id = :uid"),
                                {"id": listing_id, "uid": x_user_id},
                            )
                            if owns.first():
                                session.add(
                                    ListingImage(
                                        listing_id=listing_id,
                                        s3_key=key,
                                        pose=pose_str or "pose",
                                        prompt=prompt_text,
                                    )
                                )
                                try:
                                    lres = await session.execute(
                                        text("SELECT settings_json FROM listings WHERE id = :id"),
                                        {"id": listing_id},
                                    )
                                    lrow = lres.first()
                                    settings = (lrow[0] or {}) if lrow else {}
                                    origin = "user" if (garment_type_override and garment_type_override.strip()) else "model"
                                    settings.update({
                                        "garment_type": garment_type,
                                        "garment_type_origin": origin,
                                    })
                                    await session.execute(
                                        text("UPDATE listings SET settings_json = :j WHERE id = :id"),
                                        {"j": settings, "id": listing_id},
                                    )
                                except Exception:
                                    pass
                        try:
                            url = generate_presigned_get_url(key)
                        except Exception:
                            url = None
                        return {
                            "ok": True,
                            "s3_key": key,
                            "url": url,
                            "pose": pose_str or "pose",
                            "prompt": prompt_text,
                            "listing_id": listing_id,
                        }
            except Exception:
                pass
        return JSONResponse({"error": "no edited image from model"}, status_code=502)
    except genai_errors.APIError as exc:
        LOGGER.exception("GenAI API error on /edit/json")
        return JSONResponse({"error": exc.message, "code": exc.code}, status_code=502)
    except Exception as exc:
        LOGGER.exception("Unhandled error on /edit/json")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/edit/sequential/json")
async def edit_sequential_json(
    image: UploadFile | None = File(None),
    gender: str = Form("woman"),
    environment: str = Form("studio"),
    poses: list[str] = Form(None),
    extra: str = Form(""),
    env_default_s3_key: str | None = Form(None),
    model_default_s3_key: str | None = Form(None),
    model_description_text: str | None = Form(None),
    prompt_override_step1: str | None = Form(None),
    prompt_override_step2: str | None = Form(None),
    listing_id: str | None = Form(None),
    garment_type_override: str | None = Form(None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        src_png: bytes | None = None
        if image and image.filename:
            raw_bytes = await image.read()
            if len(raw_bytes) > 20 * 1024 * 1024:
                return JSONResponse({"error": "image too large (max ~20MB)"}, status_code=413)
            try:
                src_png = _normalize_to_png_limited(raw_bytes, max_px=2048)
            except Exception:
                return JSONResponse({"error": "invalid or unsupported image format"}, status_code=400)
        elif listing_id and x_user_id:
            async with db_session() as session:
                owns = await session.execute(
                    text("SELECT user_id, source_s3_key FROM listings WHERE id = :id"),
                    {"id": listing_id},
                )
                row = owns.first()
            if not row or row[0] != x_user_id:
                return JSONResponse({"error": "not found"}, status_code=404)
            try:
                src_bytes, _ = get_object_bytes(row[1])
                src_png = _normalize_to_png_limited(src_bytes, max_px=2048)
            except Exception as exc:
                return JSONResponse({"error": f"failed to load source image from listing: {exc}"}, status_code=500)
        else:
            return JSONResponse({"error": "image file or listing_id required"}, status_code=400)

        if not poses:
            poses = []
        if not isinstance(poses, list):
            poses = [poses]
        pose_str = (poses[0] if poses else "") or ""
        extra = (extra or "").strip()
        if len(extra) > 200:
            extra = extra[:200]
        use_env_image = bool(env_default_s3_key)
        use_person_image = bool(model_default_s3_key)
        garment_type = await classify_garment_type(src_png, garment_type_override)

        if prompt_override_step1 and prompt_override_step1.strip():
            step1_prompt = prompt_override_step1.strip()
            step1_variant = "override"
        else:
            step1_prompt = seq_step1_detailed(
                use_person_image=use_person_image,
                pose=pose_str,
                person_description=(model_description_text if (model_description_text and not use_person_image) else None),
                gender=normalize_choice(gender, ["woman", "man"], "woman"),
            )
            step1_variant = "detailed"
        parts1: list[genai_types.Part] = [genai_types.Part.from_text(text=step1_prompt)]
        person_key_used: str | None = None
        if model_default_s3_key:
            try:
                person_bytes, person_mime = get_object_bytes(model_default_s3_key)
                parts1.append(genai_types.Part.from_text(text="Person reference:"))
                parts1.append(genai_types.Part.from_bytes(data=person_bytes, mime_type=person_mime or "image/png"))
                person_key_used = model_default_s3_key
            except Exception:
                person_key_used = None
        elif model_description_text:
            parts1.append(genai_types.Part.from_text(text=f"Person description: {model_description_text}"))
            person_key_used = None
        parts1.append(genai_types.Part.from_bytes(data=src_png, mime_type="image/png"))

        resp1 = await genai_generate_with_retries(parts1, attempts=2)
        step1_png = first_inline_image_bytes(resp1)
        if not step1_png and not (prompt_override_step1 and prompt_override_step1.strip()):
            try:
                step1_variant = "concise"
                step1_prompt = seq_step1_concise(
                    use_person_image=use_person_image,
                    pose=pose_str,
                    person_description=(model_description_text if (model_description_text and not use_person_image) else None),
                    gender=normalize_choice(gender, ["woman", "man"], "woman"),
                )
                parts1[0] = genai_types.Part.from_text(text=step1_prompt)
                resp1b = await genai_generate_with_retries(parts1, attempts=1)
                step1_png = first_inline_image_bytes(resp1b)
            except Exception:
                pass
        if not step1_png:
            return JSONResponse({"error": "no edited image from model"}, status_code=502)

        if prompt_override_step2 and prompt_override_step2.strip():
            step2_prompt = prompt_override_step2.strip()
            step2_variant = "override"
        else:
            step2_prompt = seq_step2_detailed(
                environment=normalize_choice(environment, ["studio", "street", "bed", "beach", "indoor"], "studio"),
                pose=pose_str,
                garment_type=garment_type,
                use_env_image=use_env_image,
            )
            step2_variant = "detailed"
        parts2: list[genai_types.Part] = [genai_types.Part.from_text(text=step2_prompt)]
        parts2.append(genai_types.Part.from_bytes(data=step1_png, mime_type="image/png"))
        env_key_used: str | None = None
        if env_default_s3_key:
            try:
                env_bytes, env_mime = get_object_bytes(env_default_s3_key)
                parts2.append(genai_types.Part.from_bytes(data=env_bytes, mime_type=env_mime or "image/png"))
                env_key_used = env_default_s3_key
            except Exception:
                env_key_used = None

        resp2 = await genai_generate_with_retries(parts2, attempts=2)
        png_bytes = first_inline_image_bytes(resp2)
        if not png_bytes and not (prompt_override_step2 and prompt_override_step2.strip()):
            try:
                step2_variant = "concise"
                step2_prompt = seq_step2_concise(
                    environment=normalize_choice(environment, ["studio", "street", "bed", "beach", "indoor"], "studio"),
                    pose=pose_str,
                    garment_type=garment_type,
                    use_env_image=use_env_image,
                )
                parts2[0] = genai_types.Part.from_text(text=step2_prompt)
                resp2b = await genai_generate_with_retries(parts2, attempts=1)
                png_bytes = first_inline_image_bytes(resp2b)
            except Exception:
                pass
        if not png_bytes:
            return JSONResponse({"error": "no edited image from model (step2)"}, status_code=502)

        _, key = upload_image(png_bytes, pose=pose_str or "pose")
        async with db_session() as session:
            session.add(
                Generation(
                    s3_key=key,
                    pose=pose_str or "pose",
                    prompt=step2_prompt,
                    options_json={
                        "gender": gender,
                        "environment": environment,
                        "poses": poses,
                        "extra": extra,
                        "env_default_s3_key": env_key_used,
                        "model_default_s3_key": person_key_used,
                        "model_description_text": (model_description_text if not person_key_used else None),
                        "garment_type": garment_type,
                        "garment_type_override": (garment_type_override if garment_type_override else None),
                        "user_id": x_user_id,
                        "prompt_variant": step2_variant,
                        "step1_variant": step1_variant,
                    },
                    model=MODEL,
                )
            )
            if listing_id and x_user_id:
                owns = await session.execute(
                    text("SELECT 1 FROM listings WHERE id = :id AND user_id = :uid"),
                    {"id": listing_id, "uid": x_user_id},
                )
                if owns.first():
                    session.add(
                        ListingImage(
                            listing_id=listing_id,
                            s3_key=key,
                            pose=pose_str or "pose",
                            prompt=step2_prompt,
                        )
                    )
                    await session.execute(
                        text("UPDATE listings SET cover_s3_key = COALESCE(cover_s3_key, :k) WHERE id = :id"),
                        {"k": key, "id": listing_id},
                    )
        try:
            url = generate_presigned_get_url(key)
        except Exception:
            url = None
        return {
            "ok": True,
            "s3_key": key,
            "url": url,
            "pose": pose_str or "pose",
            "prompt": step2_prompt,
            "listing_id": listing_id,
        }
    except genai_errors.APIError as exc:
        LOGGER.exception("GenAI API error on /edit/sequential/json")
        return JSONResponse({"error": exc.message, "code": exc.code}, status_code=502)
    except Exception as exc:
        LOGGER.exception("Unhandled error on /edit/sequential/json")
        return JSONResponse({"error": str(exc)}, status_code=500)
