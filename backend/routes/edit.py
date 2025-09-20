"""Editing and generation endpoints."""
from __future__ import annotations

import asyncio
from io import BytesIO

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from google.genai import errors as genai_errors

from backend.config import LOGGER, MODEL
from backend.db import Generation, db_session
from backend.prompts import (
    classic_concise,
    classic_detailed,
    seq_step1_concise,
    seq_step1_detailed,
    seq_step2_concise,
    seq_step2_detailed,
)
from backend.services.editing import (
    EditingError,
    load_garment_source,
    normalize_edit_inputs,
    normalize_to_png_limited,
    persist_generation_result,
    resolve_listing_context,
)
from backend.services.garment import classify_garment_type
from backend.services.genai import first_inline_image_bytes, genai_generate_with_retries, types as genai_types
from backend.storage import generate_presigned_get_url, get_object_bytes, upload_image
from backend.services.usage import (
    QuotaError,
    UsageSummary,
    build_usage_identity,
    ensure_can_consume,
)
from backend.services.usage_rules import get_operation_cost
from backend.utils.normalization import normalize_choice

router = APIRouter()


def _parse_bool_header(value: str | None) -> bool:
    if value is None:
        return False
    value = value.strip().lower()
    return value in {"1", "true", "yes", "on"}


GENERATION_COST = get_operation_cost("generation.pose")


def _quota_json(exc: QuotaError) -> JSONResponse:
    return JSONResponse({"error": "quota exceeded", "usage": exc.summary.to_dict()}, status_code=402)


def _attach_usage_headers(response: StreamingResponse, summary: UsageSummary) -> None:
    response.headers["X-Usage-Allowance"] = str(summary.allowance)
    response.headers["X-Usage-Used"] = str(summary.used)
    response.headers["X-Usage-Remaining"] = str(summary.remaining)
    if summary.plan_id:
        response.headers["X-Usage-Plan-Id"] = summary.plan_id
    if summary.plan_name:
        response.headers["X-Usage-Plan-Name"] = summary.plan_name


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
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
    x_user_admin: str | None = Header(default=None, alias="X-User-Is-Admin"),
):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        identity = build_usage_identity(
            x_user_id,
            email=x_user_email,
            is_admin_hint=_parse_bool_header(x_user_admin),
        )
        try:
            await ensure_can_consume(identity, amount=GENERATION_COST)
        except QuotaError as exc:
            return _quota_json(exc)
        if not image or not image.filename:
            return JSONResponse({"error": "image file required"}, status_code=400)
        raw_bytes = await image.read()
        if len(raw_bytes) > 20 * 1024 * 1024:
            return JSONResponse({"error": "image too large (max ~20MB)"}, status_code=413)
        try:
            png_bytes = normalize_to_png_limited(raw_bytes, max_px=2048)
        except EditingError as exc:
            return JSONResponse({"error": exc.message}, status_code=exc.status_code)

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
            try:
                usage = await persist_generation_result(
                    s3_key=key,
                    pose=norm_poses[0],
                    prompt=prompt_text,
                    options={
                        "gender": gender,
                        "environment": environment,
                        "poses": norm_poses,
                        "extra": extra,
                        "env_default_s3_key": env_key_used,
                        "model_default_s3_key": person_key_used,
                        "model_description_text": (
                            model_description_text if not person_key_used else None
                        ),
                        "garment_type": garment_type,
                        "garment_type_override": (
                            garment_type_override if garment_type_override else None
                        ),
                        "user_id": x_user_id,
                        "prompt_variant": prompt_variant,
                    },
                    model_name=MODEL,
                    usage_identity=identity,
                    usage_amount=GENERATION_COST,
                )
            except QuotaError as exc:
                LOGGER.warning("quota exceeded after edit generation", extra={"s3_key": key})
                return _quota_json(exc)
            response = StreamingResponse(BytesIO(png_bytes_out), media_type="image/png")
            if usage:
                _attach_usage_headers(response, usage)
            return response

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
                    try:
                        usage = await persist_generation_result(
                            s3_key=key,
                            pose=norm_poses[0],
                            prompt=prompt_text,
                            options={
                                "gender": gender,
                                "environment": environment,
                                "poses": norm_poses,
                                "extra": extra,
                                "env_default_s3_key": env_key_used,
                                "model_default_s3_key": person_key_used,
                                "model_description_text": (
                                    model_description_text if not person_key_used else None
                                ),
                                "garment_type": garment_type,
                                "garment_type_override": (
                                    garment_type_override if garment_type_override else None
                                ),
                                "user_id": x_user_id,
                                "prompt_variant": prompt_variant,
                            },
                            model_name=MODEL,
                            usage_identity=identity,
                            usage_amount=GENERATION_COST,
                        )
                    except QuotaError as exc:
                        LOGGER.warning("quota exceeded after edit retry", extra={"s3_key": key})
                        return _quota_json(exc)
                    response = StreamingResponse(BytesIO(png_bytes2), media_type="image/png")
                    if usage:
                        _attach_usage_headers(response, usage)
                    return response
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
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
    x_user_admin: str | None = Header(default=None, alias="X-User-Is-Admin"),
):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        identity = build_usage_identity(
            x_user_id,
            email=x_user_email,
            is_admin_hint=_parse_bool_header(x_user_admin),
        )
        try:
            await ensure_can_consume(identity, amount=GENERATION_COST)
        except QuotaError as exc:
            return _quota_json(exc)
        listing_ctx = await resolve_listing_context(
            listing_id, x_user_id, required=not (image and image.filename)
        )
        source = await load_garment_source(image, listing_ctx)
        listing_ctx = source.listing or listing_ctx
        inputs = normalize_edit_inputs(
            gender,
            environment,
            poses,
            extra,
            default_pose=None,
        )

        garment_type = await classify_garment_type(source.png_bytes, garment_type_override)

        use_env_image = bool(env_default_s3_key)
        use_person_image = bool(model_default_s3_key)
        pose_str = inputs.primary_pose
        if prompt_override and prompt_override.strip():
            prompt_text = prompt_override.strip()
            prompt_variant = "override"
        else:
            prompt_text = classic_detailed(
                gender=inputs.gender,
                environment=inputs.environment,
                pose=pose_str,
                use_person_image=use_person_image,
                use_env_image=use_env_image,
                person_description=(
                    model_description_text
                    if (model_description_text and not use_person_image)
                    else None
                ),
                garment_type=garment_type,
            )
            prompt_variant = "detailed"

        parts: list[genai_types.Part] = [genai_types.Part.from_text(text=prompt_text)]
        if (not use_person_image) and model_description_text:
            parts.append(
                genai_types.Part.from_text(
                    text=f"Person description: {model_description_text}"
                )
            )
        parts.append(
            genai_types.Part.from_bytes(data=source.png_bytes, mime_type="image/png")
        )

        person_key_used: str | None = None
        env_key_used: str | None = None
        if model_default_s3_key:
            try:
                person_bytes, person_mime = get_object_bytes(model_default_s3_key)
                parts.append(
                    genai_types.Part.from_bytes(
                        data=person_bytes, mime_type=person_mime or "image/png"
                    )
                )
                person_key_used = model_default_s3_key
            except Exception:
                person_key_used = None
        if env_default_s3_key:
            try:
                env_bytes, env_mime = get_object_bytes(env_default_s3_key)
                parts.append(
                    genai_types.Part.from_bytes(
                        data=env_bytes, mime_type=env_mime or "image/png"
                    )
                )
                env_key_used = env_default_s3_key
            except Exception:
                env_key_used = None

        base_options = {
            "gender": inputs.gender,
            "environment": inputs.environment,
            "poses": inputs.poses,
            "extra": inputs.extra,
            "env_default_s3_key": env_key_used,
            "model_default_s3_key": person_key_used,
            "model_description_text": (
                model_description_text if not person_key_used else None
            ),
            "garment_type": garment_type,
            "garment_type_override": (
                garment_type_override if garment_type_override else None
            ),
            "user_id": x_user_id,
        }

        resp = await genai_generate_with_retries(parts, attempts=2)
        png_bytes = first_inline_image_bytes(resp)
        pose_for_storage = pose_str or "pose"
        if png_bytes:
            _, key = upload_image(png_bytes, pose=pose_for_storage)
            try:
                usage = await persist_generation_result(
                    s3_key=key,
                    pose=pose_for_storage,
                    prompt=prompt_text,
                    options=dict(base_options, prompt_variant=prompt_variant),
                    model_name=MODEL,
                    listing=listing_ctx,
                    update_listing_settings=True,
                    garment_type=garment_type,
                    garment_type_override=garment_type_override,
                    usage_identity=identity,
                    usage_amount=GENERATION_COST,
                )
            except QuotaError as exc:
                LOGGER.warning(
                    "quota exceeded after edit/json generation", extra={"s3_key": key}
                )
                return _quota_json(exc)
            try:
                url = generate_presigned_get_url(key)
            except Exception:
                url = None
            return {
                "ok": True,
                "s3_key": key,
                "url": url,
                "pose": pose_for_storage,
                "prompt": prompt_text,
                "listing_id": listing_ctx.id if listing_ctx else listing_id,
                "usage": usage.to_dict() if usage else None,
            }

        if not (prompt_override and prompt_override.strip()):
            try:
                prompt_variant = "concise"
                prompt_text = classic_concise(
                    gender=inputs.gender,
                    environment=inputs.environment,
                    pose=pose_str,
                    use_person_image=use_person_image,
                    use_env_image=use_env_image,
                    person_description=(
                        model_description_text
                        if (model_description_text and not use_person_image)
                        else None
                    ),
                    garment_type=garment_type,
                )
                parts[0] = genai_types.Part.from_text(text=prompt_text)
                resp2 = await genai_generate_with_retries(parts, attempts=1)
                png_bytes = first_inline_image_bytes(resp2)
                if png_bytes:
                    _, key = upload_image(png_bytes, pose=pose_for_storage)
                    try:
                        usage = await persist_generation_result(
                            s3_key=key,
                            pose=pose_for_storage,
                            prompt=prompt_text,
                            options=dict(base_options, prompt_variant=prompt_variant),
                            model_name=MODEL,
                            listing=listing_ctx,
                            update_listing_settings=True,
                            garment_type=garment_type,
                            garment_type_override=garment_type_override,
                            usage_identity=identity,
                            usage_amount=GENERATION_COST,
                        )
                    except QuotaError as exc:
                        LOGGER.warning(
                            "quota exceeded after edit/json fallback", extra={"s3_key": key}
                        )
                        return _quota_json(exc)
                    try:
                        url = generate_presigned_get_url(key)
                    except Exception:
                        url = None
                    return {
                        "ok": True,
                        "s3_key": key,
                        "url": url,
                        "pose": pose_for_storage,
                        "prompt": prompt_text,
                        "listing_id": listing_ctx.id if listing_ctx else listing_id,
                        "usage": usage.to_dict() if usage else None,
                    }
            except Exception:
                pass

        return JSONResponse({"error": "no edited image from model"}, status_code=502)
    except EditingError as exc:
        return JSONResponse({"error": exc.message}, status_code=exc.status_code)
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
    x_user_email: str | None = Header(default=None, alias="X-User-Email"),
    x_user_admin: str | None = Header(default=None, alias="X-User-Is-Admin"),
):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        identity = build_usage_identity(
            x_user_id,
            email=x_user_email,
            is_admin_hint=_parse_bool_header(x_user_admin),
        )
        try:
            await ensure_can_consume(identity, amount=GENERATION_COST)
        except QuotaError as exc:
            return _quota_json(exc)
        listing_ctx = await resolve_listing_context(
            listing_id, x_user_id, required=not (image and image.filename)
        )
        source = await load_garment_source(image, listing_ctx)
        listing_ctx = source.listing or listing_ctx
        inputs = normalize_edit_inputs(
            gender,
            environment,
            poses,
            extra,
            default_pose=None,
        )

        use_env_image = bool(env_default_s3_key)
        use_person_image = bool(model_default_s3_key)
        garment_type = await classify_garment_type(source.png_bytes, garment_type_override)

        if prompt_override_step1 and prompt_override_step1.strip():
            step1_prompt = prompt_override_step1.strip()
            step1_variant = "override"
        else:
            step1_prompt = seq_step1_detailed(
                use_person_image=use_person_image,
                pose=inputs.primary_pose,
                person_description=(
                    model_description_text
                    if (model_description_text and not use_person_image)
                    else None
                ),
                gender=inputs.gender,
            )
            step1_variant = "detailed"

        parts1: list[genai_types.Part] = [genai_types.Part.from_text(text=step1_prompt)]
        person_key_used: str | None = None
        if model_default_s3_key:
            try:
                person_bytes, person_mime = get_object_bytes(model_default_s3_key)
                parts1.append(genai_types.Part.from_text(text="Person reference:"))
                parts1.append(
                    genai_types.Part.from_bytes(
                        data=person_bytes, mime_type=person_mime or "image/png"
                    )
                )
                person_key_used = model_default_s3_key
            except Exception:
                person_key_used = None
        elif model_description_text:
            parts1.append(
                genai_types.Part.from_text(
                    text=f"Person description: {model_description_text}"
                )
            )
        parts1.append(
            genai_types.Part.from_bytes(data=source.png_bytes, mime_type="image/png")
        )

        resp1 = await genai_generate_with_retries(parts1, attempts=2)
        step1_png = first_inline_image_bytes(resp1)
        if not step1_png and not (prompt_override_step1 and prompt_override_step1.strip()):
            try:
                step1_variant = "concise"
                step1_prompt = seq_step1_concise(
                    use_person_image=use_person_image,
                    pose=inputs.primary_pose,
                    person_description=(
                        model_description_text
                        if (model_description_text and not use_person_image)
                        else None
                    ),
                    gender=inputs.gender,
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
                environment=inputs.environment,
                pose=inputs.primary_pose,
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
                parts2.append(
                    genai_types.Part.from_bytes(
                        data=env_bytes, mime_type=env_mime or "image/png"
                    )
                )
                env_key_used = env_default_s3_key
            except Exception:
                env_key_used = None

        resp2 = await genai_generate_with_retries(parts2, attempts=2)
        png_bytes = first_inline_image_bytes(resp2)
        if not png_bytes and not (prompt_override_step2 and prompt_override_step2.strip()):
            try:
                step2_variant = "concise"
                step2_prompt = seq_step2_concise(
                    environment=inputs.environment,
                    pose=inputs.primary_pose,
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

        base_options = {
            "gender": inputs.gender,
            "environment": inputs.environment,
            "poses": inputs.poses,
            "extra": inputs.extra,
            "env_default_s3_key": env_key_used,
            "model_default_s3_key": person_key_used,
            "model_description_text": (
                model_description_text if not person_key_used else None
            ),
            "garment_type": garment_type,
            "garment_type_override": (
                garment_type_override if garment_type_override else None
            ),
            "user_id": x_user_id,
            "step1_variant": step1_variant,
        }

        pose_for_storage = inputs.primary_pose or "pose"
        _, key = upload_image(png_bytes, pose=pose_for_storage)
        try:
            usage = await persist_generation_result(
                s3_key=key,
                pose=pose_for_storage,
                prompt=step2_prompt,
                options=dict(base_options, prompt_variant=step2_variant),
                model_name=MODEL,
                listing=listing_ctx,
                update_listing_settings=False,
                garment_type=garment_type,
                garment_type_override=garment_type_override,
                usage_identity=identity,
                usage_amount=GENERATION_COST,
            )
        except QuotaError as exc:
            LOGGER.warning("quota exceeded after sequential edit", extra={"s3_key": key})
            return _quota_json(exc)
        try:
            url = generate_presigned_get_url(key)
        except Exception:
            url = None
        return {
            "ok": True,
            "s3_key": key,
            "url": url,
            "pose": pose_for_storage,
            "prompt": step2_prompt,
            "listing_id": listing_ctx.id if listing_ctx else listing_id,
            "usage": usage.to_dict() if usage else None,
        }
    except EditingError as exc:
        return JSONResponse({"error": exc.message}, status_code=exc.status_code)
    except genai_errors.APIError as exc:
        LOGGER.exception("GenAI API error on /edit/sequential/json")
        return JSONResponse({"error": exc.message, "code": exc.code}, status_code=502)
    except Exception as exc:
        LOGGER.exception("Unhandled error on /edit/sequential/json")
        return JSONResponse({"error": str(exc)}, status_code=500)
