"""Structural protocol defining file storage operations for uploaded documents."""

from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID


@runtime_checkable
class FileStorageProtocol(Protocol):
    """Port interface for storing, reading, and deleting uploaded document bytes."""

    async def save_bytes(
        self,
        *,
        owner_session_id: str,
        document_id: UUID,
        extension: str,
        content: bytes,
    ) -> str:
        """Persist raw document bytes using a server-generated UUID key and return `stored_path`."""
        ...

    async def read_bytes(self, stored_path: str) -> bytes:
        """Read raw bytes from `stored_path`."""
        ...

    async def delete_file(self, stored_path: str) -> None:
        """Delete the stored file if it exists, without failing if already removed."""
        ...
