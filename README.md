## VintedBoost MVP

Mobile‑first Next.js frontend + FastAPI backend to upload a clothing photo and generate an image of the clothing worn by a person, powered by Google Gemini (google‑genai). Includes Dockerfiles, Dokploy deployment guidance, Postgres for metadata, and S3 for storing generated images.

### Tech stack
- Frontend: Next.js App Router (Tailwind v4 via `@tailwindcss/postcss`), mobile‑first UI
- Backend: FastAPI (Python), Google Gen AI SDK (`google-genai`), Pillow, async SQLAlchemy
- Storage: AWS S3 (boto3) for generated PNGs
- Database: Postgres (async SQLAlchemy)
- Deployment: Dokploy with Dockerfiles for frontend and backend

### Features
- Upload clothing image (tap or drag‑and‑drop)
- Options panel:
  - gender: woman/man/unisex
  - environment: studio/street/bed/beach/indoor
  - poses: select up to 3 poses; parallel generation per pose
  - extra: free text instructions
- Generate button (sticky). Sends structured fields; backend builds prompt and generates with the image
- History gallery (localStorage) of generated images with quick preview

### Studio (Environments & Models)
- Environment tab:
  - Bulk upload environment source images (stored in S3 and tracked in Postgres)
  - Random: picks a random uploaded source and generates with strict instruction “randomize the scene and the mirror frame”
  - Generate: same instruction, plus user prompt appended
  - Recent generated environments grid (last 200), streamed from backend via `/env/image`
  - Select up to 5 generated images, name them, and save as defaults via `/env/defaults`
  - List and delete all uploaded sources (S3 + DB) from the UI
- Model tab:
  - Text‑only generation (preview), with placeholders to upload male/female source images (for future use)

## Local development

### Prerequisites
- Node.js 18+ (LTS recommended)
- Python 3.12+
- A Google Gemini API key (Developer API)

### Install and run
```bash
# Node deps
npm install

# Python deps
python3 -m venv .venv
./.venv/bin/pip install -r backend/requirements.txt

# Backend (requires GOOGLE_API_KEY)
export GOOGLE_API_KEY="<your-gemini-api-key>"
npm run api        # runs uvicorn backend on :8000

# Frontend (uses NEXT_PUBLIC_API_BASE_URL)
export NEXT_PUBLIC_API_BASE_URL="http://localhost:8000"
npm run dev        # runs Next.js on :3000
```
Alternative: run both with one command (uses `concurrently`):
```bash
npm run dev:full
```

## Backend

### Key files
- `backend/main.py`: FastAPI app with endpoints
  - `POST /edit` (primary): accepts clothing image + options; prompts Gemini and returns a PNG
  - `POST /generate`: text‑only generation (basic test)
  - `GET /health`: health probe
  - `POST /env/sources/upload`: bulk upload environment sources (S3 + DB)
  - `GET /env/sources`: list uploaded sources; `DELETE /env/sources`: delete all (S3 + DB)
  - `POST /env/random`: pick random source and generate with strict instruction
  - `POST /env/generate`: same instruction + user prompt
  - `GET /env/generated`: list recent environment generations (S3 keys)
  - `GET /env/image?s3_key=...`: stream any stored image from S3
  - `GET /env/defaults`, `POST /env/defaults`: manage up to 5 named defaults
- `backend/db.py`: async SQLAlchemy setup, `Generation` model, `init_db()` at startup
- `EnvSource` model for uploaded environment sources
- `EnvDefault` model for named default environments
- `backend/storage.py`: S3 client and upload helpers

### Model and SDK
- Model: `gemini-2.5-flash-image-preview` (aka Nano Banana)
- SDK: `google-genai`
- We assemble `types.Content(role="user", parts=[text, image])` using:
  - `types.Part.from_text(text=prompt)`
  - `types.Part.from_bytes(data=png_bytes, mime_type="image/png")`
- Images are returned via `inline_data`; we stream back PNG bytes to the client

### Prompting strategy
- The frontend only sends structured fields (gender, environment, poses[], extra)
- The backend normalizes/sanitizes and builds one deterministic prompt per request:
  - "Put this clothing item on a realistic person model. Gender: … Environment: … Poses: … Extra … Realistic fit, high‑quality fashion photo, natural lighting."
- Multiple poses: the frontend fires one parallel `/edit` request per pose (up to 3)

### Database and S3 side‑effects
- On successful generation, backend:
  - Uploads the PNG to S3 at `generated/YYYY/MM/DD/<uuid>-<pose>.png`
  - Inserts a `generations` row with: `s3_key`, `pose`, `prompt`, `options_json`, `model`, `created_at`
- Table is created automatically on app startup (simple `create_all`; migrations can be added later)
- Environment sources are stored under `env_sources/` and tracked in `env_sources` table
- Named defaults stored in `env_defaults` table (up to 5)

### Backend environment variables
Required (Dokploy → Backend → Environment):
```env
GOOGLE_API_KEY=<your-gemini-api-key>
CORS_ALLOW_ORIGINS=https://<your-frontend-domain>  # e.g., https://ab-digital.store

# Postgres (use your Dokploy internal service name)
DATABASE_URL=postgresql+psycopg2://<db_user>:<db_password>@<postgres-internal-host>:5432/<db_name>

# AWS S3
AWS_ACCESS_KEY_ID=<aws-access-key>
AWS_SECRET_ACCESS_KEY=<aws-secret>
AWS_REGION=<aws-region>
AWS_S3_BUCKET=<bucket-name>
```

## Frontend

### Key file
- `app/page.js`:
  - Upload UI, options panel, and sticky Generate button
  - Sends `multipart/form-data` to `/edit` with fields: `image`, `gender`, `environment`, repeated `poses`, and `extra`
  - When multiple poses are selected, fires parallel requests (one per pose)
  - History persists generated images in localStorage (max 12)

### Frontend environment variables
```env
NEXT_PUBLIC_API_BASE_URL=https://<your-backend-domain>  # e.g., https://api.<your-domain>
```

## Docker & Dokploy

### Dockerfiles
- `Dockerfile` (root): Next.js production build and runtime (Node 22‑alpine)
  - Accepts `NEXT_PUBLIC_API_BASE_URL` as ARG/ENV
- `backend/Dockerfile`: Python 3.12 slim running uvicorn

### Dokploy: Backend app
- Provider: GitHub; Build Type: Dockerfile
  - Docker File: `backend/Dockerfile`
  - Docker Context: `.`
- Domain: `api.<your-domain>`; Container Port: 8000; HTTPS: On
- Environment: set all Backend env vars (above)
- Watch Paths: `backend/**`

### Dokploy: Frontend app
- Provider: GitHub; Build Type: Dockerfile (root `Dockerfile`)
- Domain: `<your-domain>`; Container Port: 3000; HTTPS: On
- Environment: `NEXT_PUBLIC_API_BASE_URL=https://api.<your-domain>`

### Postgres on Dokploy (simple)
- App: image `postgres:16-alpine`
- Volume: mount `/var/lib/postgresql/data`
- Env: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Do not expose publicly; use internal host in `DATABASE_URL`

## API reference (short)

### POST /edit
- Content-Type: `multipart/form-data`
- Fields:
  - `image` (file, required)
  - `gender` (woman|man|unisex, optional)
  - `environment` (studio|street|bed|beach|indoor, optional)
  - `poses` (repeated; standing|sitting|lying down|walking; UI sends one per request)
  - `extra` (string, optional)
- Response: `image/png` stream
- Errors: 400 invalid input; 413 image too large; 502 upstream / no image

### POST /generate
- Content-Type: `application/x-www-form-urlencoded`
- Fields: `prompt`
- Response: `image/png` stream

### GET /health
- Response: `{ ok: true, model: string }`

## Troubleshooting
- TLS warning on backend domain: ensure HTTPS enabled and DNS A record points to Dokploy server; wait for Let’s Encrypt
- 401/403: invalid/missing `GOOGLE_API_KEY`
- 400 with pydantic `extra_forbidden`: ensure we use typed `Content`/`Part` (already done)
- 500/502: check backend logs. If model returns no image, try simpler prompt or different options
- CORS: set `CORS_ALLOW_ORIGINS` to your frontend origin exactly (no trailing slash)

## Roadmap
- Persist request IDs and latency; expose `/history` endpoint using DB
- Return JSON with presigned S3 URLs for images (optional new endpoint)
- Add Alembic migrations instead of `create_all`
- Basic auth for admin endpoints
