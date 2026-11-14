"""Local disk implementation of `FileStorageProtocol` with path-traversal protection."""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID


class LocalFileStorage:
    """Store uploaded files under a root directory using server-generated UUID paths."""

    def __init__(self, root_dir: Path) -> None:
        self._root_dir = root_dir.resolve()
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_safe_path(self, relative_path: str) -> Path:
        """Ensure the resolved path stays strictly inside the configured storage root."""
        candidate = (self._root_dir / relative_path).resolve()
        if self._root_dir not in candidate.parents and candidate != self._root_dir:
            raise ValueError("Resolved storage path escapes storage root directory.")
        return candidate

    async def save_bytes(
        self,
        *,
        owner_session_id: str,
        document_id: UUID,
        extension: str,
        content: bytes,
    ) -> str:
        """Write bytes to `<session_prefix>/<document_uuid>.<ext>` off the event loop."""
        safe_ext = extension.lstrip(".").lower()
        safe_session_dir = (
            "".join(ch for ch in owner_session_id if ch.isalnum() or ch in ("-", "_"))[:64]
            or "anonymous"
        )
        relative_path = f"{safe_session_dir}/{document_id.hex}.{safe_ext}"
        target_path = self._resolve_safe_path(relative_path)

        def _write() -> None:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(content)

        await asyncio.to_thread(_write)
        return relative_path

    async def read_bytes(self, stored_path: str) -> bytes:
        """Read file bytes asynchronously via `asyncio.to_thread`."""
        target_path = self._resolve_safe_path(stored_path)
        return await asyncio.to_thread(target_path.read_bytes)

    async def delete_file(self, stored_path: str) -> None:
        """Remove the stored file if present on disk."""
        target_path = self._resolve_safe_path(stored_path)

        def _unlink() -> None:
            if target_path.exists():
                target_path.unlink()

        await asyncio.to_thread(_unlink)
