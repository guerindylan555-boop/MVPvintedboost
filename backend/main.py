import os
from io import BytesIO
from typing import Optional

import logging
from fastapi import FastAPI, UploadFile, Form, File, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from PIL import Image
# Enable HEIC/HEIF support if available (for iPhone photos)
try:  # optional dependency
    from pillow_heif import register_heif_opener  # type: ignore

    register_heif_opener()
except Exception:
    # If pillow-heif is not installed, HEIC uploads will fail to decode
    pass
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from .db import (
    db_session,
    init_db,
    Generation,
    EnvSource,
    EnvDefaultUser,
    ModelDefault,
    ModelSource,
    ModelDescription,
    PoseSource,
    PoseDescription,
    ProductDescription,
    Listing,
    ListingImage,
)
from .storage import (
    upload_image,
    upload_source_image,
    upload_model_source_image,
    upload_pose_source_image,
    get_object_bytes,
    delete_objects,
    generate_presigned_get_url,
    upload_product_source_image,
)
from sqlalchemy import select, func, text
import asyncio
import uuid
from .prompts import (
    classic_detailed,
    classic_concise,
    seq_step1_detailed,
    seq_step1_concise,
    seq_step2_detailed,
    seq_step2_concise,
)

# Config
MODEL = os.getenv("GENAI_MODEL", "gemini-2.5-flash-image-preview")
API_KEY = os.getenv("GOOGLE_API_KEY", "")
GARMENT_TYPE_CLASSIFY = os.getenv("GARMENT_TYPE_CLASSIFY", "1").strip().lower() not in ("0", "false", "no")
GARMENT_TYPE_TTL_SECONDS = int(os.getenv("GARMENT_TYPE_TTL_SECONDS", "86400") or "86400")

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

# --- Garment type classification (top | bottom | full) ---
_garment_type_cache: dict[str, tuple[float, str]] = {}

def _sha1(data: bytes) -> str:
    import hashlib
    h = hashlib.sha1()
    h.update(data)
    return h.hexdigest()

def _normalize_garment_type(label: str) -> Optional[str]:
    s = (label or "").strip().lower()
    if s in ("top", "bottom", "full"):
        return s
    # Heuristic keyword mapping for occasional non-strict replies
    if any(k in s for k in ("dress", "jumpsuit", "romper", "boilersuit", "overalls", "pinafore", "catsuit", "unitard", "one-piece", "one piece")):
        return "full"
    if any(k in s for k in ("jeans", "pants", "trousers", "shorts", "skirt", "leggings", "bottom")):
        return "bottom"
    if any(k in s for k in ("t-shirt", "tshirt", "shirt", "blouse", "sweater", "jumper", "hoodie", "cardigan", "jacket", "coat", "vest", "bodysuit", "top")):
        return "top"
    return None

async def _classify_garment_type(image_png: bytes, override: Optional[str] = None) -> str:
    """Classify garment coverage. Returns one of: top|bottom|full.

    Uses in-memory TTL cache keyed by SHA1 of image bytes.
    """
    # Explicit override from client/UI takes precedence
    if override and _normalize_garment_type(override):
        return _normalize_garment_type(override) or "full"
    if not GARMENT_TYPE_CLASSIFY:
        return "full"
    key = _sha1(image_png)
    now = asyncio.get_event_loop().time()
    cached = _garment_type_cache.get(key)
    if cached and cached[0] > now:
        return cached[1]
    instruction = (
        "From the attached garment image, classify coverage for try-on. "
        "Return ONLY one word: top (upper body), bottom (lower body), or full (one piece covering upper+lower like dress/jumpsuit/romper/overalls). "
        "Output: top|bottom|full."
    )
    parts = [
        types.Part.from_text(text=instruction),
        types.Part.from_bytes(data=image_png, mime_type="image/png"),
    ]
    try:
        resp = await _genai_generate_with_retries(parts, attempts=2)
        label_text: Optional[str] = None
        for c in getattr(resp, "candidates", []) or []:
            content = getattr(c, "content", None)
            prts = getattr(content, "parts", None) if content is not None else None
            if not prts:
                continue
            for p in prts:
                if getattr(p, "text", None):
                    label_text = p.text
                    break
            if label_text:
                break
        t = _normalize_garment_type(label_text or "")
        garment_type = t or "full"
    except Exception:
        garment_type = "full"
    # Cache with TTL
    _garment_type_cache[key] = (now + GARMENT_TYPE_TTL_SECONDS, garment_type)
    return garment_type


def _normalize_to_png_limited(raw_bytes: bytes, *, max_px: int = 2048) -> bytes:
    """Decode bytes with PIL, optionally downscale to keep within max_px on longer side,
    and re-encode as PNG. Returns PNG bytes.
    """
    src = Image.open(BytesIO(raw_bytes))
    try:
        src = src.convert("RGBA")
        w, h = src.size
        if max(w, h) > max_px:
            # Preserve aspect ratio; downscale in-place
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


async def _genai_generate_with_retries(parts: list[types.Part], *, attempts: int = 2):
    """Call GenAI with short retries for transient 5xx/429 errors.

    Returns the raw response object.
    """
    last_exc: Exception | None = None
    for i in range(max(1, attempts)):
        try:
            return await asyncio.to_thread(
                get_client().models.generate_content,
                model=MODEL,
                contents=types.Content(role="user", parts=parts),
            )
        except genai_errors.APIError as e:
            last_exc = e
            # Retry on server/internal or quota/too-many-requests
            code = getattr(e, "code", None)
            msg = (getattr(e, "message", "") or "").lower()
            if code in (500, 502, 503) or "internal" in msg or code == 429:
                await asyncio.sleep(0.6 + 0.4 * i)
                continue
            raise
    # After attempts exhausted, re-raise last
    assert last_exc is not None
    raise last_exc


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
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL,
            contents=types.Content(role="user", parts=[types.Part.from_text(text=prompt)]),
        )
        for c in getattr(resp, "candidates", []) or []:
            content = getattr(c, "content", None)
            parts = getattr(content, "parts", None) if content is not None else None
            if not parts:
                continue
            for p in parts:
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


def build_env_prompt(user_prompt: Optional[str] = None) -> str:
    """Build the Studio Environment generation instruction.

    Goals
    - Always a mirror scene. Use the attached source image as the scene seed.
    - Produce a new, photorealistic environment that is coherent with the source reflection.
    - Randomize tastefully while keeping the mirror's size/placement consistent.
    """
    def q(s: Optional[str]) -> str:
        return (s or "").strip()

    lines: list[str] = []
    lines.append("TASK")
    lines.append(
        "Generate a new photorealistic mirror environment image for future garment try-ons. "
        "All scenes are mirror reflections. Use the attached image as a seed reference."
    )
    lines.append("")
    lines.append("HARD CONSTRAINTS")
    lines.append("- No people; no text; no logos or brand marks.")
    lines.append("- Useful as a backdrop: good, even lighting; natural shadows; mild depth of field.")
    lines.append("- Keep an empty, clean mid-ground area in the mirror where a person could plausibly stand.")
    lines.append(
        "- Mirror coherence: preserve the mirror opening size, aspect ratio, and on-image placement; keep the camera viewpoint and reflection geometry plausible."
    )
    lines.append("")
    lines.append("SCENE CONSISTENCY (interior vs exterior)")
    lines.append(
        "- Deduce the scene category and subtype solely from the attached source reflection. Recreate a fresh variant of the SAME subtype (e.g., bedroom → bedroom), or if ambiguous, keep it plausibly neutral while preserving interior vs exterior. Do NOT switch interior ↔ exterior and do NOT invent a different subtype."
    )
    lines.append("")
    lines.append("MIRROR FRAME BEHAVIOR")
    lines.append(
        "- Randomize the mirror frame style (material, color, ornamentation) while keeping the mirror's opening size and aspect ratio IDENTICAL and its on-image position UNCHANGED. Do not scale, stretch, move, or tilt the opening."
    )
    lines.append("")
    lines.append("RANDOMIZATION")
    lines.append("- Vary room subtype, color palette, materials, and tasteful props.")
    lines.append("- Keep background clutter low; avoid busy textures near the mid torso area.")
    lines.append("- Maintain photorealism; avoid stylization.")
    lines.append("")
    if q(user_prompt):
        lines.append("USER WISHES")
        lines.append(f"\"{q(user_prompt)}\"")
        lines.append(
            "Apply ONLY if consistent with photorealism, cleanliness, mirror-reflection setup, and usability as a try-on backdrop. "
            "Do not change the scene category (interior vs exterior) and do not change the mirror size/placement."
        )
        lines.append("")
    lines.append("NEGATIVE GUIDANCE")
    lines.append(
        "cluttered, illegible text, signage, extreme wide-angle distortion, heavy motion blur, horror/abandoned spaces, AI artifacts"
    )
    return "\n".join(lines)


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
    """Build the core prompt (image edit) using conditioned controls and strict constraints.

    - If an environment ref is provided, avoid prescribing a textual environment.
    - Optionally include a short person description when no person image is provided.
    - Mirror-selfie style retained for consistency with the app UI.
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
    lines.append("- Prioritize faithful garment reproduction (shape, fabric, color, print, logos).")
    lines.append("- Natural, flattering person and pose; avoid distortions.")
    lines.append("- Use environment reference if provided; otherwise synthesize the requested environment.")
    lines.append("- Keep results PG-13 (no nudity; no explicit content).")
    lines.append("")
    lines.append("TASK")
    task_parts: list[str] = []
    task_parts.append("You render a photorealistic mirror selfie of a person wearing the provided garment.")
    if use_person_image:
        task_parts.append("Use the attached person reference image; keep identity cues, hair, and overall build consistent (the face may be occluded by the phone).")
    elif person_description:
        task_parts.append("No person image; use the provided person description to guide identity (the face may be occluded by the phone).")
    else:
        task_parts.append("No person reference; synthesize a plausible model matching the selected person.")
    if use_env_image:
        task_parts.append("Use the attached environment reference as a mirror scene; match its lighting, camera angle, color palette, and depth of field.")
    else:
        task_parts.append("No environment reference; synthesize a clean mirror setting consistent with the requested environment.")
    task_parts.append("Keep an amateur smartphone look.")
    lines.append(" ".join(task_parts))
    lines.append("")
    lines.append("REQUIRED OUTPUT")
    lines.append("- One 2D PNG photo, realistic lighting and skin.")
    lines.append("- The garment must be the dominant subject, clearly visible and not occluded.")
    lines.append("")
    lines.append("HARD CONSTRAINTS (must follow)")
    lines.append("1) Garment fidelity: keep exact silhouette, color, fabric texture, print scale/alignment, closures, and logos from the garment image; avoid moiré.")
    lines.append("2) Body realism: natural proportions; hands with five distinct fingers; no merges/extra digits; no warped limbs.")
    lines.append("3) Face realism: plausible expression; no duplicates/melting; preserve identity cues if a person ref is provided.")
    lines.append("4) Clothing fit: believable size and drape; respect gravity and fabric stiffness.")
    lines.append("5) Clean output: no watermarks, no AI artifacts, no text overlays, no added/brand-new logos.")
    lines.append("6) Safety: PG-13; no explicit content.")
    lines.append("7) Mirror selfie: keep a smartphone-in-mirror aesthetic; if the phone occludes the face, do so consistently (with correct reflection) without hiding key garment details.")
    lines.append("8) Garment usage: the person must be wearing the uploaded garment; do not omit or replace it.")
    lines.append("")
    lines.append("CONDITIONED CONTROLS")
    # Show person label instead of gender; omit value when a person image is attached
    lines.append(f"- Person: {conditioned_gender if (conditioned_gender and not use_person_image) else '""'}")
    # Rename Environment to Scene; omit value when an env image is attached (conditioned_env is empty in that case)
    lines.append(f"- Scene: {conditioned_env if conditioned_env else '""'}")
    lines.append(f"- Pose: {conditioned_pose if conditioned_pose else '""'}")
    lines.append(f"- Notes: \"{conditioned_extra.replace('\\n', ' ')}\"")
    lines.append("")
    lines.append("STYLE & CAMERA DIRECTION")
    lines.append("- Smartphone mirror-selfie aesthetic; natural colors; mild grain acceptable.")
    lines.append("- Shot type: 3/4 body by default unless the pose implies otherwise (ensure garment fully visible).")
    lines.append("- Camera: 35–70mm equivalent perspective; natural lens distortion; f/2.8–f/5.6; soft bokeh if indoors.")
    lines.append("- Lighting: match environment reference if given; otherwise soft directional key + gentle fill; mild rim light for separation.")
    lines.append("- Composition: center subject in mirror; show phone and hand; avoid cropping garment edges; keep hands visible when natural.")
    lines.append("")
    lines.append("SCENE BEHAVIOR")
    if use_env_image:
        lines.append("- Use the attached environment reference as a mirror scene; imitate its scene category, palette, light direction, shadows, and depth of field; keep any mirror frame consistent.")
    else:
        lines.append("- No environment reference: synthesize a clean mirror setting that complements the garment; minimal, elegant background; avoid busy textures behind the torso.")
    lines.append("")
    lines.append("PERSON BEHAVIOR")
    if use_person_image:
        lines.append("- Person reference: use the attached image; keep face, hair, skin tone, and general build consistent (face may be partly occluded by phone).")
    else:
        lines.append("- No person reference: synthesize a plausible model; natural expression.")
        if person_description:
            lines.append("- Use a person that matches this description.")
            lines.append(f"- Person description: {person_description}")
    lines.append("- Hand pose: holding a smartphone naturally; fingers look correct; phone and reflection visible.")
    lines.append("")
    lines.append("POSE RENDERING")
    lines.append(f"- Enforce the requested pose: {conditioned_pose if conditioned_pose else '""'}. Make it balanced and anatomically plausible.")
    lines.append("- Ensure the garment remains fully visible and not occluded by the phone or pose; if sitting or lying down, do not let the pose hide key garment areas.")
    lines.append("")
    lines.append("QUALITY CHECK BEFORE OUTPUT")
    lines.append("- Fingers: five per hand; shapes correct; no extra/merged digits.")
    lines.append("- Garment: crisp edges; seams/hemlines visible; prints/logos accurate.")
    lines.append("- Face: no duplicates; no melting; if visible, eyes symmetrical; otherwise occluded by phone.")
    lines.append("- Mirror: phone and reflection consistent; no extra phones; no camera artifacts.")
    lines.append("- Background: clean and coherent; matches env ref if provided.")
    lines.append("")
    lines.append("NEGATIVE GUIDANCE (avoid)")
    lines.append("blurry, over-saturated, HDR halos, duplicated limbs, extra fingers, merged fingers, warped faces, melted textures, text overlays, watermarks, added/brand-new logos, heavy beauty retouching, studio glamour look, ring-light glare, tripod/DSLR look, explicit content, busy background patterns near the torso.")
    lines.append("")
    lines.append("END OF INSTRUCTIONS")

    return "\n".join(lines)


def build_sequential_step1_prompt(*, use_person_image: bool, person_description: Optional[str], pose: str, extra: str) -> str:
    """Step 1: Wear garment on person (no environment changes).

    Explicitly describe whether a person image or only a description is provided.
    """
    def q(s: Optional[str]) -> str:
        return (s or "").strip()
    lines: list[str] = []
    lines.append("TASK")
    if use_person_image:
        lines.append("Use the attached person reference image and the attached garment: put the garment on that person.")
    elif q(person_description):
        lines.append("No person image: synthesize a person matching the provided description and put the garment on them.")
    else:
        lines.append("No person reference: synthesize a plausible person and put the garment on them.")
    lines.append("")
    lines.append("HARD CONSTRAINTS")
    lines.append("- Do not change the person's identity, body, hair, or pose.")
    lines.append("- Do not change or stylize the garment; preserve exact color, fabric, texture, print scale/alignment, logos, closures; ensure believable fit.")
    lines.append("- Do not alter or stylize the background; no added props or phones.")
    if q(pose):
        lines.append(f"- Respect the current pose: {q(pose)}; keep the garment fully visible.")
    if q(extra):
        lines.append(f"- Notes: {q(extra).replace('\n',' ')}")
    if (not use_person_image) and q(person_description):
        lines.append("")
        lines.append("PERSON DESCRIPTION (use this identity)")
        lines.append(q(person_description))
    lines.append("")
    lines.append("OUTPUT")
    lines.append("- One photorealistic PNG of the person now wearing the garment; neutral background unaffected; PG-13; no text/watermarks.")
    return "\n".join(lines)


def build_sequential_step2_prompt(*, environment: str, pose: str, extra: str, use_env_image: bool) -> str:
    """Step 2: Place person-with-garment into mirror scene.

    Explicitly describe whether an environment image is provided.
    """
    def q(s: Optional[str]) -> str:
        return (s or "").strip()
    lines: list[str] = []
    lines.append("TASK")
    if use_env_image:
        lines.append("Insert the person from the attached person image into the attached mirror-scene environment.")
    else:
        lines.append("Insert the person from the attached person image into a synthesized mirror scene consistent with the requested environment.")
    lines.append("")
    lines.append("CONSTRAINTS")
    lines.append("- Do not change the person or clothing at all; keep exact colors, textures, prints, and fit from the person image.")
    lines.append("- Match environment lighting, camera angle, palette, shadows, and depth of field; mirror-coherent geometry.")
    lines.append("- Mirror Selfie style: black iPhone 16 Pro occluding the face but not the garment; realistic hands; no extra phones.")
    if q(pose):
        lines.append(f"- Enforce pose: {q(pose)}; garment remains unobstructed.")
    if q(extra):
        lines.append(f"- Notes: {q(extra).replace('\n',' ')}")
    if not use_env_image and q(environment):
        lines.append(f"- Scene: {q(environment)}")
    lines.append("- Photorealism; PG-13; no text/watermarks or added logos.")
    lines.append("")
    lines.append("OUTPUT")
    lines.append("- One photorealistic PNG mirror selfie.")
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
    garment_type_override: str | None = Form(None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not image or not image.filename:
            return JSONResponse({"error": "image file required"}, status_code=400)
        # Read uploaded image bytes, normalize to PNG and downscale if needed
        raw_bytes = await image.read()
        if len(raw_bytes) > 20 * 1024 * 1024:
            return JSONResponse({"error": "image too large (max ~20MB)"}, status_code=413)
        try:
            png_bytes = _normalize_to_png_limited(raw_bytes, max_px=2048)
        except Exception:
            return JSONResponse({"error": "invalid or unsupported image format"}, status_code=400)

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

        # Classify garment type (with optional override)
        garment_type = await _classify_garment_type(png_bytes, garment_type_override)

        # Build prompt and parts in numbered image order: 1=garment, 2=person (opt), 3=environment (opt)
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
        parts: list[types.Part] = [types.Part.from_text(text=prompt_text)]
        if (not use_person_image) and model_description_text:
            parts.append(types.Part.from_text(text=f"Person description: {model_description_text}"))
        # Image 1: garment (uploaded)
        parts.append(types.Part.from_bytes(data=png_bytes, mime_type="image/png"))
        person_key_used: str | None = None
        env_key_used: str | None = None
        # Image 2: person (optional)
        if model_default_s3_key:
            try:
                person_bytes, person_mime = get_object_bytes(model_default_s3_key)
                parts.append(types.Part.from_bytes(data=person_bytes, mime_type=person_mime or "image/png"))
                person_key_used = model_default_s3_key
            except Exception:
                person_key_used = None
        # Image 3: environment (optional)
        if env_default_s3_key:
            try:
                env_bytes, env_mime = get_object_bytes(env_default_s3_key)
                parts.append(types.Part.from_bytes(data=env_bytes, mime_type=env_mime or "image/png"))
                env_key_used = env_default_s3_key
            except Exception:
                env_key_used = None

        resp = await _genai_generate_with_retries(parts, attempts=2)
        for c in getattr(resp, "candidates", []) or []:
            content = getattr(c, "content", None)
            parts = getattr(content, "parts", None) if content is not None else None
            if not parts:
                continue
            for p in parts:
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
                                "garment_type": garment_type,
                                "garment_type_override": (garment_type_override if garment_type_override else None),
                                "user_id": x_user_id,
                                "prompt_variant": prompt_variant,
                            },
                            model=MODEL,
                        )
                        session.add(rec)
                    # Stream bytes back for current UI
                    return StreamingResponse(BytesIO(png_bytes), media_type="image/png")
        # Fallback to concise variant if no image and no explicit override
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
                parts[0] = types.Part.from_text(text=prompt_text)
                resp2 = await _genai_generate_with_retries(parts, attempts=1)
                for c in getattr(resp2, "candidates", []) or []:
                    content = getattr(c, "content", None)
                    prts = getattr(content, "parts", None) if content is not None else None
                    if not prts:
                        continue
                    for p in prts:
                        if getattr(p, "inline_data", None):
                            png_bytes2 = p.inline_data.data
                            bucket, key = upload_image(png_bytes2, pose=norm_poses[0])
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
        logger.warning(
            "edit: no image from model (candidates=%s, prompt_len=%s, use_env=%s, use_person=%s)",
            cand_count,
            len(prompt_text or ""),
            bool(env_default_s3_key),
            bool(model_default_s3_key),
        )
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

        # Build deterministic instruction to ensure mirror reflection coherence and tasteful randomization
        instruction = build_env_prompt()
        # Load source image bytes from S3 and include as input
        src_bytes, mime = get_object_bytes(row[0])
        image_part = types.Part.from_bytes(data=src_bytes, mime_type=mime)
        resp = await asyncio.to_thread(
            get_client().models.generate_content,
            model=MODEL,
            contents=types.Content(role="user", parts=[types.Part.from_text(text=instruction), image_part]),
        )
        for c in getattr(resp, "candidates", []) or []:
            content = getattr(c, "content", None)
            parts = getattr(content, "parts", None) if content is not None else None
            if not parts:
                continue
            for p in parts:
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
        full = build_env_prompt(prompt)
        # Use a random uploaded source image
        async with db_session() as session:
            stmt = text("SELECT s3_key FROM env_sources ORDER BY RANDOM() LIMIT 1")
            res = await session.execute(stmt)
            row = res.first()
        if not row:
            return JSONResponse({"error": "no sources uploaded"}, status_code=400)
        src_bytes, mime = get_object_bytes(row[0])
        image_part = types.Part.from_bytes(data=src_bytes, mime_type=mime)
        resp = await asyncio.to_thread(
            get_client().models.generate_content,
            model=MODEL,
            contents=types.Content(role="user", parts=[types.Part.from_text(text=full), image_part]),
        )
        for c in getattr(resp, "candidates", []) or []:
            content = getattr(c, "content", None)
            parts = getattr(content, "parts", None) if content is not None else None
            if not parts:
                continue
            for p in parts:
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


def build_model_prompt(gender: str, user_prompt: Optional[str]) -> str:
    """Prompt for generating a reusable person model reference.

    - Uses an attached source person image as the reference.
    - Produce a photorealistic {gender} with the SAME clothing and the SAME background as the source.
    - Vary only identity cues (face/identity), not the outfit or environment.
    """
    def q(s: Optional[str]) -> str:
        return (s or "").strip()

    lines: list[str] = []
    lines.append("TASK")
    lines.append(
        f"Generate a photorealistic {gender} model portrait/full-body for try-on catalogs. "
        "Use the attached person image as the reference: keep the SAME clothing and the SAME background; change only the person identity to a different, plausible {gender}."
    )
    lines.append("")
    lines.append("HARD CONSTRAINTS")
    lines.append("- Natural, friendly expression; neutral makeup (if applicable).")
    lines.append("- Balanced body proportions; realistic hands.")
    lines.append("- Clothing: preserve EXACTLY what the source person wears (same garments, colors, materials, prints, logos if present). Do not alter fit or style.")
    lines.append("- Background/scene: preserve EXACTLY what is in the source (same location, props, lighting, palette, depth of field). Do not replace or restage.")
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


@app.post("/model/generate")
async def model_generate(
    image: UploadFile | None = File(None),
    gender: str = Form("man"),
    prompt: str = Form(""),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        gender = _normalize_gender(gender)
        user_prompt = (prompt or "").strip()

        # Build instruction
        instruction = build_model_prompt(gender, user_prompt if user_prompt else None)
        parts: list[types.Part] = [types.Part.from_text(text=instruction)]

        # Resolve person source image
        src_png_bytes: Optional[bytes] = None
        if image and getattr(image, "filename", None):
            # Read and normalize uploaded image to PNG bytes
            raw_bytes = await image.read()
            if len(raw_bytes) > 10 * 1024 * 1024:
                return JSONResponse({"error": "image too large (max ~10MB)"}, status_code=413)
            src = Image.open(BytesIO(raw_bytes))
            buf = BytesIO()
            src.convert("RGBA").save(buf, format="PNG")
            buf.seek(0)
            src_png_bytes = buf.getvalue()
            # Persist uploaded source for admin library
            try:
                _, src_key = upload_model_source_image(src_png_bytes, gender=gender, mime="image/png")
                async with db_session() as session:
                    session.add(ModelSource(gender=gender, s3_key=src_key))
            except Exception:
                pass
        else:
            # No image provided -> pick the most recently uploaded admin source of this gender
            async with db_session() as session:
                stmt = text("SELECT s3_key FROM model_sources WHERE gender = :g ORDER BY created_at DESC LIMIT 1")
                res = await session.execute(stmt, {"g": gender})
                row = res.first()
            if not row:
                return JSONResponse({"error": f"no model sources uploaded for gender '{gender}'"}, status_code=400)
            src_bytes, src_mime = get_object_bytes(row[0])
            src_png_bytes = src_bytes  # assume stored as PNG; mime guards below

        # Attach source as input
        parts.append(types.Part.from_bytes(data=src_png_bytes, mime_type="image/png"))

        resp = await asyncio.to_thread(
            get_client().models.generate_content,
            model=MODEL,
            contents=types.Content(role="user", parts=parts),
        )
        for c in getattr(resp, "candidates", []) or []:
            content = getattr(c, "content", None)
            cparts = getattr(content, "parts", None) if content is not None else None
            if not cparts:
                continue
            for p in cparts:
                if getattr(p, "inline_data", None):
                    png_bytes = p.inline_data.data
                    bucket, key = upload_image(png_bytes, pose=f"model-{gender}")
                    async with db_session() as session:
                        rec = Generation(
                            s3_key=key,
                            pose=f"model-{gender}",
                            prompt=instruction,
                            options_json={
                                "mode": "model",
                                "gender": gender,
                                "user_prompt": user_prompt,
                                "user_id": x_user_id,
                            },
                            model=MODEL,
                        )
                        session.add(rec)
                    # Follow-up: generate a detailed identity description for this image
                    try:
                        describe_prompt = (
                            "Describe this person precisely for identity reference (plain text, MINIMUM 500 words). "
                            "Focus strictly on identity cues, not clothing or background. Include: perceived gender; approximate age range; height impression; build; posture; skin tone with nuance; undertone; face shape; forehead; hairline; hair color; highlights/lowlights; hair length; hair texture; parting; typical styles; eyebrows (shape, thickness, arch); eyes (color, shape, spacing, eyelids); eyelashes; nose (bridge, tip, width); cheeks; lips (shape, fullness, Cupid's bow); chin; jawline; ears; facial hair (if any, density and shape); teeth and smile; notable features (freckles, moles, scars, dimples, birthmarks); accessories (glasses, earrings, piercings). "
                            "Use neutral, respectful language; avoid judgments; avoid clothing/brand/background mentions; no lists of instructions—write a cohesive, descriptive paragraph or two with at least 500 words."
                        )
                        desc_parts = [
                            types.Part.from_text(text=describe_prompt),
                            types.Part.from_bytes(data=png_bytes, mime_type="image/png"),
                        ]
                        desc_resp = get_client().models.generate_content(
                            model=MODEL,
                            contents=types.Content(role="user", parts=desc_parts),
                        )
                        description_text = None
                        for dc in getattr(desc_resp, "candidates", []) or []:
                            dcontent = getattr(dc, "content", None)
                            dparts = getattr(dcontent, "parts", None) if dcontent is not None else None
                            if dparts:
                                for part in dparts:
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
                    "Analyze this image and output a detailed pose description in plain text (AT LEAST 1000 WORDS, split into 2–4 paragraphs). "
                    "Describe ONLY the person's body pose in a mirror-selfie context. Explicitly state that the subject is taking a mirror selfie with a smartphone; specify which hand holds the phone, where the phone is positioned relative to the face/torso, and how much of the face is occluded by it. "
                    "Include: overall orientation toward the mirror/camera, stance (feet placement and weight distribution), center of gravity, torso rotation and tilt, shoulder alignment and elevation, spine curvature, neck alignment, head orientation/tilt, elbows/forearms/wrists angles, the non-phone hand visibility/gesture and any contact points (e.g., on hip, hanging relaxed), leg bends and knee angles, and approximate distance to the mirror if inferable. "
                    "Do NOT describe clothing, identity, background, brand names, age, or ethnicity. Use neutral anatomical language. Output plain text only."
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


@app.get("/history")
async def list_user_history(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    """List recent garment edit generations for the current user (excludes env/model tools).

    These are images created via POST /edit. Results include presigned URLs.
    """
    try:
        async with db_session() as session:
            if not x_user_id:
                # Do not leak cross-user data; require a user id
                rows = []
            else:
                stmt = (
                    select(Generation.s3_key, Generation.created_at, Generation.pose, Generation.prompt)
                    .where(text("(options_json->>'user_id') = :uid")).params(uid=x_user_id)
                    .where(~Generation.pose.in_(["env"]))
                    .where(~Generation.pose.like("model-%"))
                    .order_by(Generation.created_at.desc())
                    .limit(200)
                )
                res = await session.execute(stmt)
                rows = res.all()
            items = []
            for key, created, pose, prompt in rows:
                try:
                    url = generate_presigned_get_url(key)
                except Exception:
                    url = None
                items.append({
                    "s3_key": key,
                    "created_at": created.isoformat(),
                    "pose": pose,
                    "prompt": prompt,
                    "url": url,
                })
        return {"ok": True, "items": items}
    except Exception as e:
        logger.exception("Failed to list user history")
        return JSONResponse({"error": str(e)}, status_code=500)

# --- Listings (group garment source, settings, generated images, description) ---

@app.post("/listing")
async def create_listing(
    image: UploadFile = File(...),
    gender: str = Form("woman"),
    environment: str = Form("studio"),
    poses: list[str] = Form(None),
    extra: str = Form(""),
    env_default_s3_key: str | None = Form(None),
    model_default_s3_key: str | None = Form(None),
    use_model_image: str | None = Form(None),  # "true" | "false"
    prompt_override: str | None = Form(None),
    title: str | None = Form(None),
    garment_type_override: str | None = Form(None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
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

        # Persist original garment source
        try:
            _, src_key = upload_product_source_image(buf.getvalue(), mime="image/png")
        except Exception as e:
            return JSONResponse({"error": f"failed to persist source image: {e}"}, status_code=500)

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
        }
    except Exception as e:
        logger.exception("failed to create listing")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/listings")
async def list_listings(x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        async with db_session() as session:
            # Fetch recent listings for user
            lres = await session.execute(
                text(
                    "SELECT id, created_at, cover_s3_key, settings_json FROM listings "
                    "WHERE user_id = :uid ORDER BY created_at DESC LIMIT 200"
                ),
                {"uid": x_user_id},
            )
            rows = lres.all()
            # Get counts per listing in a second query
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
                for lid, cnt in cres.all():
                    counts[str(lid)] = int(cnt)
        items = []
        for lid, created_at, cover_key, settings_json in rows:
            try:
                cover_url = generate_presigned_get_url(cover_key) if cover_key else None
            except Exception:
                cover_url = None
            items.append(
                {
                    "id": lid,
                    "created_at": created_at.isoformat(),
                    "cover_s3_key": cover_key,
                    "cover_url": cover_url,
                    "images_count": counts.get(str(lid), 0),
                    "settings": settings_json or {},
                }
            )
        return {"ok": True, "items": items}
    except Exception as e:
        logger.exception("failed to list listings")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/listing/{lid}")
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
            # Fetch images
            ires = await session.execute(
                text(
                    "SELECT s3_key, pose, prompt, created_at FROM listing_images "
                    "WHERE listing_id = :id ORDER BY created_at DESC"
                ),
                {"id": lid},
            )
            irows = ires.all()
        # Build response
        try:
            source_url = generate_presigned_get_url(lrow[2]) if lrow[2] else None
        except Exception:
            source_url = None
        try:
            cover_url = generate_presigned_get_url(lrow[5]) if lrow[5] else None
        except Exception:
            cover_url = None
        images = []
        for s3_key, pose, prompt, created_at in irows:
            try:
                url = generate_presigned_get_url(s3_key)
            except Exception:
                url = None
            images.append(
                {
                    "s3_key": s3_key,
                    "pose": pose,
                    "prompt": prompt,
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
    except Exception as e:
        logger.exception("failed to get listing")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.patch("/listing/{lid}/cover")
async def set_listing_cover(lid: str, s3_key: str = Form(...), x_user_id: str | None = Header(default=None, alias="X-User-Id")):
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        # Verify listing ownership and that the image belongs to this listing
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
    except Exception as e:
        logger.exception("failed to set listing cover")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/edit/json")
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
    """Same as /edit but returns JSON and optionally attaches to a listing."""
    try:
        # Load source image bytes either from uploaded file or from listing source
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
            # Fetch listing and ensure ownership, then load its stored source image from S3
            async with db_session() as session:
                owns = await session.execute(
                    text("SELECT user_id, source_s3_key FROM listings WHERE id = :id"),
                    {"id": listing_id},
                )
                row = owns.first()
            if not row or row[0] != x_user_id:
                return JSONResponse({"error": "not found"}, status_code=404)
            try:
                src_bytes, src_mime = get_object_bytes(row[1])
                # Normalize to PNG and downscale for consistency and stability
                src_png = _normalize_to_png_limited(src_bytes, max_px=2048)
            except Exception as e:
                return JSONResponse({"error": f"failed to load source image from listing: {e}"}, status_code=500)
        else:
            return JSONResponse({"error": "image file or listing_id required"}, status_code=400)

        # Normalize some fields
        gender = _normalize_choice(gender, ["woman", "man"], "woman")
        environment = _normalize_choice(environment, ["studio", "street", "bed", "beach", "indoor"], "studio")
        if not poses:
            poses = []
        if not isinstance(poses, list):
            poses = [poses]
        # Keep first pose string for metadata; do not hard-normalize names here
        pose_str = (poses[0] if poses else "") or ""
        extra = (extra or "").strip()
        if len(extra) > 200:
            extra = extra[:200]

        # Determine garment type
        garment_type = await _classify_garment_type(src_png, garment_type_override)

        # Build parts and call model
        use_env_image = bool(env_default_s3_key)
        use_person_image = bool(model_default_s3_key)
        # Build prompt and parts in numbered image order: 1=garment, 2=person (opt), 3=environment (opt)
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
        parts: list[types.Part] = [types.Part.from_text(text=prompt_text)]
        if (not use_person_image) and model_description_text:
            parts.append(types.Part.from_text(text=f"Person description: {model_description_text}"))
        # Image 1: garment
        parts.append(types.Part.from_bytes(data=src_png, mime_type="image/png"))
        env_key_used: str | None = None
        person_key_used: str | None = None
        # Image 2: person (opt)
        if model_default_s3_key:
            try:
                person_bytes, person_mime = get_object_bytes(model_default_s3_key)
                parts.append(types.Part.from_bytes(data=person_bytes, mime_type=person_mime or "image/png"))
                person_key_used = model_default_s3_key
            except Exception:
                person_key_used = None
        # Image 3: environment (opt)
        if env_default_s3_key:
            try:
                env_bytes, env_mime = get_object_bytes(env_default_s3_key)
                parts.append(types.Part.from_bytes(data=env_bytes, mime_type=env_mime or "image/png"))
                env_key_used = env_default_s3_key
            except Exception:
                env_key_used = None

        resp = await _genai_generate_with_retries(parts, attempts=2)
        for c in getattr(resp, "candidates", []) or []:
            content = getattr(c, "content", None)
            cparts = getattr(content, "parts", None) if content is not None else None
            if not cparts:
                continue
            for p in cparts:
                if getattr(p, "inline_data", None):
                    png_bytes = p.inline_data.data
                    # Upload and persist generation
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
                        # Attach to listing if provided and owned by user
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
                                # Set cover if not set yet
                                await session.execute(
                                    text("UPDATE listings SET cover_s3_key = COALESCE(cover_s3_key, :k) WHERE id = :id"),
                                    {"k": key, "id": listing_id},
                                )
                                # Update listing settings with garment type and origin
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
        # Fallback to concise prompt if no image and no explicit override
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
                parts[0] = types.Part.from_text(text=prompt_text)
                resp2 = await _genai_generate_with_retries(parts, attempts=1)
                for c in getattr(resp2, "candidates", []) or []:
                    content = getattr(c, "content", None)
                    cparts = getattr(content, "parts", None) if content is not None else None
                    if not cparts:
                        continue
                    for p in cparts:
                        if getattr(p, "inline_data", None):
                            png_bytes = p.inline_data.data
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
                                # Attach to listing if provided and owned by user
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
                                        # Update listing settings with garment type and origin
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
                                        # Set cover if not set yet
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
                                "prompt": prompt_text,
                                "listing_id": listing_id,
                            }
            except Exception:
                pass
        return JSONResponse({"error": "no edited image from model"}, status_code=502)
    except genai_errors.APIError as e:
        logger.exception("GenAI API error on /edit/json")
        return JSONResponse({"error": e.message, "code": e.code}, status_code=502)
    except Exception as e:
        logger.exception("Unhandled error on /edit/json")
        return JSONResponse({"error": str(e)}, status_code=500)
    except Exception as e:
        logger.exception("Failed to list user history")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/edit/sequential/json")
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
    """Two-pass generation: (1) put garment on person; (2) place into scene.

    Mirrors /edit/json inputs for drop-in replacement. Persists only final image.
    """
    try:
        # Load source (garment) image
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
            except Exception as e:
                return JSONResponse({"error": f"failed to load source image from listing: {e}"}, status_code=500)
        else:
            return JSONResponse({"error": "image file or listing_id required"}, status_code=400)

        # Normalize inputs
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
        # Classify garment type for metadata and potential conditioning (currently used in stored options)
        garment_type = await _classify_garment_type(src_png, garment_type_override)

        # Step 1 prompt
        if prompt_override_step1 and prompt_override_step1.strip():
            step1_prompt = prompt_override_step1.strip()
            step1_variant = "override"
        else:
            step1_prompt = seq_step1_detailed(
                use_person_image=use_person_image,
                pose=pose_str,
                person_description=(model_description_text if (model_description_text and not use_person_image) else None),
                gender=_normalize_choice(gender, ["woman", "man"], "woman"),
            )
            step1_variant = "detailed"
        parts1: list[types.Part] = [types.Part.from_text(text=step1_prompt)]
        person_key_used: str | None = None
        if model_default_s3_key:
            try:
                person_bytes, person_mime = get_object_bytes(model_default_s3_key)
                parts1.append(types.Part.from_text(text="Person reference:"))
                parts1.append(types.Part.from_bytes(data=person_bytes, mime_type=person_mime or "image/png"))
                person_key_used = model_default_s3_key
            except Exception:
                person_key_used = None
        elif model_description_text:
            parts1.append(types.Part.from_text(text=f"Person description: {model_description_text}"))
            person_key_used = None
        # Garment last
        parts1.append(types.Part.from_bytes(data=src_png, mime_type="image/png"))

        # Call step 1
        resp1 = await _genai_generate_with_retries(parts1, attempts=2)
        step1_png: bytes | None = None
        for c in getattr(resp1, "candidates", []) or []:
            content = getattr(c, "content", None)
            prts = getattr(content, "parts", None) if content is not None else None
            if not prts:
                continue
            for p in prts:
                if getattr(p, "inline_data", None):
                    step1_png = p.inline_data.data
                    break
            if step1_png:
                break
        if not step1_png:
            if not (prompt_override_step1 and prompt_override_step1.strip()):
                try:
                    step1_variant = "concise"
                    step1_prompt = seq_step1_concise(
                        use_person_image=use_person_image,
                        pose=pose_str,
                        person_description=(model_description_text if (model_description_text and not use_person_image) else None),
                        gender=_normalize_choice(gender, ["woman", "man"], "woman"),
                    )
                    parts1[0] = types.Part.from_text(text=step1_prompt)
                    resp1b = await _genai_generate_with_retries(parts1, attempts=1)
                    for c in getattr(resp1b, "candidates", []) or []:
                        content = getattr(c, "content", None)
                        prts = getattr(content, "parts", None) if content is not None else None
                        if not prts:
                            continue
                        for p in prts:
                            if getattr(p, "inline_data", None):
                                step1_png = p.inline_data.data
                                break
                        if step1_png:
                            break
                except Exception:
                    step1_png = None
            if not step1_png:
                return JSONResponse({"error": "no image from model (step1)"}, status_code=502)

        # Step 2 prompt
        if prompt_override_step2 and prompt_override_step2.strip():
            step2_prompt = prompt_override_step2.strip()
            step2_variant = "override"
        else:
            step2_prompt = seq_step2_detailed(
                use_env_image=use_env_image,
                environment=_normalize_choice(environment, ["studio", "street", "bed", "beach", "indoor"], "studio"),
                pose=pose_str,
            )
            step2_variant = "detailed"
        parts2: list[types.Part] = [types.Part.from_text(text=step2_prompt)]
        env_key_used: str | None = None
        person_key_used: str | None = None
        if env_default_s3_key:
            try:
                env_bytes, env_mime = get_object_bytes(env_default_s3_key)
                parts2.append(types.Part.from_text(text="Environment reference:"))
                parts2.append(types.Part.from_bytes(data=env_bytes, mime_type=env_mime or "image/png"))
                env_key_used = env_default_s3_key
            except Exception:
                env_key_used = None
        # Person reference is the step-1 result
        parts2.append(types.Part.from_text(text="Person reference:"))
        parts2.append(types.Part.from_bytes(data=step1_png, mime_type="image/png"))

        resp2 = await _genai_generate_with_retries(parts2, attempts=2)
        for c in getattr(resp2, "candidates", []) or []:
            content = getattr(c, "content", None)
            prts = getattr(content, "parts", None) if content is not None else None
            if not prts:
                continue
            for p in prts:
                if getattr(p, "inline_data", None):
                    final_png = p.inline_data.data
                    # Persist final
                    # A/B: suffix pose with (seq) so UI can distinguish without schema changes
                    pose_final = (pose_str or "pose").strip() or "pose"
                    pose_final = f"{pose_final} (seq)"
                    bucket, key = upload_image(final_png, pose=pose_final)
                    async with db_session() as session:
                        session.add(
                            Generation(
                                s3_key=key,
                                pose=pose_final,
                                prompt=step2_prompt,
                                options_json={
                                    "flow": "sequential",
                                    "prompt_step1": step1_prompt,
                                    "prompt_step2": step2_prompt,
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
                                        pose=pose_final,
                                        prompt=step2_prompt,
                                    )
                                )
                                await session.execute(
                                    text("UPDATE listings SET cover_s3_key = COALESCE(cover_s3_key, :k) WHERE id = :id"),
                                    {"k": key, "id": listing_id},
                                )
                                # Update listing settings with garment type and origin
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
                    return {"ok": True, "s3_key": key, "url": url, "pose": pose_final, "prompt": step2_prompt, "listing_id": listing_id}
        if not (prompt_override_step2 and prompt_override_step2.strip()):
            try:
                step2_variant = "concise"
                step2_prompt = seq_step2_concise(
                    use_env_image=use_env_image,
                    environment=_normalize_choice(environment, ["studio", "street", "bed", "beach", "indoor"], "studio"),
                    pose=pose_str,
                )
                parts2[0] = types.Part.from_text(text=step2_prompt)
                resp2b = await _genai_generate_with_retries(parts2, attempts=1)
                for c in getattr(resp2b, "candidates", []) or []:
                    content = getattr(c, "content", None)
                    prts = getattr(content, "parts", None) if content is not None else None
                    if not prts:
                        continue
                    for p in prts:
                        if getattr(p, "inline_data", None):
                            final_png = p.inline_data.data
                            # Persist final
                            pose_final = (pose_str or "pose").strip() or "pose"
                            pose_final = f"{pose_final} (seq)"
                            bucket, key = upload_image(final_png, pose=pose_final)
                            async with db_session() as session:
                                session.add(
                                    Generation(
                                        s3_key=key,
                                        pose=pose_final,
                                        prompt=step2_prompt,
                                        options_json={
                                            "flow": "sequential",
                                            "prompt_step1": step1_prompt,
                                            "prompt_step2": step2_prompt,
                                            "prompt_step1_variant": step1_variant,
                                            "prompt_step2_variant": step2_variant,
                                            "gender": gender,
                                            "environment": environment,
                                            "poses": poses,
                                            "extra": extra,
                                            "env_default_s3_key": env_key_used,
                                            "model_default_s3_key": person_key_used,
                                            "model_description_text": (model_description_text if not person_key_used else None),
                                            "user_id": x_user_id,
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
                                                pose=pose_final,
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
                            return {"ok": True, "s3_key": key, "url": url, "pose": pose_final, "prompt": step2_prompt, "listing_id": listing_id}
            except Exception:
                pass
        return JSONResponse({"error": "no image from model (step2)"}, status_code=502)
    except genai_errors.APIError as e:
        logger.exception("GenAI API error on /edit/sequential/json")
        return JSONResponse({"error": e.message, "code": e.code}, status_code=502)
    except Exception as e:
        logger.exception("Unhandled error on /edit/sequential/json")
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


# --- Product description generation (Vinted-style) ---

@app.post("/describe")
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
    """Generate a Vinted-style product description from an uploaded garment image and metadata."""
    try:
        if not image or not image.filename:
            return JSONResponse({"error": "image file required"}, status_code=400)
        # Normalize image
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

        # Optional: persist original garment source for traceability
        try:
            _, src_key = upload_product_source_image(buf.getvalue(), mime="image/png")
        except Exception:
            src_key = None

        # Build instruction (Gemini 2.5 Flash Image)
        def norm(s: Optional[str]) -> str:
            return (s or "").strip()

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

        # Prefer explicit prompt_override from the client; else build a default instruction
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

        parts: list[types.Part] = [
            types.Part.from_text(text=instruction),
            types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png"),
        ]
        client = get_client()
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL,
            contents=types.Content(role="user", parts=parts),
        )
        description_text = None
        for c in getattr(resp, "candidates", []) or []:
            content = getattr(c, "content", None)
            parts = getattr(content, "parts", None) if content is not None else None
            if parts:
                for p in parts:
                    if getattr(p, "text", None):
                        description_text = p.text
                        break
            if description_text:
                break
        if not description_text:
            return JSONResponse({"error": "no description from model"}, status_code=502)

        # Persist description
        async with db_session() as session:
            session.add(
                ProductDescription(
                    user_id=x_user_id,
                    s3_key=src_key or "",
                    gender=_normalize_gender(gender) if gender else None,
                    brand=norm(brand) or None,
                    model=norm(model_name) or None,
                    size=norm(size) or None,
                    condition=norm(condition) or None,
                    description=description_text.strip(),
                )
            )
            # If listing_id provided and owned by the user, store description on listing too
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
    except Exception as e:
        logger.exception("description generation failed")
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Prompt preview (server-authoritative for front-end preview) ---

@app.post("/prompt/mirror-selfie/preview")
async def preview_mirror_selfie_prompt(
    gender: str = Form("woman"),
    environment: str = Form("studio"),
    pose: str = Form(""),
    extra: str = Form(""),
    env_default_s3_key: str | None = Form(None),
    model_default_s3_key: str | None = Form(None),
    model_description_text: str | None = Form(None),
):
    try:
        use_env_image = bool(env_default_s3_key)
        use_person_image = bool(model_default_s3_key)
        prompt_text = build_mirror_selfie_prompt(
            gender=gender,
            environment=environment,
            pose=pose,
            extra=extra,
            use_env_image=use_env_image,
            use_person_image=use_person_image,
            person_description=(model_description_text if (model_description_text and not use_person_image) else None),
        )
        return {"ok": True, "prompt": prompt_text}
    except Exception as e:
        logger.exception("prompt preview failed")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/listing/{lid}/describe")
async def describe_from_listing(
    lid: str,
    gender: str | None = Form(None),
    brand: str | None = Form(None),
    model_name: str | None = Form(None),
    size: str | None = Form(None),
    condition: str | None = Form(None),
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
):
    """Generate a Vinted-style product description using the listing's stored source image.

    Accepts optional fields (gender, brand, model_name, size, condition). Requires ownership.
    """
    try:
        if not x_user_id:
            return JSONResponse({"error": "missing user id"}, status_code=400)
        # Fetch listing and verify ownership
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

        # Load source image from S3
        try:
            src_bytes, mime = get_object_bytes(src_key)
        except Exception as e:
            return JSONResponse({"error": f"failed to load source image: {e}"}, status_code=500)

        def norm(s: Optional[str]) -> str:
            return (s or "").strip()

        # Merge provided fields with listing settings for gender default
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

        parts: list[types.Part] = [
            types.Part.from_text(text=instruction),
            types.Part.from_bytes(data=src_bytes, mime_type=mime or "image/png"),
        ]
        client = get_client()
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=MODEL,
            contents=types.Content(role="user", parts=parts),
        )
        description_text = None
        for c in getattr(resp, "candidates", []) or []:
            content = getattr(c, "content", None)
            p = getattr(content, "parts", None) if content is not None else None
            if p:
                for part in p:
                    if getattr(part, "text", None):
                        description_text = part.text
                        break
            if description_text:
                break
        if not description_text:
            return JSONResponse({"error": "no description from model"}, status_code=502)

        # Persist to ProductDescription and Listing
        async with db_session() as session:
            session.add(
                ProductDescription(
                    user_id=x_user_id,
                    s3_key=src_key or "",
                    gender=_normalize_gender(gg) if gg else None,
                    brand=norm(brand) or None,
                    model=norm(model_name) or None,
                    size=norm(size) or None,
                    condition=norm(condition) or None,
                    description=description_text.strip(),
                )
            )
            await session.execute(text("UPDATE listings SET description_text = :d WHERE id = :id"), {"d": description_text.strip(), "id": lid})

        return {"ok": True, "description": description_text}
    except Exception as e:
        logger.exception("description from listing failed")
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
