"""Unit tests for `S3FileStorage`, S3 configuration validation, and storage DI caching."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest
from botocore.exceptions import ClientError
from pydantic import ValidationError

from app.core.app_settings import AppEnvironment, Settings
from app.core.dependency_container import _build_s3_storage, get_storage
from app.storage.local_disk_storage import LocalFileStorage
from app.storage.s3_file_storage import S3FileStorage


class _FakeStreamingBody:
    """In-memory stand-in for botocore `StreamingBody` tracking `close()`."""

    def __init__(self, payload: bytes) -> None:
        self._payload = payload
        self.closed = False

    def read(self) -> bytes:
        return self._payload

    def close(self) -> None:
        self.closed = True


class _FakeS3Client:
    """In-memory S3 client double for unit testing `S3FileStorage`."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.bodies: list[_FakeStreamingBody] = []
        self.raise_on_delete: ClientError | None = None

    def put_object(self, *, Bucket: str, Key: str, Body: bytes) -> None:  # noqa: N803
        self.objects[(Bucket, Key)] = Body

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        if (Bucket, Key) not in self.objects:
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "The specified key does not exist."}},
                "GetObject",
            )
        body = _FakeStreamingBody(self.objects[(Bucket, Key)])
        self.bodies.append(body)
        return {"Body": body}

    def delete_object(self, *, Bucket: str, Key: str) -> None:  # noqa: N803
        if self.raise_on_delete is not None:
            raise self.raise_on_delete
        if (Bucket, Key) not in self.objects:
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "Missing"}},
                "DeleteObject",
            )
        del self.objects[(Bucket, Key)]


@pytest.mark.asyncio
async def test_s3_storage_roundtrip_and_stream_closing() -> None:
    """Verify `save_bytes`, `read_bytes`, stream closing, and `delete_file`."""
    client = _FakeS3Client()
    storage = S3FileStorage(bucket="margin-docs", key_prefix="uploads/", client=client)  # type: ignore[arg-type]
    doc_id = uuid.uuid4()

    rel_path = await storage.save_bytes(
        owner_session_id="sess_abc-123",
        document_id=doc_id,
        extension=".PDF",
        content=b"%PDF-1.4 sample",
    )
    assert rel_path == f"sess_abc-123/{doc_id.hex}.pdf"
    assert ("margin-docs", f"uploads/{rel_path}") in client.objects

    loaded = await storage.read_bytes(rel_path)
    assert loaded == b"%PDF-1.4 sample"
    assert len(client.bodies) == 1
    assert client.bodies[0].closed is True

    await storage.delete_file(rel_path)
    assert ("margin-docs", f"uploads/{rel_path}") not in client.objects

    # Deleting an already-absent object should ignore NoSuchKey cleanly.
    await storage.delete_file(rel_path)


@pytest.mark.asyncio
async def test_s3_storage_error_and_traversal_handling() -> None:
    """Verify 404 translation, AccessDenied propagation, and traversal rejection."""
    client = _FakeS3Client()
    storage = S3FileStorage(bucket="margin-docs", key_prefix="docs", client=client)  # type: ignore[arg-type]

    with pytest.raises(FileNotFoundError):
        await storage.read_bytes("sess/missing.pdf")

    with pytest.raises(ValueError):
        await storage.read_bytes("../secret.txt")

    client.raise_on_delete = ClientError(
        {"Error": {"Code": "AccessDenied", "Message": "Denied"}},
        "DeleteObject",
    )
    with pytest.raises(ClientError):
        await storage.delete_file("sess/any.pdf")


def test_s3_settings_validation_and_provider_selection(tmp_path: Path) -> None:
    """Verify S3 config invariants, placeholder rejection, IAM-role support, and caching."""
    # Reject invalid provider names
    with pytest.raises(ValidationError):
        Settings(_env_file=None, STORAGE_PROVIDER="gcs")

    # Reject placeholder bucket or endpoint values
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            STORAGE_PROVIDER="s3",
            S3_BUCKET="your-bucket",
            S3_REGION="us-east-1",
            S3_ACCESS_KEY_ID="ak",
            S3_SECRET_ACCESS_KEY="sk",
        )
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            STORAGE_PROVIDER="s3",
            S3_BUCKET="margin-real",
            S3_ENDPOINT_URL="https://<account-id>.r2.cloudflarestorage.com",
            S3_ACCESS_KEY_ID="ak",
            S3_SECRET_ACCESS_KEY="sk",
        )

    # Reject partial key pairs or custom endpoint without keys
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            STORAGE_PROVIDER="s3",
            S3_BUCKET="margin-real",
            S3_REGION="us-east-1",
            S3_ACCESS_KEY_ID="only-access-key",
        )
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            STORAGE_PROVIDER="s3",
            S3_BUCKET="margin-real",
            S3_ENDPOINT_URL="https://example.r2.cloudflarestorage.com",
        )

    # Allow AWS IAM-role mode (no static keys when standard AWS region is provided)
    iam_settings = Settings(
        _env_file=None,
        APP_ENV=AppEnvironment.DEVELOPMENT,
        STORAGE_PROVIDER="s3",
        S3_BUCKET="margin-real",
        S3_REGION="us-east-1",
    )
    _build_s3_storage.cache_clear()
    first = get_storage(iam_settings)
    second = get_storage(iam_settings)
    assert isinstance(first, S3FileStorage)
    assert first is second

    local_settings = Settings(
        _env_file=None,
        STORAGE_PROVIDER="local",
        STORAGE_DIR=tmp_path / "uploads",
    )
    assert isinstance(get_storage(local_settings), LocalFileStorage)
