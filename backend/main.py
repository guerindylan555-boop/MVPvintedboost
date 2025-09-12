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
    poses: list[str] = Form(default_factory=list),
    extra: str = Form("")
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
        gender = _normalize_choice(gender, ["woman", "man", "unisex"], "woman")
        environment = _normalize_choice(environment, ["studio", "street", "bed", "beach", "indoor"], "studio")
        # Normalize poses array (multi-select). Accept up to 3 unique values
        allowed_poses = ["standing", "sitting", "lying down", "walking"]
        if not isinstance(poses, list):
            poses = [poses] if poses else []
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
        prompt_text = _build_prompt(gender=gender, environment=environment, poses=norm_poses, extra=extra)

        image_part = types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png")
        contents = types.Content(role="user", parts=[types.Part.from_text(text=prompt_text), image_part])
        client = get_client()
        resp = client.models.generate_content(
            model=MODEL,
            contents=contents,
        )
        for c in getattr(resp, "candidates", []) or []:
            for p in getattr(c, "content", {}).parts or []:
                if getattr(p, "inline_data", None):
                    return StreamingResponse(BytesIO(p.inline_data.data), media_type="image/png")
        return JSONResponse({"error": "no edited image from model"}, status_code=502)
    except genai_errors.APIError as e:
        logger.exception("GenAI API error on /edit")
        return JSONResponse({"error": e.message, "code": e.code}, status_code=502)
    except Exception as e:
        logger.exception("Unhandled error on /edit")
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
