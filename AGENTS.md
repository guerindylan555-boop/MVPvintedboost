# Repository Guidelines

## Project Structure & Modules
- `app/` — Next.js App Router UI (pages: `page.js`, `login/`, `studio/`), server routes under `app/api/*`, shared helpers in `app/lib/*`.
- `backend/` — FastAPI service (`main.py` endpoints, `db.py` for Postgres, `storage.py` for S3).
- `public/` — static assets; `middleware.ts` — auth gating and public-path allowlist.
- Docker: root `Dockerfile` (frontend), `backend/Dockerfile` (API). Config: `eslint.config.mjs`, `next.config.mjs`, `postcss.config.mjs`.

## Build, Test, and Dev Commands
- `npm install` — install web deps.
- Python env: `python3 -m venv .venv && ./.venv/bin/pip install -r backend/requirements.txt`.
- `npm run dev` — Next.js on :3000. Set `NEXT_PUBLIC_API_BASE_URL`.
- `npm run api` — FastAPI via uvicorn on :8000 (uses `./.venv`). Requires `GOOGLE_API_KEY` and DB/S3 envs.
- `npm run dev:full` — run frontend and backend together.
- `npm run build` / `npm start` — production build/serve.
- `npm run lint` — ESLint (Next core-web-vitals).

## Coding Style & Naming
- JavaScript/React: follow ESLint defaults; 2-space indent; prefer named exports in `app/lib/*`; route files use `route.js`, pages use `page.js`, layouts `layout.js`.
- Tailwind v4 via PostCSS; keep utility classes readable (group by layout → spacing → colors).
- Python: PEP8 (4 spaces), async style in FastAPI; keep IO (S3/DB) in `storage.py`/`db.py`, request handlers in `main.py`.
- Filenames: lowercase with dashes or directory conventions used by Next (no PascalCase pages/components in `app/`).

## Testing Guidelines
- No formal test suite yet. For additions:
  - Frontend: Vitest + React Testing Library (`*.test.tsx|jsx`) colocated next to components or under `app/__tests__/`.
  - Backend: pytest; name `tests/test_*.py`; include fast API route tests using `TestClient` and stub S3/model calls.
- Aim for smoke coverage of critical flows: auth middleware, `/edit`, Studio admin routes.

## Commit & Pull Requests
- Commits: imperative, concise; optional scope prefix: `backend:`, `studio:`, `auth:`, `env:`. Examples: `backend: handle empty model response`, `studio: persist active tab`.
- PRs must include: purpose summary, linked issues, screenshots/GIFs for UI, env/migration notes, and test plan (steps/commands).
- CI gate (manual): ensure `npm run lint` passes and both apps boot locally before request.

## Security & Configuration
- Never commit secrets. Use `.env.local` (frontend) and service env vars (backend). Keys: `GOOGLE_API_KEY`, `NEXT_PUBLIC_API_BASE_URL`, Postgres `DATABASE_URL`, AWS `AWS_*`, `ADMIN_BEARER_TOKEN`.
- When exposing new public pages or APIs, update `middleware.ts` allowlist and CORS (`CORS_ALLOW_ORIGINS`).
- S3 paths follow `generated/YYYY/MM/DD/<uuid>-<pose>.png`; prefer server-generated keys.

