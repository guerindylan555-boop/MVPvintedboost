"""FastAPI application entrypoint."""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import CORS_ALLOW_ORIGINS, LOGGER, POLAR_OAT, POLAR_WEBHOOK_SECRET, REDIS_URL
from backend.core.redis import close_redis_client, get_redis_client, redis_asyncio
from backend.db import init_db
from backend.routes import router as api_router
from backend.services.polar import close_polar_client

app = FastAPI(title="VintedBoost Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)


@app.on_event("startup")
async def on_startup() -> None:
    try:
        await init_db()
        LOGGER.info("DB initialized")
    except Exception:
        LOGGER.exception("Failed to initialize DB (startup)")
        raise
    if not POLAR_OAT:
        LOGGER.warning("POLAR_OAT not configured; billing endpoints disabled")
    if not POLAR_WEBHOOK_SECRET:
        LOGGER.warning("POLAR_WEBHOOK_SECRET not configured; webhook verification disabled")
    if REDIS_URL and redis_asyncio is not None:
        try:
            client = await get_redis_client()
            if client is not None:
                LOGGER.info("Redis client ready")
        except Exception:
            LOGGER.exception("Redis startup check failed")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await close_redis_client()
    await close_polar_client()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
