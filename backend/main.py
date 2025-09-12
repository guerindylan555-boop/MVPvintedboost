import os
from io import BytesIO
from typing import Optional

from fastapi import FastAPI, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from PIL import Image
from google import genai

# Config
MODEL = os.getenv("GENAI_MODEL", "gemini-2.5-flash-image-preview")
API_KEY = os.getenv("GOOGLE_API_KEY", "")

app = FastAPI(title="VintedBoost Backend", version="0.1.0")

# CORS - allow local Next.js dev and same-origin deployments
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost",
    "*",  # Relaxed for MVP; lock down in production
]
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
    client = get_client()
    resp = client.models.generate_content(model=MODEL, contents=[prompt])
    for c in resp.candidates:
        for p in c.content.parts:
            if getattr(p, "inline_data", None):
                img_bytes = BytesIO(p.inline_data.data)
                return StreamingResponse(img_bytes, media_type="image/png")
    return JSONResponse({"error": "no image"}, status_code=500)


@app.post("/edit")
async def edit(
    prompt: str = Form("i want this clothe on someone"),
    image: UploadFile = Form(...),
):
    # Read uploaded image and normalize to PNG bytes
    src = Image.open(BytesIO(await image.read()))
    buf = BytesIO()
    src.convert("RGBA").save(buf, format="PNG")
    buf.seek(0)

    contents = [
        prompt,
        {"mime_type": "image/png", "data": buf.getvalue()},
    ]
    client = get_client()
    resp = client.models.generate_content(model=MODEL, contents=contents)
    for c in resp.candidates:
        for p in c.content.parts:
            if getattr(p, "inline_data", None):
                return StreamingResponse(BytesIO(p.inline_data.data), media_type="image/png")
    return JSONResponse({"error": "no edited image"}, status_code=500)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
