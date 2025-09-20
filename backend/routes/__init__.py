"""Route modules for the FastAPI backend."""
from fastapi import APIRouter

from . import admin, billing, description, edit, environment, listing, model, pose, usage


router = APIRouter()
router.include_router(admin.router)
router.include_router(billing.router)
router.include_router(environment.router)
router.include_router(model.router)
router.include_router(pose.router)
router.include_router(listing.router)
router.include_router(edit.router)
router.include_router(description.router)
router.include_router(usage.router)
