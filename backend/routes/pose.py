"""Pose source and description endpoints."""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import select, text

from backend.config import LOGGER
from backend.db import PoseDescription, PoseSource, db_session
from backend.storage import delete_objects, upload_pose_source_image
from backend.tasks import enqueue_pose_descriptions

router = APIRouter()


@router.post("/pose/sources/upload")
async def upload_pose_sources(files: list[UploadFile] = File(...)):
    try:
        stored = []
        for upload in files:
            data = await upload.read()
            _, key = upload_pose_source_image(data, mime=upload.content_type)
            async with db_session() as session:
                session.add(PoseSource(s3_key=key))
            stored.append({"s3_key": key})
        return {"ok": True, "count": len(stored), "items": stored}
    except Exception as exc:
        LOGGER.exception("Failed to upload pose sources")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/pose/sources")
async def list_pose_sources():
    try:
        async with db_session() as session:
            stmt = select(PoseSource.s3_key).order_by(PoseSource.created_at.desc())
            res = await session.execute(stmt)
            items = [row[0] for row in res.all()]
        return {"ok": True, "items": items}
    except Exception as exc:
        LOGGER.exception("Failed to list pose sources")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.delete("/pose/sources")
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
    except Exception as exc:
        LOGGER.exception("Failed to delete pose sources")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.post("/pose/describe")
async def generate_pose_descriptions():
    try:
        async with db_session() as session:
            src_rows = await session.execute(select(PoseSource.s3_key).order_by(PoseSource.created_at.desc()))
            src_keys = [row[0] for row in src_rows.all()]
            if not src_keys:
                return {"ok": True, "generated": 0}
            have_rows = await session.execute(select(PoseDescription.s3_key))
            have = {row[0] for row in have_rows.all()}
        todo = [key for key in src_keys if key not in have]
        if not todo:
            return {"ok": True, "generated": 0}

        outcome = enqueue_pose_descriptions(todo, wait=True)
        results = outcome.get("results", [])
        generated = sum(1 for item in results if isinstance(item, dict) and item.get("ok"))
        payload = {"ok": True, "generated": generated, "queued": len(todo)}
        if outcome.get("job_id"):
            payload["job_id"] = outcome["job_id"]
        if outcome.get("inline"):
            payload["inline"] = True
        if outcome.get("fallback"):
            payload["fallback"] = True
        return payload
    except Exception as exc:
        LOGGER.exception("Failed to generate pose descriptions")
        return JSONResponse({"error": str(exc)}, status_code=500)


@router.get("/pose/descriptions")
async def list_pose_descriptions():
    try:
        async with db_session() as session:
            stmt = select(
                PoseDescription.s3_key,
                PoseDescription.description,
                PoseDescription.created_at,
            ).order_by(PoseDescription.created_at.desc())
            res = await session.execute(stmt)
            items = [
                {"s3_key": key, "description": desc, "created_at": created.isoformat()}
                for key, desc, created in res.all()
            ]
        return {"ok": True, "items": items}
    except Exception as exc:
        LOGGER.exception("Failed to list pose descriptions")
        return JSONResponse({"error": str(exc)}, status_code=500)
