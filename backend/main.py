import os
from io import BytesIO
from typing import Optional

import logging
from fastapi import FastAPI, UploadFile, Form, File, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from PIL import Image
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from .db import (
    db_session,
    init_db,
    Generation,
    EnvSource,
    EnvDefault,
    EnvDefaultUser,
    ModelDefault,
    ModelSource,
    ModelDescription,
    PoseSource,
    PoseDescription,
)
from .storage import (
    upload_image,
    upload_source_image,
    upload_model_source_image,
    upload_pose_source_image,
    get_object_bytes,
    delete_objects,
    generate_presigned_get_url,
)
from sqlalchemy import select, func, text

# Config
MODEL = os.getenv("GENAI_MODEL", "gemini-2.5-flash-image-preview")
API_KEY = os.getenv("GOOGLE_API_KEY", "")

app = FastAPI(title="VintedBoost Backend", version="0.1.0")
logger = logging.getLogger("uvicorn.error")

# CORS - allow local Next.js dev and same-origin deployments
# CORS origins from env (comma-separated). Fallback to permissive during MVP.
env_origins = os.getenv("CORS_ALLOW_ORIGINS", "*")
origins = [o.strip() for o in env_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Google GenAI client
_client: Optional[genai.Client] = None

def get_client() -> genai.Client:
    global _client
    if _client is None:
        if not API_KEY:
            raise RuntimeError("GOOGLE_API_KEY env var is required")
        _client = genai.Client(api_key=API_KEY)
    return _client


@app.get("/health")
async def health():
    return {"ok": True, "model": MODEL}


@app.on_event("startup")
async def on_startup():
    try:
        await init_db()
        logger.info("DB initialized")
    except Exception:
        logger.exception("Failed to initialize DB")


@app.post("/generate")
async def generate(prompt: str = Form("i want this clothe on someone")):
    try:
        client = get_client()
        resp = client.models.generate_content(
            model=MODEL,
            contents=types.Content(
                role="user",
                parts=[types.Part.from_text(text=prompt)],
            ),
        )
        for c in getattr(resp, "candidates", []) or []:
            for p in getattr(c, "content", {}).parts or []:
                if getattr(p, "inline_data", None):
                    img_bytes = BytesIO(p.inline_data.data)
                    return StreamingResponse(img_bytes, media_type="image/png")
        return JSONResponse({"error": "no image from model"}, status_code=502)
    except genai_errors.APIError as e:
        logger.exception("GenAI API error on /generate")
        return JSONResponse({"error": e.message, "code": e.code}, status_code=502)
    except Exception as e:
        logger.exception("Unhandled error on /generate")
        return JSONResponse({"error": str(e)}, status_code=500)


def _normalize_choice(value: str, allowed: list[str], default: str) -> str:
    value = (value or "").strip().lower()
    return value if value in allowed else default


def _build_prompt(*, gender: str, environment: str, poses: list[str], extra: str) -> str:
    """Legacy prompt builder (kept for reference)."""
    pieces: list[str] = []
    pieces.append("Put this clothing item on a realistic person model.")
    pieces.append(f"Gender: {gender}.")
    pieces.append(f"Environment: {environment}.")
    if poses:
        pieces.append("Poses: " + ", ".join(poses) + ".")
    if extra:
        pieces.append(extra)
    pieces.append("Realistic fit, high-quality fashion photo, natural lighting.")
    return " ".join(pieces)


def build_mirror_selfie_prompt(
    *,
    gender: str,
    environment: str,
    pose: str,
    extra: str,
    use_env_image: bool,
    use_person_image: bool,
    person_description: Optional[str] = None,
) -> str:
    """Builds the canonical 'Mirror Selfie for Vinted' prompt with constraints.

    - Always instructs mirror selfie with a black iPhone 16 Pro and amateur style.
    - If an environment ref is provided, we avoid prescribing a textual environment.
    - Optionally includes a short person description when no person image is provided.
    """
    # Normalize fields and ensure empty strings for missing conditioned controls
    def norm(x: Optional[str]) -> str:
        return (x or "").strip()

    conditioned_gender = norm(gender)
    conditioned_env = norm(environment) if not use_env_image else ""
    conditioned_pose = norm(pose)
    conditioned_extra = norm(extra)

    lines: list[str] = []
    lines.append("High-level goals")
    lines.append("- Photorealistic mirror selfie suitable for a Vinted listing.")
    lines.append("- The person holds a black iPhone 16 Pro; amateur smartphone look.")
    lines.append("- Garment is the hero: exact shape, color, fabric, prints, logos.")
    lines.append("")
    lines.append("TASK")
    lines.append(
        "You render a photorealistic mirror selfie of a person wearing the provided garment. "
        "The person holds a black iPhone 16 Pro. If a person reference is provided, keep hair and overall build consistent (the face may be occluded by the phone). "
        "If an environment reference is provided, treat it as a mirror scene and match its lighting, camera angle, color palette, and depth of field. Keep an amateur phone-shot look."
    )
    lines.append("")
    lines.append("REQUIRED OUTPUT")
    lines.append("- One 2D PNG photo, vertical smartphone framing (prefer 4:5).")
    lines.append("- Realistic lighting and skin; garment clearly visible and dominant.")
    lines.append("- The person must be wearing the uploaded garment; do not omit or replace it.")
    lines.append("")
    lines.append("HARD CONSTRAINTS (must follow)")
    lines.append("1) Garment fidelity: preserve exact silhouette, color, fabric texture, print scale/alignment, closures, and logos from the garment image.")
    lines.append("2) Body realism: natural proportions; correct anatomy; no extra fingers; no warped limbs.")
    lines.append("3) Face realism: plausible expression; no duplicates/melting; preserve identity cues (hair/build) if a person ref is provided.")
    lines.append("4) Clothing fit: believable size and drape; respect gravity and fabric stiffness.")
    lines.append("5) Clean output: no watermarks, no AI artifacts, no text overlays, no added logos.")
    lines.append("6) Safety: PG-13; no explicit content.")
    lines.append("7) Mirror selfie: a black iPhone 16 Pro is held in front of the face in the mirror; ensure the phone occludes the face area consistently (with correct reflection), without obscuring key garment details.")
    lines.append("8) Garment usage: the person must be wearing the uploaded garment; do not omit or replace it.")
    lines.append("")
    lines.append("CONDITIONED CONTROLS")
    lines.append(f"- Gender: {conditioned_gender if conditioned_gender else '""'}")
    lines.append(f"- Environment: {conditioned_env if conditioned_env else '""'}")
    lines.append(f"- Pose: {conditioned_pose if conditioned_pose else '""'}")
    lines.append(f"- Extra user instructions: \"{conditioned_extra.replace('\\n', ' ')}\"")
    lines.append("")
    lines.append("STYLE & CAMERA DIRECTION")
    lines.append("- Smartphone mirror-selfie aesthetic; natural colors; mild grain acceptable.")
    lines.append("- 3/4 or full-body by default so the garment is fully visible.")
    lines.append("- Camera look: ~26–35mm equivalent; mild lens distortion; f/2.8–f/5.6; soft bokeh if indoors.")
    lines.append("- Lighting: match environment reference if given; otherwise soft directional key + gentle fill; subtle rim for separation.")
    lines.append("- Composition: center subject in mirror; show phone and hand; avoid cropping garment edges; keep hands visible naturally.")
    lines.append("")
    lines.append("ENVIRONMENT BEHAVIOR")
    lines.append("- If an environment reference is provided: treat it as a mirror scene; imitate its framing, palette, light direction, shadows, and DoF; keep any mirror frame consistent.")
    lines.append("- If not provided: synthesize a clean mirror setting (bedroom/closet/bath) that complements the garment; uncluttered background.")
    lines.append("")
    lines.append("PERSON BEHAVIOR")
    lines.append("- If a person reference is provided: keep hair, skin tone, and general build consistent (face may be partly occluded by phone).")
    lines.append("- If not provided: synthesize a plausible model matching the gender; friendly neutral expression.")
    if person_description:
        lines.append("- Use a person that matches this description.")
        lines.append(f"- Person description: {person_description}")
    lines.append("- Hand pose: holding a black iPhone 16 Pro naturally; fingers look correct; phone and its reflection visible.")
    lines.append("")
    lines.append("POSE RENDERING")
    lines.append(f"- Enforce the requested pose: {conditioned_pose if conditioned_pose else '""'}. Make it balanced and anatomically plausible.")
    lines.append("- Ensure the garment remains fully visible and not occluded by the phone or pose.")
    lines.append("")
    lines.append("QUALITY CHECK BEFORE OUTPUT")
    lines.append("- Fingers: five per hand; shapes correct.")
    lines.append("- Garment: crisp edges; seams/hemlines visible; prints/logos accurate.")
    lines.append("- Face: no duplicates; no melting; if visible, eyes symmetrical; otherwise occluded by phone.")
    lines.append("- Mirror: phone and reflection consistent; no extra phones; no camera artifacts.")
    lines.append("- Background: clean and coherent; matches env ref if provided.")
    lines.append("")
    lines.append("NEGATIVE GUIDANCE (avoid)")
    lines.append("blurry, over-saturated, HDR halos, duplicated limbs, extra fingers, warped faces, melted textures, text overlays, watermarks, added/brand-new logos, heavy beauty retouching, studio glamour look, ring-light glare, tripod/DSLR look, explicit content.")
    lines.append("")
    lines.append("END OF INSTRUCTIONS")

    return "\n".join(lines)


@app.post("/edit")
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
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not image or not image.filename:
            return JSONResponse({"error": "image file required"}, status_code=400)
        # Read uploaded image bytes first for size checks
        raw_bytes = await image.read()
        if len(raw_bytes) > 10 * 1024 * 1024:  # 10MB inline safety
            return JSONResponse({"error": "image too large (max ~10MB)"}, status_code=413)

        # Decode and normalize to PNG bytes
        src = Image.open(BytesIO(raw_bytes))
        buf = BytesIO()
        src.convert("RGBA").save(buf, format="PNG")
        buf.seek(0)

        # Validate and normalize options
        gender = _normalize_choice(gender, ["woman", "man"], "woman")
        environment = _normalize_choice(environment, ["studio", "street", "bed", "beach", "indoor"], "studio")
        # Normalize poses array (multi-select). Accept up to 3 unique values
        allowed_poses = ["standing", "sitting", "lying down", "walking"]
        if not poses:
            poses = []
        if not isinstance(poses, list):
            poses = [poses]
        norm_poses: list[str] = []
        for p in poses:
            p_norm = _normalize_choice(p, allowed_poses, "")
            if p_norm and p_norm not in norm_poses:
                norm_poses.append(p_norm)
            if len(norm_poses) >= 3:
                break
        extra = (extra or "").strip()
        if len(extra) > 200:
            extra = extra[:200]

        if not norm_poses:
            norm_poses = ["standing"]

        # Build prompt (Mirror Selfie template) considering optional environment/person references
        parts: list[types.Part] = []
        env_key_used: str | None = None
        person_key_used: str | None = None

        use_env_image = bool(env_default_s3_key)
        use_person_image = bool(model_default_s3_key)
        pose_str = norm_poses[0] if norm_poses else ""

        # Prefer explicit override; otherwise build canonical mirror selfie prompt
        if prompt_override and prompt_override.strip():
            prompt_text = prompt_override.strip()
        else:
            prompt_text = build_mirror_selfie_prompt(
                gender=gender,
                environment=environment,
                pose=pose_str,
                extra=extra,
                use_env_image=use_env_image,
                use_person_image=use_person_image,
                person_description=(model_description_text if (model_description_text and not use_person_image) else None),
            )
        parts.append(types.Part.from_text(text=prompt_text))

        if env_default_s3_key:
            try:
                env_bytes, env_mime = get_object_bytes(env_default_s3_key)
                parts.append(types.Part.from_text(text="Environment reference:"))
                parts.append(types.Part.from_bytes(data=env_bytes, mime_type=env_mime or "image/png"))
                env_key_used = env_default_s3_key
            except Exception:
                env_key_used = None
        if model_default_s3_key:
            try:
                person_bytes, person_mime = get_object_bytes(model_default_s3_key)
                parts.append(types.Part.from_text(text="Person reference:"))
                parts.append(types.Part.from_bytes(data=person_bytes, mime_type=person_mime or "image/png"))
                person_key_used = model_default_s3_key
            except Exception:
                person_key_used = None

        # Uploaded garment/source image last
        image_part = types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png")
        parts.append(image_part)

        contents = types.Content(role="user", parts=parts)
        client = get_client()
        resp = client.models.generate_content(
            model=MODEL,
            contents=contents,
        )
        for c in getattr(resp, "candidates", []) or []:
            for p in getattr(c, "content", {}).parts or []:
                if getattr(p, "inline_data", None):
                    png_bytes = p.inline_data.data
                    # Upload to S3
                    bucket, key = upload_image(png_bytes, pose=norm_poses[0])
                    # Persist to DB
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
                                "user_id": x_user_id,
                            },
                            model=MODEL,
                        )
                        session.add(rec)
                    # Stream bytes back for current UI
                    return StreamingResponse(BytesIO(png_bytes), media_type="image/png")
        return JSONResponse({"error": "no edited image from model"}, status_code=502)
    except genai_errors.APIError as e:
        logger.exception("GenAI API error on /edit")
        return JSONResponse({"error": e.message, "code": e.code}, status_code=502)
    except Exception as e:
        logger.exception("Unhandled error on /edit")
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Environment sources and generation ---

@app.post("/env/sources/upload")
async def upload_env_sources(files: list[UploadFile] = File(...)):
    try:
        stored = []
        for f in files:
            data = await f.read()
            bucket, key = upload_source_image(data, mime=f.content_type)
            async with db_session() as session:
                rec = EnvSource(s3_key=key)
                session.add(rec)
            stored.append({"s3_key": key})
        return {"ok": True, "count": len(stored), "items": stored}
    except Exception as e:
        logger.exception("Failed to upload env sources")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/env/sources")
async def list_env_sources():
    try:
        async with db_session() as session:
            stmt = select(EnvSource.s3_key).order_by(EnvSource.created_at.desc())
            res = await session.execute(stmt)
            items = [row[0] for row in res.all()]
        return {"ok": True, "count": len(items), "items": items}
    except Exception as e:
        logger.exception("Failed to list env sources")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/env/sources")
async def delete_env_sources():
    try:
        # Fetch all keys
        async with db_session() as session:
            stmt = select(EnvSource.s3_key)
            res = await session.execute(stmt)
            keys = [row[0] for row in res.all()]
        # Delete from S3 first
        delete_objects(keys)
        # Delete from DB
        async with db_session() as session:
            await session.execute(text("DELETE FROM env_sources"))
        return {"ok": True, "deleted": len(keys)}
    except Exception as e:
        logger.exception("Failed to delete env sources")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/env/random")
async def generate_env_random(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    """Pick a random stored source and generate with strict instruction."""
    try:
        # Fetch random one
        async with db_session() as session:
            # Using raw SQL with text() to avoid dialect differences
            stmt = text("SELECT s3_key FROM env_sources ORDER BY RANDOM() LIMIT 1")
            res = await session.execute(stmt)
            row = res.first()
        if not row:
            return JSONResponse({"error": "no sources uploaded"}, status_code=400)

        instruction = "randomize the scene and the mirror frame"
        # Load source image bytes from S3 and include as input
        src_bytes, mime = get_object_bytes(row[0])
        image_part = types.Part.from_bytes(data=src_bytes, mime_type=mime)
        resp = get_client().models.generate_content(
            model=MODEL,
            contents=types.Content(role="user", parts=[types.Part.from_text(text=instruction), image_part]),
        )
        for c in getattr(resp, "candidates", []) or []:
            for p in getattr(c, "content", {}).parts or []:
                if getattr(p, "inline_data", None):
                    png_bytes = p.inline_data.data
                    # persist result
                    bucket, key = upload_image(png_bytes, pose="env")
                    async with db_session() as session:
                        rec = Generation(
                            s3_key=key,
                            pose="env",
                            prompt=instruction,
                            options_json={
                                "mode": "random",
                                "source_s3_key": row[0],
                                "user_id": x_user_id,
                            },
                            model=MODEL,
                        )
                        session.add(rec)
                    return StreamingResponse(BytesIO(png_bytes), media_type="image/png")
        return JSONResponse({"error": "no image from model"}, status_code=502)
    except Exception as e:
        logger.exception("env random failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/env/generate")
async def generate_env(prompt: str = Form(""), x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        instruction = "randomize the scene and the mirror frame"
        full = instruction if not prompt.strip() else f"{instruction}. {prompt.strip()}"
        # Use a random uploaded source image
        async with db_session() as session:
            stmt = text("SELECT s3_key FROM env_sources ORDER BY RANDOM() LIMIT 1")
            res = await session.execute(stmt)
            row = res.first()
        if not row:
            return JSONResponse({"error": "no sources uploaded"}, status_code=400)
        src_bytes, mime = get_object_bytes(row[0])
        image_part = types.Part.from_bytes(data=src_bytes, mime_type=mime)
        resp = get_client().models.generate_content(
            model=MODEL,
            contents=types.Content(role="user", parts=[types.Part.from_text(text=full), image_part]),
        )
        for c in getattr(resp, "candidates", []) or []:
            for p in getattr(c, "content", {}).parts or []:
                if getattr(p, "inline_data", None):
                    png_bytes = p.inline_data.data
                    bucket, key = upload_image(png_bytes, pose="env")
                    async with db_session() as session:
                        rec = Generation(
                            s3_key=key,
                            pose="env",
                            prompt=full,
                            options_json={
                                "mode": "prompt",
                                "user_prompt": prompt.strip(),
                                "source_s3_key": row[0],
                                "user_id": x_user_id,
                            },
                            model=MODEL,
                        )
                        session.add(rec)
                    return StreamingResponse(BytesIO(png_bytes), media_type="image/png")
        return JSONResponse({"error": "no image from model"}, status_code=502)
    except Exception as e:
        logger.exception("env generate failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/env/generated")
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
                # No user id provided: return empty list to avoid cross-user leakage
                stmt = select(Generation.s3_key, Generation.created_at).where(text("1=0"))
            res = await session.execute(stmt)
            rows = res.all()
            items = []
            for row in rows:
                key = row[0]
                created = row[1]
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
    except Exception as e:
        logger.exception("Failed to list generated images")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/env/image")
async def get_generated_image(s3_key: str):
    try:
        data, content_type = get_object_bytes(s3_key)
        return StreamingResponse(BytesIO(data), media_type=content_type)
    except Exception as e:
        logger.exception("Failed to fetch generated image")
        return JSONResponse({"error": str(e)}, status_code=404)


# --- Defaults (select up to 5, name them) ---

@app.get("/env/defaults")
async def list_defaults(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        async with db_session() as session:
            if not x_user_id:
                rows = []
            else:
                stmt = (
                    select(EnvDefaultUser.s3_key, EnvDefaultUser.name)
                    .where(EnvDefaultUser.user_id == x_user_id)
                    .order_by(EnvDefaultUser.created_at.desc())
                )
                res = await session.execute(stmt)
                rows = res.all()
            items = []
            for row in rows:
                key, name = row
                try:
                    url = generate_presigned_get_url(key)
                except Exception:
                    url = None
                items.append({"s3_key": key, "name": name, "url": url})
        return {"ok": True, "items": items}
    except Exception as e:
        logger.exception("Failed to list defaults")
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Model generation (randomize a person with optional env reference) ---

def _normalize_gender(g: str) -> str:
    g = (g or "").strip().lower()
    return g if g in ("man", "woman") else "man"


@app.post("/model/generate")
async def model_generate(
    image: UploadFile = File(...),
    gender: str = Form("man"),
    prompt: str = Form(""),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not image or not image.filename:
            return JSONResponse({"error": "image file required"}, status_code=400)
        # Read and normalize uploaded image to PNG bytes
        raw_bytes = await image.read()
        if len(raw_bytes) > 10 * 1024 * 1024:
            return JSONResponse({"error": "image too large (max ~10MB)"}, status_code=413)
        src = Image.open(BytesIO(raw_bytes))
        buf = BytesIO()
        src.convert("RGBA").save(buf, format="PNG")
        buf.seek(0)

        gender = _normalize_gender(gender)
        user_prompt = (prompt or "").strip()

        # Build instruction
        lines: list[str] = []
        lines.append(f"Randomize this {gender}.")
        if user_prompt:
            lines.append(user_prompt)
        lines.append("High quality fashion photo, natural lighting, realistic skin and fabric.")
        text_part = types.Part.from_text(text=" ".join(lines))

        parts: list[types.Part] = [text_part]

        # Person source image (also store source in S3 and DB)
        parts.append(types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png"))
        try:
            _, src_key = upload_model_source_image(buf.getvalue(), gender=gender, mime="image/png")
            async with db_session() as session:
                session.add(ModelSource(gender=gender, s3_key=src_key))
        except Exception:
            # Non-fatal if source upload fails; continue generation
            pass

        resp = get_client().models.generate_content(
            model=MODEL,
            contents=types.Content(role="user", parts=parts),
        )
        for c in getattr(resp, "candidates", []) or []:
            for p in getattr(c, "content", {}).parts or []:
                if getattr(p, "inline_data", None):
                    png_bytes = p.inline_data.data
                    bucket, key = upload_image(png_bytes, pose=f"model-{gender}")
                    async with db_session() as session:
                        rec = Generation(
                            s3_key=key,
                            pose=f"model-{gender}",
                            prompt=" ".join(lines),
                            options_json={
                                "mode": "model",
                                "gender": gender,
                                "user_prompt": user_prompt,
                                "user_id": x_user_id,
                            },
                            model=MODEL,
                        )
                        session.add(rec)
                    # Run a follow-up description generation on the produced image
                    try:
                        describe_prompt = "descibe this person in the most detail way possible espacialy the face not the clothe output max token"
                        desc_parts = [types.Part.from_text(text=describe_prompt), types.Part.from_bytes(data=png_bytes, mime_type="image/png")]
                        desc_resp = get_client().models.generate_content(
                            model=MODEL,
                            contents=types.Content(role="user", parts=desc_parts),
                        )
                        description_text = None
                        for dc in getattr(desc_resp, "candidates", []) or []:
                            # attempt to extract text
                            if getattr(dc, "content", None) and getattr(dc.content, "parts", None):
                                for part in dc.content.parts:
                                    if getattr(part, "text", None):
                                        description_text = part.text
                                        break
                            if description_text:
                                break
                        if description_text:
                            async with db_session() as session:
                                session.add(ModelDescription(s3_key=key, description=description_text))
                    except Exception:
                        # Non-fatal if description generation fails
                        pass
                    return StreamingResponse(BytesIO(png_bytes), media_type="image/png")
        return JSONResponse({"error": "no image from model"}, status_code=502)
    except Exception as e:
        logger.exception("model generate failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/env/defaults")
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
        # Overwrite all defaults
        async with db_session() as session:
            await session.execute(text("DELETE FROM env_defaults_user WHERE user_id = :uid"), {"uid": x_user_id})
            for key, name in zip(s3_keys, names):
                session.add(EnvDefaultUser(user_id=x_user_id, s3_key=key, name=name.strip() or "Untitled"))
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to set defaults")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/env/defaults")
async def unset_default(s3_key: str):
    """Remove a single default by s3_key, keeping others intact."""
    try:
        async with db_session() as session:
            # Remove from any user's defaults
            await session.execute(text("DELETE FROM env_defaults_user WHERE s3_key = :k"), {"k": s3_key})
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to unset default")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.patch("/env/defaults")
async def rename_default(s3_key: str = Form(...), name: str = Form(...), x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    """Rename a single default by s3_key."""
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
    except Exception as e:
        logger.exception("Failed to rename default")
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Manage generated images (delete) ---

@app.delete("/env/generated")
async def delete_generated(s3_key: str):
    """Delete a generated environment image from S3 and DB. If it's set as a default, remove that too."""
    try:
        # Delete S3 object
        delete_objects([s3_key])
        # Delete from DB (generations + possibly defaults)
        async with db_session() as session:
            await session.execute(text("DELETE FROM generations WHERE s3_key = :k"), {"k": s3_key})
            await session.execute(text("DELETE FROM env_defaults_user WHERE s3_key = :k"), {"k": s3_key})
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to delete generated image")
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Pose sources upload and pose-only description generation ---

@app.post("/pose/sources/upload")
async def upload_pose_sources(files: list[UploadFile] = File(...)):
    try:
        stored = []
        for f in files:
            data = await f.read()
            _, key = upload_pose_source_image(data, mime=f.content_type)
            async with db_session() as session:
                session.add(PoseSource(s3_key=key))
            stored.append({"s3_key": key})
        return {"ok": True, "count": len(stored), "items": stored}
    except Exception as e:
        logger.exception("Failed to upload pose sources")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/pose/sources")
async def list_pose_sources():
    try:
        async with db_session() as session:
            stmt = select(PoseSource.s3_key).order_by(PoseSource.created_at.desc())
            res = await session.execute(stmt)
            items = [row[0] for row in res.all()]
        return {"ok": True, "items": items}
    except Exception as e:
        logger.exception("Failed to list pose sources")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/pose/sources")
async def delete_pose_sources():
    try:
        async with db_session() as session:
            res = await session.execute(select(PoseSource.s3_key))
            keys = [row[0] for row in res.all()]
        delete_objects(keys)
        async with db_session() as session:
            await session.execute(text("DELETE FROM pose_sources"))
            await session.execute(text("DELETE FROM pose_descriptions"))
        return {"ok": True, "deleted": len(keys)}
    except Exception as e:
        logger.exception("Failed to delete pose sources")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/pose/describe")
async def generate_pose_descriptions():
    """Generate pose-only textual descriptions for all uploaded pose sources that lack one."""
    try:
        # Fetch sources without a PoseDescription
        async with db_session() as session:
            src_rows = await session.execute(select(PoseSource.s3_key).order_by(PoseSource.created_at.desc()))
            src_keys = [row[0] for row in src_rows.all()]
            if not src_keys:
                return {"ok": True, "generated": 0}
            # Find which already have descriptions
            have_rows = await session.execute(select(PoseDescription.s3_key))
            have = {row[0] for row in have_rows.all()}
        todo = [k for k in src_keys if k not in have]
        if not todo:
            return {"ok": True, "generated": 0}

        client = get_client()
        count = 0
        for key in todo:
            try:
                img_bytes, mime = get_object_bytes(key)
                instruction = (
                    "Analyze this image and output only a concise pose description of the person. "
                    "Do not describe clothing, identity, background, or environment. "
                    "Mention body orientation, weight distribution, limb positions, and hand placements succinctly."
                )
                parts = [types.Part.from_text(text=instruction), types.Part.from_bytes(data=img_bytes, mime_type=mime or "image/png")]
                resp = client.models.generate_content(model=MODEL, contents=types.Content(role="user", parts=parts))
                desc_text = None
                for c in getattr(resp, "candidates", []) or []:
                    if getattr(c, "content", None) and getattr(c.content, "parts", None):
                        for p in c.content.parts:
                            if getattr(p, "text", None):
                                desc_text = p.text
                                break
                    if desc_text:
                        break
                if not desc_text:
                    continue
                async with db_session() as session:
                    session.add(PoseDescription(s3_key=key, description=desc_text))
                count += 1
            except Exception:
                # Continue with others
                continue
        return {"ok": True, "generated": count}
    except Exception as e:
        logger.exception("Failed to generate pose descriptions")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/pose/descriptions")
async def list_pose_descriptions():
    try:
        async with db_session() as session:
            stmt = select(PoseDescription.s3_key, PoseDescription.description, PoseDescription.created_at).order_by(PoseDescription.created_at.desc())
            res = await session.execute(stmt)
            items = [{"s3_key": r[0], "description": r[1], "created_at": r[2].isoformat()} for r in res.all()]
        return {"ok": True, "items": items}
    except Exception as e:
        logger.exception("Failed to list pose descriptions")
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Model generated listing and defaults management ---

@app.get("/model/generated")
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
                stmt = (
                    select(Generation.s3_key, Generation.created_at, Generation.options_json)
                    .where(text("1=0"))
                )
            res = await session.execute(stmt)
            rows = res.all()
            items = []
            for row in rows:
                key = row[0]
                created = row[1]
                gender = (row[2] or {}).get("gender")
                # fetch description if present
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
                items.append({"s3_key": key, "created_at": created.isoformat(), "gender": gender, "url": url, "description": desc_text})
        return {"ok": True, "items": items}
    except Exception as e:
        logger.exception("Failed to list model generated images")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/model/defaults")
async def list_model_defaults():
    try:
        async with db_session() as session:
            stmt = select(ModelDefault.gender, ModelDefault.s3_key, ModelDefault.name)
            res = await session.execute(stmt)
            rows = res.all()
            # Preload descriptions for these keys in one query
            keys = [row[1] for row in rows]
            desc_map: dict[str, Optional[str]] = {}
            if keys:
                try:
                    dstmt = select(ModelDescription.s3_key, ModelDescription.description).where(ModelDescription.s3_key.in_(keys))
                    dres = await session.execute(dstmt)
                    for k, d in dres.all():
                        desc_map[k] = d
                except Exception:
                    # If description lookup fails, proceed without them
                    desc_map = {}
            items = []
            for gender, key, name in rows:
                try:
                    url = generate_presigned_get_url(key)
                except Exception:
                    url = None
                items.append({
                    "gender": gender,
                    "s3_key": key,
                    "name": name,
                    "url": url,
                    "description": desc_map.get(key),
                })
        return {"ok": True, "items": items}
    except Exception as e:
        logger.exception("Failed to list model defaults")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/model/defaults")
async def set_model_default(gender: str = Form(...), s3_key: str = Form(...), name: str = Form("Default")):
    try:
        gender = _normalize_gender(gender)
        async with db_session() as session:
            # Upsert: keep only 1 per gender
            await session.execute(text("DELETE FROM model_defaults WHERE gender = :g"), {"g": gender})
            session.add(ModelDefault(gender=gender, s3_key=s3_key, name=(name or "").strip() or "Default"))
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to set model default")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.patch("/model/defaults")
async def rename_model_default(gender: str = Form(...), name: str = Form(...)):
    try:
        gender = _normalize_gender(gender)
        name = (name or "").strip() or "Default"
        async with db_session() as session:
            await session.execute(text("UPDATE model_defaults SET name = :n WHERE gender = :g"), {"n": name, "g": gender})
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to rename model default")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/model/defaults")
async def unset_model_default(gender: str):
    try:
        gender = _normalize_gender(gender)
        async with db_session() as session:
            await session.execute(text("DELETE FROM model_defaults WHERE gender = :g"), {"g": gender})
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to unset model default")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/model/generated")
async def delete_model_generated(s3_key: str):
    """Delete a generated model image from S3 and DB; clear from model defaults if set."""
    try:
        delete_objects([s3_key])
        async with db_session() as session:
            await session.execute(text("DELETE FROM generations WHERE s3_key = :k"), {"k": s3_key})
            await session.execute(text("DELETE FROM model_defaults WHERE s3_key = :k"), {"k": s3_key})
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to delete model generated image")
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Model sources (admin UI helper) ---

@app.post("/model/sources/upload")
async def upload_model_sources(gender: str = Form(...), files: list[UploadFile] = File(...)):
    """Upload one or more person source images for a given gender.

    Stored in S3 under model_sources/<gender>/ and tracked in the DB.
    """
    try:
        gender = _normalize_gender(gender)
        stored: list[dict] = []
        for f in files:
            data = await f.read()
            _, key = upload_model_source_image(data, gender=gender, mime=f.content_type)
            async with db_session() as session:
                session.add(ModelSource(gender=gender, s3_key=key))
            stored.append({"gender": gender, "s3_key": key})
        return {"ok": True, "count": len(stored), "items": stored}
    except Exception as e:
        logger.exception("Failed to upload model sources")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/model/sources")
async def list_model_sources(gender: str | None = None):
    """List uploaded person source images. Optionally filter by gender."""
    try:
        async with db_session() as session:
            stmt = select(ModelSource.gender, ModelSource.s3_key).order_by(ModelSource.created_at.desc())
            if gender:
                stmt = stmt.where(ModelSource.gender == _normalize_gender(gender))
            res = await session.execute(stmt)
            rows = res.all()
            items = []
            for g, key in rows:
                try:
                    url = generate_presigned_get_url(key)
                except Exception:
                    url = None
                items.append({"gender": g, "s3_key": key, "url": url})
        return {"ok": True, "items": items}
    except Exception as e:
        logger.exception("Failed to list model sources")
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
