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
            config=types.GenerateContentConfig(
                response_mime_type="image/png",
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


@app.post("/edit")
async def edit(
    prompt: str = Form("i want this clothe on someone"),
    image: UploadFile = File(...),
):
    try:
        if not image or not image.filename:
            return JSONResponse({"error": "image file required"}, status_code=400)
        # Read uploaded image and normalize to PNG bytes
        src = Image.open(BytesIO(await image.read()))
        buf = BytesIO()
        src.convert("RGBA").save(buf, format="PNG")
        buf.seek(0)

        image_part = types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png")
        contents = types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=prompt),
                image_part,
            ],
        )
        client = get_client()
        resp = client.models.generate_content(
            model=MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="image/png",
            ),
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
