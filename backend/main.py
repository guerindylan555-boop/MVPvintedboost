import os
from io import BytesIO
from typing import Optional

import logging
from fastapi import FastAPI, UploadFile, Form, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from PIL import Image
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from .db import db_session, init_db, Generation, EnvSource, EnvDefault, ModelDefault, ModelSource, ModelDescription
from .storage import (
    upload_image,
    upload_source_image,
    upload_model_source_image,
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

        # Build prompt considering optional environment/person reference inputs
        parts: list[types.Part] = []
        env_key_used: str | None = None
        person_key_used: str | None = None
        base_lines: list[str] = []
        base_lines.append("Put this clothing item on a realistic person model.")
        # Omit gender description if a person reference image is provided
        if not model_default_s3_key:
            base_lines.append(f"Gender: {gender}.")
        # Use textual environment only if no environment reference is provided
        if not env_default_s3_key:
            base_lines.append(f"Environment: {environment}.")
        if norm_poses:
            base_lines.append("Poses: " + ", ".join(norm_poses) + ".")
        if extra:
            base_lines.append(extra)
        # If caller provided a textual person description (and likely no image), include it explicitly
        if model_description_text:
            base_lines.append("Use a person that matches this description.")
            base_lines.append(f"Person description: {model_description_text}")
        if env_default_s3_key:
            base_lines.append("Use the provided environment reference image as the full background. Integrate subject realistically, keep lighting and framing consistent with the reference.")
        if model_default_s3_key:
            base_lines.append("Use the provided person reference image as the subject; preserve identity and pose while dressing them with the garment.")
        base_lines.append("Realistic fit, high-quality fashion photo, natural lighting.")
        prompt_text = " ".join(base_lines)
        # Allow caller to override the exact prompt text
        if prompt_override and prompt_override.strip():
            prompt_text = prompt_override.strip()
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
async def generate_env_random():
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
                            options_json={"mode": "random", "source_s3_key": row[0]},
                            model=MODEL,
                        )
                        session.add(rec)
                    return StreamingResponse(BytesIO(png_bytes), media_type="image/png")
        return JSONResponse({"error": "no image from model"}, status_code=502)
    except Exception as e:
        logger.exception("env random failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/env/generate")
async def generate_env(prompt: str = Form("")):
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
                            options_json={"mode": "prompt", "user_prompt": prompt.strip(), "source_s3_key": row[0]},
                            model=MODEL,
                        )
                        session.add(rec)
                    return StreamingResponse(BytesIO(png_bytes), media_type="image/png")
        return JSONResponse({"error": "no image from model"}, status_code=502)
    except Exception as e:
        logger.exception("env generate failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/env/generated")
async def list_generated():
    try:
        async with db_session() as session:
            stmt = (
                select(Generation.s3_key, Generation.created_at)
                .where(Generation.pose == "env")
                .order_by(Generation.created_at.desc())
                .limit(200)
            )
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
async def list_defaults():
    try:
        async with db_session() as session:
            stmt = select(EnvDefault.s3_key, EnvDefault.name).order_by(EnvDefault.created_at.desc())
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
):
    try:
        if len(s3_keys) != len(names):
            return JSONResponse({"error": "mismatched arrays"}, status_code=400)
        if len(s3_keys) > 5:
            return JSONResponse({"error": "max 5 defaults"}, status_code=400)
        # Overwrite all defaults
        async with db_session() as session:
            await session.execute(text("DELETE FROM env_defaults"))
            for key, name in zip(s3_keys, names):
                session.add(EnvDefault(s3_key=key, name=name.strip() or "Untitled"))
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to set defaults")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/env/defaults")
async def unset_default(s3_key: str):
    """Remove a single default by s3_key, keeping others intact."""
    try:
        async with db_session() as session:
            await session.execute(text("DELETE FROM env_defaults WHERE s3_key = :k"), {"k": s3_key})
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to unset default")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.patch("/env/defaults")
async def rename_default(s3_key: str = Form(...), name: str = Form(...)):
    """Rename a single default by s3_key."""
    try:
        name = (name or "").strip() or "Untitled"
        async with db_session() as session:
            await session.execute(
                text("UPDATE env_defaults SET name = :n WHERE s3_key = :k"),
                {"n": name, "k": s3_key},
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
            await session.execute(text("DELETE FROM env_defaults WHERE s3_key = :k"), {"k": s3_key})
        return {"ok": True}
    except Exception as e:
        logger.exception("Failed to delete generated image")
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Model generated listing and defaults management ---

@app.get("/model/generated")
async def list_model_generated():
    try:
        async with db_session() as session:
            stmt = (
                select(Generation.s3_key, Generation.created_at, Generation.options_json)
                .where(Generation.pose.in_(["model-man", "model-woman"]))
                .order_by(Generation.created_at.desc())
                .limit(200)
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
