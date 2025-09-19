import os
import uuid
from datetime import datetime
from typing import Tuple, Optional, List

import boto3

AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_S3_BUCKET = os.getenv("AWS_S3_BUCKET")

_s3 = None

def get_s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3", region_name=AWS_REGION)
    return _s3


def generate_s3_key(pose: str, ext: str = "png") -> str:
    today = datetime.utcnow()
    key = f"generated/{today.year:04d}/{today.month:02d}/{today.day:02d}/{uuid.uuid4().hex}-{pose}.{ext}"
    return key


def upload_image(png_bytes: bytes, pose: str) -> Tuple[str, str]:
    """Uploads image bytes as PNG to S3 and returns (bucket, key)."""
    if not AWS_S3_BUCKET:
        raise RuntimeError("AWS_S3_BUCKET not configured")
    key = generate_s3_key(pose, "png")
    get_s3().put_object(
        Bucket=AWS_S3_BUCKET,
        Key=key,
        Body=png_bytes,
        ContentType="image/png",
        CacheControl="public, max-age=31536000, immutable",
        ACL="private",
    )
    return AWS_S3_BUCKET, key


def _upload_bytes(
    prefix: str,
    bytes_data: bytes,
    mime: Optional[str],
    *,
    extra_parts: tuple[str, ...] = (),
) -> Tuple[str, str]:
    if not AWS_S3_BUCKET:
        raise RuntimeError("AWS_S3_BUCKET not configured")
    ext = "png" if (mime == "image/png") else "jpg"
    today = datetime.utcnow()
    cleaned_parts = [prefix.strip("/")]
    cleaned_parts.extend(part.strip("/") for part in extra_parts if part)
    cleaned_parts.append(f"{today.year:04d}")
    cleaned_parts.append(f"{uuid.uuid4().hex}.{ext}")
    key = "/".join(cleaned_parts)
    get_s3().put_object(
        Bucket=AWS_S3_BUCKET,
        Key=key,
        Body=bytes_data,
        ContentType=mime or "application/octet-stream",
        CacheControl="public, max-age=31536000, immutable",
        ACL="private",
    )
    return AWS_S3_BUCKET, key


def upload_source_image(bytes_data: bytes, mime: Optional[str] = None) -> Tuple[str, str]:
    """Uploads an original source image (any type) into S3 under env_sources/ and returns (bucket, key)."""
    return _upload_bytes("env_sources", bytes_data, mime)


def upload_pose_source_image(bytes_data: bytes, mime: Optional[str] = None) -> Tuple[str, str]:
    """Uploads a pose source image to S3 under pose_sources/ and returns (bucket, key)."""
    return _upload_bytes("pose_sources", bytes_data, mime)


def upload_model_source_image(bytes_data: bytes, gender: str, mime: Optional[str] = None) -> Tuple[str, str]:
    """Uploads a model source image to S3 under model_sources/<gender>/ and returns (bucket, key)."""
    return _upload_bytes("model_sources", bytes_data, mime, extra_parts=(gender,))


def get_object_bytes(key: str) -> Tuple[bytes, str]:
    if not AWS_S3_BUCKET:
        raise RuntimeError("AWS_S3_BUCKET not configured")
    resp = get_s3().get_object(Bucket=AWS_S3_BUCKET, Key=key)
    data = resp["Body"].read()
    content_type = resp.get("ContentType", "application/octet-stream")
    return data, content_type


def upload_product_source_image(bytes_data: bytes, mime: Optional[str] = None) -> Tuple[str, str]:
    """Uploads a garment/product source image to S3 under product_sources/ and returns (bucket, key)."""
    return _upload_bytes("product_sources", bytes_data, mime)


def delete_objects(keys: List[str]) -> None:
    if not keys:
        return
    if not AWS_S3_BUCKET:
        raise RuntimeError("AWS_S3_BUCKET not configured")
    # Batch delete in chunks of 1000 (S3 API limit)
    for i in range(0, len(keys), 1000):
        chunk = keys[i : i + 1000]
        get_s3().delete_objects(
            Bucket=AWS_S3_BUCKET,
            Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True},
        )


def generate_presigned_get_url(key: str, expires_in: int = 3600) -> str:
    """Create a time-limited presigned URL to download an S3 object.

    This avoids proxying image bytes through our backend for every grid tile, reducing latency.
    """
    if not AWS_S3_BUCKET:
        raise RuntimeError("AWS_S3_BUCKET not configured")
    return get_s3().generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": AWS_S3_BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )
