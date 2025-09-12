import os
import uuid
from datetime import datetime
from typing import Tuple

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
        ACL="private",
    )
    return AWS_S3_BUCKET, key
