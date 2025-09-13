## VintedBoost MVP

Mobile‑first Next.js frontend + FastAPI backend to upload a clothing photo and generate an image of the clothing worn by a person, powered by Google Gemini (google‑genai). Includes Dockerfiles, Dokploy deployment guidance, Postgres for metadata, and S3 for storing generated images.

### Tech stack
- Frontend: Next.js App Router (Tailwind v4 via `@tailwindcss/postcss`), mobile‑first UI
- Backend: FastAPI (Python), Google Gen AI SDK (`google-genai`), Pillow, async SQLAlchemy
- Storage: AWS S3 (boto3) for generated PNGs
- Database: Postgres (async SQLAlchemy)
- Auth: Better Auth (cookie sessions) with Google OAuth, Postgres adapter
- Deployment: Dokploy with Dockerfiles for frontend and backend

### Features
- Upload clothing image (tap or drag‑and‑drop)
- Options panel:
  - gender: woman/man
  - environment: studio/street/bed/beach/indoor (when Studio defaults exist, shows their names instead)
  - poses: select up to 3 (Face, three-quarter pose, from the side, random). Random uses a saved pose description from Studio; one is pre-picked on page load for the prompt preview and appended at generation time as “Pose description: …”
  - extra: free text instructions
- model reference toggle: choose the gender default as image, or send its description only
- Prompt preview/editor: live view of the exact prompt; optionally override before generating
- Generate button (sticky). Sends:
  - the uploaded garment image (always)
  - the selected environment default image (optional)
  - the selected gender model default image (optional)
  Backend builds one prompt and includes all references for the model
- History gallery (localStorage) of generated images with quick preview

Default generation style (Mirror Selfie for Vinted)
- Photorealistic mirror selfie, amateur smartphone look
- Person holds a black iPhone 16 Pro; phone occludes the face (with correct reflection) without hiding key garment details
- The person must be wearing the uploaded garment; strict garment fidelity (shape, color, fabric, prints, logos)

### Studio (Environments, Models & Poses)
- Environment tab:
  - Bulk upload environment source images (stored in S3 and tracked in Postgres)
  - Random: picks a random uploaded source and generates with strict instruction “randomize the scene and the mirror frame”
  - Generate: same instruction, plus user prompt appended
  - Recent generated environments grid (last 200, per-user), images loaded via S3 presigned URLs for speed
  - Defaults management inside the grid (per-user): select up to 5 generated images, name/rename, mark as default, and Undefault; defaults are highlighted and are not selectable
  - Delete any generated environment image (removes from S3 and DB, and from defaults if set)
  - List and delete all uploaded sources (S3 + DB) from the UI
- Model tab:
  - Gender selector placed above Prompt
  - Source image uploader/viewer is admin-only; non-admins won’t see the pickers
  - Random: uses the selected gender’s source image and the prompt “Randomize this man/woman.”
  - Generate: same, with your additional prompt appended
  - After generation, the resulting image is re‑sent to the model to generate a detailed description of the person (especially the face). The text is stored and shown as an overlay in the grid
  - Two grids (last 200 each, per-user): “Recent generated models — Men” and “— Women”, each with its own single default. You can Set default, Rename default, or Undefault per gender
  - Person source images are uploaded to S3 and tracked in Postgres
  - Main page can send the model default as an image or description only (toggle)
- Pose tab:
  - Admin-only UI: bulk upload pose images and generate pose‑only descriptions
  - Lists uploaded pose sources and the resulting descriptions (admin-only UI)
  - Saved pose descriptions are used globally by the main page (any user’s random pose can use them)

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
  - `POST /edit` (primary): accepts clothing image + options; may also include environment and person reference images; prompts Gemini and returns a PNG
    - Also accepts `model_description_text` (description-only model reference) and `prompt_override` (frontend sends exact prompt)
  - `POST /generate`: text‑only generation (basic test)
  - `GET /health`: health probe
  - `POST /env/sources/upload`: bulk upload environment sources (S3 + DB)
  - `GET /env/sources`: list uploaded sources; `DELETE /env/sources`: delete all (S3 + DB)
  - `POST /env/random`: pick random source and generate with strict instruction
  - `POST /env/generate`: same instruction + user prompt
- `GET /env/generated`: list recent environment generations for the current user (requires header `X-User-Id`; includes presigned `url`)
  - `GET /env/image?s3_key=...`: stream any stored image from S3
- `GET /env/defaults`: list env defaults for the current user (requires header `X-User-Id`; includes presigned `url`)
- `POST /env/defaults`: set up to 5 named defaults (per-user overwrite; requires `X-User-Id`)
- `PATCH /env/defaults`: rename a default by `s3_key` (requires `X-User-Id`)
- `DELETE /env/defaults`: unset a default by `s3_key`
  - `DELETE /env/generated`: delete a generated env image (also unsets default if used)
  - `POST /model/generate`: person model generation; accepts a person source image and optional user prompt; returns PNG; saves result; also auto‑generates and stores a textual person description for the image
  - `GET /model/generated`: list recent model generations (includes `gender`, presigned `url`, and `description`)
  - `GET /model/defaults`: list model defaults (one per gender; includes `description`)
  - `POST /model/defaults`: set default for a gender (overwrites)
  - `PATCH /model/defaults`: rename default for a gender
  - `DELETE /model/defaults`: unset default for a gender
- `backend/db.py`: async SQLAlchemy setup, `Generation` model, `init_db()` at startup
  - `EnvSource`, `EnvDefault`, `ModelDefault`, `ModelSource`, `ModelDescription`, `PoseSource`, `PoseDescription` models
- `backend/storage.py`: S3 client and upload helpers
  - `generate_presigned_get_url(...)` for fast grid loads
- `upload_model_source_image(...)` for persisting person sources
- `upload_pose_source_image(...)` for persisting pose sources

### Model and SDK
- Model: `gemini-2.5-flash-image-preview` (aka Nano Banana)
- SDK: `google-genai`
- We assemble `types.Content(role="user", parts=[text, image])` using:
  - `types.Part.from_text(text=prompt)`
  - `types.Part.from_bytes(data=png_bytes, mime_type="image/png")`
- Images are returned via `inline_data`; we stream back PNG bytes to the client

### Prompting strategy
- The frontend sends structured fields (gender, environment, poses[], extra) and may include environment/person reference images
- The backend builds a deterministic "Mirror Selfie for Vinted" prompt, or uses a `prompt_override` from the UI when provided
- Multiple poses: the frontend fires one parallel `/edit` request per pose (up to 3)

Prompt rules (Mirror Selfie for Vinted)
- Always a mirror selfie, amateur smartphone look
- Black iPhone 16 Pro held in front of the face (occluding it with correct reflection) while keeping the garment clearly visible
- The model must be wearing the uploaded garment; preserve exact silhouette, color, fabric, print scale/alignment, closures, and logos
- If an environment default image is attached: treat it as the mirror scene reference (match lighting, angle, palette, shadows, DoF) and avoid conflicting textual descriptions
- If a model default image is attached: preserve identity cues (hair/build) and omit textual identity description. If using description‑only: include the stored identity description under PERSON BEHAVIOR
- Pose handling on main page:
  - Face: front-facing mirror view; squared shoulders; phone centered. Adds a short pose description to the prompt.
  - three-quarter pose: three-quarter view toward the mirror; torso angled; weight slightly on one leg. Adds a short pose description.
  - from the side: profile toward the mirror; ensure torso and garment remain visible. Adds a short pose description.
  - random: pulls one saved pose description from Studio at generation time and appends it as “Pose description: …”. A random pick is also selected on page load for the prompt preview.
- Safety/quality constraints are always included (hands anatomy, face realism, no explicit content, no text/watermarks). The pose must not occlude the garment.

### Database and S3 side‑effects
- On successful generation, backend:
  - Uploads the PNG to S3 at `generated/YYYY/MM/DD/<uuid>-<pose>.png`
  - Inserts a `generations` row with: `s3_key`, `pose`, `prompt`, `options_json`, `model`, `created_at`
- Table is created automatically on app startup (simple `create_all`; migrations can be added later)
- Environment sources are stored under `env_sources/` and tracked in `env_sources` table
- Named defaults stored in `env_defaults` table (up to 5)
- Model person sources stored under `model_sources/<gender>/` and tracked in `model_sources`
- Model defaults stored in `model_defaults` (one per gender)
- Model person descriptions stored in `model_descriptions` and linked by `s3_key`

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
  - Sends `multipart/form-data` to `/edit` with fields: `image`, `gender` (woman|man), `environment`, repeated `poses`, and `extra`
  - When available, also sends `env_default_s3_key` (selected Studio environment default) and `model_default_s3_key` (selected gender’s model default)
  - When multiple poses are selected, fires parallel requests (one per pose)
  - History persists generated images in localStorage (max 12)

### Authentication (Better Auth + Google)
- Better Auth is mounted at `app/api/auth/[[...all]]/route.js` using the Next.js integration; a base route `app/api/auth/route.js` returns a simple JSON for health checks.
- Server auth instance lives in `app/lib/auth.js` and uses a Postgres `pg` Pool. It normalizes Python‑style URLs like `postgresql+psycopg2://...` to `postgres://...` automatically.
- Google provider is auto‑enabled when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
- Sessions are cookie‑based. A small `customSession` plugin adds `user.isAdmin` based on an email/domain allowlist.
- Studio/admin gating:
  - `app/studio/layout.js` performs a server‑side `auth.api.getSession()` check and redirects to `/login` if the user is not an admin.
  - `app/login/page.js` starts Google sign‑in using the Better Auth client (`signIn.social`).
- Admin BFF (server proxy) routes under `app/api/admin/*` enforce the session and forward to FastAPI with `Authorization: Bearer <ADMIN_BEARER_TOKEN>`:
  - Env: `GET/POST/PATCH/DELETE /api/admin/env/defaults`, `GET/DELETE /api/admin/env/generated`, `GET/DELETE /api/admin/env/sources`, `POST /api/admin/env/sources/upload`
  - Model: `GET/POST/PATCH/DELETE /api/admin/model/defaults`
  - Pose: `GET /api/admin/pose/sources`, `POST /api/admin/pose/describe`, `GET /api/admin/pose/descriptions`

#### Access control & visibility
- Global auth gating is implemented in `middleware.ts` (cookie‑based), not in `layout.js`, to avoid redirect loops behind proxies.
- Public routes: `/login`, `/api/*`, `/studio`, Next assets (`/_next/*`, `favicon*`, `/assets/*`). All other pages (including `/`) require a session and will redirect to `/login`.
- Studio admin‑only UI: bulk upload controls and the raw sources list are only visible to admins (`user.isAdmin === true`).
- Random generation uses admin‑uploaded sources for everyone; non‑admins benefit without seeing the sources or having any edit/delete access.

### Frontend environment variables (including auth)
```env
# Backend base URL for the app UI
NEXT_PUBLIC_API_BASE_URL=https://api.<your-domain>

# Better Auth core
BETTER_AUTH_URL=https://<your-frontend-domain>         # e.g., https://ab-digital.store
BETTER_AUTH_SECRET=<random-long-string>
BETTER_AUTH_DATABASE_URL=postgres://user:pass@host:5432/db
# Python-style URLs are accepted too and auto-normalized:
# BETTER_AUTH_DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/db

# Google OAuth (Web application in Google Cloud Console)
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxxxxxx

# Admin gating (allowlist) and server-to-server auth to FastAPI
ADMIN_ALLOWED_EMAILS=you@your.co,teammate@org.com        # optional
ADMIN_ALLOWED_DOMAIN=your.co                             # optional
ADMIN_BEARER_TOKEN=<shared-with-backend>
```

### Google OAuth configuration (Console)
- Authorized JavaScript origins:
  - Dev: `http://localhost:3000`
  - Prod: `https://<your-frontend-domain>`
- Authorized redirect URIs:
  - Dev: `http://localhost:3000/api/auth/callback/google`
  - Prod: `https://<your-frontend-domain>/api/auth/callback/google`

### Useful auth endpoints for verification
- `GET /api/auth` → health JSON
- `GET /api/auth/get-session` → current session JSON (null until login)
- `POST /api/auth/sign-in/social` with form body `{ provider: "google", callbackURL: "/studio" }` → starts Google flow (the Login page uses this via Better Auth client)

### Notes on migrations & routing
- Better Auth runs its DB migrations lazily on the first `/api/auth/*` request to avoid extra work during normal page renders.
- Only one catch‑all auth route is used: `[[...all]]` (optional). Do not create a sibling `[...all]` at the same path, or Next.js will throw a route conflict.
 - Global access control is enforced by `middleware.ts`. If you need to expose additional public paths, add them to the middleware allowlist.

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
- Environment:
  - `NEXT_PUBLIC_API_BASE_URL=https://api.<your-domain>`
  - `BETTER_AUTH_URL=https://<your-frontend-domain>`
  - `BETTER_AUTH_SECRET=<random-long-string>`
  - `BETTER_AUTH_DATABASE_URL=postgres://user:pass@internal-host:5432/db`
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `ADMIN_BEARER_TOKEN`
  - `ADMIN_ALLOWED_EMAILS` and/or `ADMIN_ALLOWED_DOMAIN`

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
- `gender` (woman|man, optional)
  - `environment` (studio|street|bed|beach|indoor, optional)
  - `poses` (repeated; standing|sitting|lying down|walking; UI sends one per request)
  - `extra` (string, optional)
- `env_default_s3_key` (string, optional) — environment reference image
- `model_default_s3_key` (string, optional) — person reference image (gender default)
- Response: `image/png` stream
- Errors: 400 invalid input; 413 image too large; 502 upstream / no image

### POST /generate
- Content-Type: `application/x-www-form-urlencoded`
- Fields: `prompt`
- Response: `image/png` stream

### POST /model/generate
- Content-Type: `multipart/form-data`
- Fields: `image` (file), `gender` (man|woman), `prompt` (optional)
- Response: `image/png` stream
- Notes: Automatically generates and stores a person description linked to the image

### GET /model/generated
- Response: `{ ok: true, items: [{ s3_key, created_at, gender, url, description }] }`

### Model defaults
- `GET /model/defaults`
- `POST /model/defaults` (form: `gender`, `s3_key`, `name`)
- `PATCH /model/defaults` (form: `gender`, `name`)
- `DELETE /model/defaults?gender=...`

### GET /health
- Response: `{ ok: true, model: string }`

## Troubleshooting
- TLS warning on backend domain: ensure HTTPS enabled and DNS A record points to Dokploy server; wait for Let’s Encrypt
- 401/403: invalid/missing `GOOGLE_API_KEY`
- 400 with pydantic `extra_forbidden`: ensure we use typed `Content`/`Part` (already done)
- 500/502: check backend logs. If model returns no image, try simpler prompt or different options
- CORS: set `CORS_ALLOW_ORIGINS` to your frontend origin exactly (no trailing slash)
- Auth 404 at `/api/auth/...`: ensure the path is `app/api/auth/[[...all]]/route.js` (optional catch‑all) and that `better-auth/next-js` is used, not `better-auth/integrations/next-js`.
- Auth 500 at `/api/auth/...`: verify DB env vars are present on the frontend service and the DB host is resolvable from the container; also set `BETTER_AUTH_URL`.
- Google redirects back to `/login`: confirm cookies are set (HTTPS, correct domain), your email is allowlisted, and Google Console redirect URI matches exactly.
- Redirect loop on `/login`: ensure global gating happens via `middleware.ts` (cookie presence) and not inside `layout.js`; verify `/login` is listed as a public path in the middleware allowlist.

## Roadmap
- Persist request IDs and latency; expose `/history` endpoint using DB
- Return JSON with presigned S3 URLs for images (optional new endpoint)
- Add Alembic migrations instead of `create_all`
- Basic auth for admin endpoints
