"""Shared helpers for edit endpoints."""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Iterable, Sequence

from fastapi import UploadFile
from PIL import Image
from sqlalchemy import text

from backend.db import Generation, ListingImage, db_session
from backend.storage import get_object_bytes
from backend.utils.normalization import normalize_choice


class EditingError(Exception):
    """Exception raised when edit helper operations fail."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class NormalizedInputs:
    """Normalized edit inputs shared by classic and sequential flows."""

    gender: str
    environment: str
    poses: list[str]
    primary_pose: str
    extra: str


@dataclass(slots=True)
class ListingContext:
    """Resolved listing context for ownership checks and persistence."""

    id: str
    user_id: str
    source_s3_key: str


@dataclass(slots=True)
class SourceImage:
    """Loaded garment source information."""

    png_bytes: bytes
    origin: str
    listing: ListingContext | None


def normalize_to_png_limited(raw_bytes: bytes, *, max_px: int = 2048) -> bytes:
    """Normalize arbitrary image bytes to PNG with an optional max dimension."""

    try:
        src = Image.open(BytesIO(raw_bytes))
    except Exception as exc:  # pragma: no cover - Pillow provides detailed errors
        raise EditingError("invalid or unsupported image format", status_code=400) from exc
    try:
        src = src.convert("RGBA")
        width, height = src.size
        if max(width, height) > max_px:
            scale = max_px / float(max(width, height))
            new_size = (int(width * scale), int(height * scale))
            src = src.resize(new_size, Image.LANCZOS)
        out = BytesIO()
        src.save(out, format="PNG")
        out.seek(0)
        return out.getvalue()
    finally:
        try:
            src.close()
        except Exception:  # pragma: no cover - defensive cleanup
            pass


def normalize_edit_inputs(
    gender: str,
    environment: str,
    poses: Sequence[str] | str | None,
    extra: str | None,
    *,
    default_pose: str | None = None,
    max_poses: int = 3,
) -> NormalizedInputs:
    """Normalize user supplied options for both edit flows."""

    gender_norm = normalize_choice(gender, ["woman", "man"], "woman")
    environment_norm = normalize_choice(
        environment,
        ["studio", "street", "bed", "beach", "indoor"],
        "studio",
    )

    pose_iterable: Iterable[str]
    if poses is None:
        pose_iterable = []
    elif isinstance(poses, str):
        pose_iterable = [poses]
    else:
        pose_iterable = poses

    allowed_poses = ["standing", "sitting", "lying down", "walking"]
    normalized_poses: list[str] = []
    for pose in pose_iterable:
        pose_norm = normalize_choice(pose, allowed_poses, "")
        if pose_norm and pose_norm not in normalized_poses:
            normalized_poses.append(pose_norm)
        if len(normalized_poses) >= max_poses:
            break

    if not normalized_poses and default_pose:
        normalized_poses = [default_pose]

    primary_pose = normalized_poses[0] if normalized_poses else (default_pose or "")

    extra_clean = (extra or "").strip()
    if len(extra_clean) > 200:
        extra_clean = extra_clean[:200]

    return NormalizedInputs(
        gender=gender_norm,
        environment=environment_norm,
        poses=normalized_poses,
        primary_pose=primary_pose,
        extra=extra_clean,
    )


async def resolve_listing_context(
    listing_id: str | None,
    user_id: str | None,
    *,
    required: bool,
) -> ListingContext | None:
    """Resolve listing ownership for the requesting user."""

    if not listing_id:
        if required:
            raise EditingError("image file or listing_id required", status_code=400)
        return None
    if not user_id:
        if required:
            raise EditingError("not found", status_code=404)
        return None

    async with db_session() as session:
        result = await session.execute(
            text("SELECT user_id, source_s3_key FROM listings WHERE id = :id"),
            {"id": listing_id},
        )
        row = result.first()

    if not row or row[0] != user_id:
        if required:
            raise EditingError("not found", status_code=404)
        return None

    return ListingContext(id=listing_id, user_id=row[0], source_s3_key=row[1])


async def load_garment_source(
    image: UploadFile | None,
    listing: ListingContext | None,
    *,
    max_upload_bytes: int = 20 * 1024 * 1024,
    max_px: int = 2048,
) -> SourceImage:
    """Load garment source data from an upload or listing."""

    if image and image.filename:
        raw_bytes = await image.read()
        if len(raw_bytes) > max_upload_bytes:
            raise EditingError("image too large (max ~20MB)", status_code=413)
        try:
            png_bytes = normalize_to_png_limited(raw_bytes, max_px=max_px)
        except EditingError:
            raise
        return SourceImage(png_bytes=png_bytes, origin="upload", listing=listing)

    if not listing:
        raise EditingError("image file or listing_id required", status_code=400)

    try:
        listing_bytes, _ = get_object_bytes(listing.source_s3_key)
        png_bytes = normalize_to_png_limited(listing_bytes, max_px=max_px)
    except EditingError as exc:
        raise EditingError(
            f"failed to load source image from listing: {exc.message}", status_code=500
        ) from exc
    except Exception as exc:  # pragma: no cover - storage errors are environment specific
        raise EditingError(
            f"failed to load source image from listing: {exc}", status_code=500
        ) from exc

    return SourceImage(png_bytes=png_bytes, origin="listing", listing=listing)


async def persist_generation_result(
    *,
    s3_key: str,
    pose: str,
    prompt: str,
    options: dict,
    model_name: str,
    listing: ListingContext | None = None,
    update_listing_settings: bool = False,
    garment_type: str | None = None,
    garment_type_override: str | None = None,
) -> None:
    """Persist generation metadata and optional listing attachments."""

    async with db_session() as session:
        session.add(
            Generation(
                s3_key=s3_key,
                pose=pose,
                prompt=prompt,
                options_json=options,
                model=model_name,
            )
        )

        if not listing:
            return

        session.add(
            ListingImage(
                listing_id=listing.id,
                s3_key=s3_key,
                pose=pose,
                prompt=prompt,
            )
        )
        await session.execute(
            text("UPDATE listings SET cover_s3_key = COALESCE(cover_s3_key, :k) WHERE id = :id"),
            {"k": s3_key, "id": listing.id},
        )

        if update_listing_settings and garment_type:
            try:
                result = await session.execute(
                    text("SELECT settings_json FROM listings WHERE id = :id"),
                    {"id": listing.id},
                )
                row = result.first()
                settings = (row[0] or {}) if row else {}
                origin = (
                    "user"
                    if garment_type_override and garment_type_override.strip()
                    else "model"
                )
                settings.update(
                    {
                        "garment_type": garment_type,
                        "garment_type_origin": origin,
                    }
                )
                await session.execute(
                    text("UPDATE listings SET settings_json = :j WHERE id = :id"),
                    {"j": settings, "id": listing.id},
                )
            except Exception:  # pragma: no cover - best-effort update
                pass
