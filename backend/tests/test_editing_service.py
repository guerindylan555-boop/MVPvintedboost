from __future__ import annotations

from contextlib import asynccontextmanager
from io import BytesIO
import unittest
from unittest.mock import patch

from fastapi import UploadFile
from PIL import Image

from backend.db import Generation, ListingImage
from backend.services.editing import (
    EditingError,
    ListingContext,
    load_garment_source,
    normalize_edit_inputs,
    persist_generation_result,
    resolve_listing_context,
)


def _png_bytes(color: str = "red") -> bytes:
    buf = BytesIO()
    Image.new("RGB", (10, 10), color=color).save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()


class FakeResult:
    def __init__(self, rows: list[tuple]):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None


class FakeSession:
    def __init__(self, rows: list[tuple] | None = None, settings: dict | None = None):
        self.rows = rows or []
        self.settings = settings
        self.added: list = []
        self.executed: list[tuple[str, dict | None]] = []

    async def execute(self, stmt, params=None):
        text = getattr(stmt, "text", str(stmt))
        self.executed.append((text, params))
        if "SELECT settings_json" in text:
            return FakeResult([(self.settings or {},)])
        if "SELECT" in text:
            return FakeResult(self.rows)
        return FakeResult([])

    def add(self, obj) -> None:
        self.added.append(obj)


class EditingServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_normalize_edit_inputs_classic_defaults(self):
        inputs = normalize_edit_inputs(
            gender="Woman",
            environment="Street",
            poses=["sitting", "walking", "sitting"],
            extra="  something extra  ",
            default_pose="standing",
        )
        self.assertEqual(inputs.gender, "woman")
        self.assertEqual(inputs.environment, "street")
        self.assertEqual(inputs.poses, ["sitting", "walking"])
        self.assertEqual(inputs.primary_pose, "sitting")
        self.assertEqual(inputs.extra, "something extra")

    async def test_normalize_edit_inputs_sequential_defaults(self):
        inputs = normalize_edit_inputs(
            gender="unknown",
            environment="?",
            poses=None,
            extra=None,
            default_pose=None,
        )
        self.assertEqual(inputs.gender, "woman")
        self.assertEqual(inputs.environment, "studio")
        self.assertEqual(inputs.poses, [])
        self.assertEqual(inputs.primary_pose, "")
        self.assertEqual(inputs.extra, "")

    async def test_load_garment_source_from_upload(self):
        upload = UploadFile(filename="src.jpg", file=BytesIO(_png_bytes()))
        result = await load_garment_source(upload, None)
        self.assertEqual(result.origin, "upload")
        self.assertIsNone(result.listing)
        self.assertTrue(result.png_bytes.startswith(b"\x89PNG"))

    async def test_load_garment_source_from_listing(self):
        listing = ListingContext(id="listing", user_id="u1", source_s3_key="s3")
        with patch("backend.services.editing.get_object_bytes", return_value=(_png_bytes(), "image/png")):
            result = await load_garment_source(None, listing)
        self.assertEqual(result.origin, "listing")
        self.assertEqual(result.listing, listing)

    async def test_load_garment_source_requires_input(self):
        with self.assertRaises(EditingError) as ctx:
            await load_garment_source(None, None)
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_resolve_listing_context_success(self):
        fake_session = FakeSession(rows=[("user-1", "s3-key")])

        @asynccontextmanager
        async def fake_db_session():
            yield fake_session

        with patch("backend.services.editing.db_session", fake_db_session):
            ctx = await resolve_listing_context("listing-1", "user-1", required=True)
        self.assertIsNotNone(ctx)
        self.assertEqual(ctx.source_s3_key, "s3-key")

    async def test_resolve_listing_context_optional(self):
        fake_session = FakeSession(rows=[])

        @asynccontextmanager
        async def fake_db_session():
            yield fake_session

        with patch("backend.services.editing.db_session", fake_db_session):
            ctx = await resolve_listing_context("listing-1", "user-1", required=False)
        self.assertIsNone(ctx)

    async def test_resolve_listing_context_not_found_raises(self):
        fake_session = FakeSession(rows=[])

        @asynccontextmanager
        async def fake_db_session():
            yield fake_session

        with patch("backend.services.editing.db_session", fake_db_session):
            with self.assertRaises(EditingError) as ctx:
                await resolve_listing_context("listing-1", "user-1", required=True)
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_persist_generation_without_listing(self):
        fake_session = FakeSession()

        @asynccontextmanager
        async def fake_db_session():
            yield fake_session

        with patch("backend.services.editing.db_session", fake_db_session):
            await persist_generation_result(
                s3_key="s3",
                pose="pose",
                prompt="prompt",
                options={"foo": "bar"},
                model_name="model-x",
                listing=None,
            )
        self.assertEqual(len(fake_session.added), 1)
        self.assertIsInstance(fake_session.added[0], Generation)

    async def test_persist_generation_with_listing_updates(self):
        fake_session = FakeSession(rows=[], settings={"existing": True})

        @asynccontextmanager
        async def fake_db_session():
            yield fake_session

        listing = ListingContext(id="listing-1", user_id="user-1", source_s3_key="s3")
        with patch("backend.services.editing.db_session", fake_db_session):
            await persist_generation_result(
                s3_key="new-s3",
                pose="pose",
                prompt="prompt",
                options={"foo": "bar"},
                model_name="model-x",
                listing=listing,
                update_listing_settings=True,
                garment_type="dress",
                garment_type_override=" custom ",
            )

        self.assertEqual(len(fake_session.added), 2)
        self.assertIsInstance(fake_session.added[0], Generation)
        self.assertIsInstance(fake_session.added[1], ListingImage)
        update_params = [
            params
            for stmt, params in fake_session.executed
            if "UPDATE listings SET settings_json" in stmt
        ]
        self.assertTrue(update_params)
        self.assertEqual(update_params[0]["j"]["garment_type"], "dress")
        self.assertEqual(update_params[0]["j"]["garment_type_origin"], "user")


if __name__ == "__main__":
    unittest.main()
