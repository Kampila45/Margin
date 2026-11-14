"""S3 / S3-compatible (Cloudflare R2, MinIO) implementation of `FileStorageProtocol`."""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError

_NOT_FOUND_S3_CODES = frozenset({"NoSuchKey", "404", "NotFound"})


class S3FileStorage:
    """Store uploaded files in an S3-compatible bucket using server-generated UUID keys.

    Compatible with AWS S3, Cloudflare R2, MinIO, and any S3-compatible endpoint.
    Keys are namespaced by session id (mirrors `LocalFileStorage` layout) so the
    same `stored_path` value can be used by either adapter.
    """

    def __init__(
        self,
        *,
        bucket: str,
        region: str | None = None,
        endpoint_url: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        key_prefix: str = "",
        client: BaseClient | None = None,
    ) -> None:
        self._bucket = bucket
        self._key_prefix = key_prefix.strip("/")
        self._client: BaseClient = client or boto3.client(
            "s3",
            region_name=region,
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=Config(
                signature_version="s3v4",
                connect_timeout=10,
                read_timeout=30,
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    def _object_key(self, relative_path: str) -> str:
        clean = relative_path.strip().lstrip("/")
        if not clean or "\\" in clean or ".." in clean.split("/"):
            raise ValueError("Resolved S3 object key contains an invalid path segment.")
        return f"{self._key_prefix}/{clean}" if self._key_prefix else clean

    async def save_bytes(
        self,
        *,
        owner_session_id: str,
        document_id: UUID,
        extension: str,
        content: bytes,
    ) -> str:
        """Upload bytes to `<prefix>/<session>/<uuid>.<ext>` and return the relative key."""
        safe_ext = extension.lstrip(".").lower()
        safe_session_dir = (
            "".join(ch for ch in owner_session_id if ch.isalnum() or ch in ("-", "_"))[:64]
            or "anonymous"
        )
        relative_path = f"{safe_session_dir}/{document_id.hex}.{safe_ext}"
        object_key = self._object_key(relative_path)

        def _put() -> None:
            self._client.put_object(Bucket=self._bucket, Key=object_key, Body=content)

        await asyncio.to_thread(_put)
        return relative_path

    async def read_bytes(self, stored_path: str) -> bytes:
        """Download object bytes from S3, closing the response stream cleanly."""
        object_key = self._object_key(stored_path)

        def _get() -> bytes:
            try:
                response: dict[str, Any] = self._client.get_object(
                    Bucket=self._bucket,
                    Key=object_key,
                )
            except ClientError as exc:
                error_code = str(exc.response.get("Error", {}).get("Code", ""))
                if error_code in _NOT_FOUND_S3_CODES:
                    raise FileNotFoundError(
                        f"Stored document object not found in S3: {object_key}"
                    ) from exc
                raise

            body = response["Body"]
            try:
                return bytes(body.read())
            finally:
                close_fn = getattr(body, "close", None)
                if callable(close_fn):
                    close_fn()

        return await asyncio.to_thread(_get)

    async def delete_file(self, stored_path: str) -> None:
        """Delete the object from S3, ignoring 404/NoSuchKey errors."""
        object_key = self._object_key(stored_path)

        def _delete() -> None:
            try:
                self._client.delete_object(Bucket=self._bucket, Key=object_key)
            except ClientError as exc:
                error_code = str(exc.response.get("Error", {}).get("Code", ""))
                if error_code not in _NOT_FOUND_S3_CODES:
                    raise

        await asyncio.to_thread(_delete)
