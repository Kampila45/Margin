"""Application service orchestrating document upload, extraction, chunking, and indexing."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_settings import Settings
from app.core.app_telemetry import log_service_error
from app.core.domain_exceptions import (
    DocumentNotFoundError,
    ErrorCode,
    MarginError,
    PageLimitExceededError,
    SessionQuotaExceededError,
)
from app.database.document_repository import DocumentRepository
from app.database.orm_entities import DocumentChunkModel
from app.documents.upload_validator import validate_uploaded_file
from app.ports.ai_provider_ports import EmbeddingProviderProtocol
from app.ports.document_extractor_port import DocumentExtractorProtocol
from app.ports.file_storage_port import FileStorageProtocol
from app.rag.passage_chunker import chunk_extracted_pages
from app.schemas.document_contracts import (
    DocumentFormat,
    DocumentListResponse,
    DocumentPageResponse,
    DocumentResponse,
    DocumentStatus,
)

logger = logging.getLogger(__name__)
_SESSION_UPLOAD_LOCKS: dict[str, asyncio.Lock] = {}


def _get_session_upload_lock(owner_session_id: str) -> asyncio.Lock:
    """Return a per-session asyncio lock for atomic upload dedup and quota checks."""
    lock = _SESSION_UPLOAD_LOCKS.get(owner_session_id)
    if lock is None:
        if len(_SESSION_UPLOAD_LOCKS) > 1024:
            # Prune unlocked entries to bound memory across ephemeral sessions.
            for sid in [k for k, v in _SESSION_UPLOAD_LOCKS.items() if not v.locked()]:
                _SESSION_UPLOAD_LOCKS.pop(sid, None)
        lock = asyncio.Lock()
        _SESSION_UPLOAD_LOCKS[owner_session_id] = lock
    return lock


@dataclass(frozen=True, slots=True)
class StoredDocumentFile:
    """Raw document bytes and MIME metadata returned when streaming a file to the reader."""

    raw_bytes: bytes
    content_type: str
    original_filename: str


class DocumentService:
    """Coordinate document validation, storage, page extraction, chunking, and embedding."""

    def __init__(
        self,
        *,
        session: AsyncSession,
        document_repo: DocumentRepository,
        storage: FileStorageProtocol,
        extractor: DocumentExtractorProtocol,
        embedding_provider: EmbeddingProviderProtocol,
        settings: Settings,
    ) -> None:
        self._session = session
        self._document_repo = document_repo
        self._storage = storage
        self._extractor = extractor
        self._embedding_provider = embedding_provider
        self._settings = settings

    async def ingest_document(
        self,
        *,
        owner_session_id: str,
        filename: str | None,
        content_type: str | None,
        raw_bytes: bytes,
    ) -> DocumentResponse:
        """Validate, deduplicate, store, extract, chunk, and embed an uploaded document."""
        started_at = time.perf_counter()

        validated = validate_uploaded_file(
            filename=filename,
            content_type=content_type,
            raw_bytes=raw_bytes,
            max_upload_size_bytes=self._settings.max_upload_size_bytes,
        )

        # Reserve upload slot atomically per session (dedup + quota check + initial row)
        # before releasing lock for CPU extraction and external Gemini calls.
        session_lock = _get_session_upload_lock(owner_session_id)
        async with session_lock:
            bind = self._session.get_bind()
            if bind is not None and bind.dialect.name == "postgresql":
                await self._session.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:sid))"),
                    {"sid": owner_session_id},
                )

            existing_active = await self._document_repo.find_active_by_sha256(
                owner_session_id=owner_session_id,
                content_sha256=validated.content_sha256,
            )
            if existing_active is not None:
                return DocumentResponse.model_validate(existing_active)

            current_count = await self._document_repo.count_for_session(owner_session_id)
            if current_count >= self._settings.max_documents_per_session:
                limit = self._settings.max_documents_per_session
                raise SessionQuotaExceededError(
                    f"Session limit of {limit} documents reached. "
                    "Please delete an existing document before uploading another."
                )

            document_id = uuid.uuid4()
            stored_path = await self._storage.save_bytes(
                owner_session_id=owner_session_id,
                document_id=document_id,
                extension=validated.doc_format.value,
                content=validated.raw_bytes,
            )

            try:
                document = await self._document_repo.create_document(
                    document_id=document_id,
                    owner_session_id=owner_session_id,
                    original_filename=validated.sanitised_filename,
                    stored_path=stored_path,
                    content_type=validated.content_type,
                    doc_format=validated.doc_format,
                    file_size_bytes=validated.file_size_bytes,
                    content_sha256=validated.content_sha256,
                    status=DocumentStatus.PROCESSING,
                )
                # Commit initial PROCESSING state before CPU extraction and external Gemini calls
                # so a database transaction is not held open across slow network I/O.
                await self._session.commit()
            except IntegrityError:
                await self._session.rollback()
                await self._storage.delete_file(stored_path)
                existing_concurrent = await self._document_repo.find_active_by_sha256(
                    owner_session_id=owner_session_id,
                    content_sha256=validated.content_sha256,
                )
                if existing_concurrent is not None:
                    return DocumentResponse.model_validate(existing_concurrent)
                raise
            except Exception:
                await self._session.rollback()
                await self._storage.delete_file(stored_path)
                raise

        try:
            extract_start = time.perf_counter()
            extracted = await asyncio.to_thread(
                self._extractor.extract,
                doc_format=validated.doc_format,
                raw_bytes=validated.raw_bytes,
            )
            if extracted.page_count > self._settings.max_pages_per_document:
                raise PageLimitExceededError(
                    f"Document has {extracted.page_count} pages, exceeding the limit of "
                    f"{self._settings.max_pages_per_document} pages."
                )

            candidates = await asyncio.to_thread(
                chunk_extracted_pages,
                extracted.pages,
                target_chars=self._settings.chunk_target_chars,
                overlap_chars=self._settings.chunk_overlap_chars,
            )
            extract_ms = round((time.perf_counter() - extract_start) * 1000, 1)

            embed_start = time.perf_counter()
            embeddings: list[list[float]] = []
            if candidates:
                embeddings = await self._embedding_provider.embed_documents(
                    [candidate.text_content for candidate in candidates]
                )
            embed_ms = round((time.perf_counter() - embed_start) * 1000, 1)

            chunk_models = [
                DocumentChunkModel(
                    document_id=document.id,
                    chunk_index=candidate.chunk_index,
                    page_number=candidate.page_number,
                    start_char_offset=candidate.start_char_offset,
                    end_char_offset=candidate.end_char_offset,
                    text_content=candidate.text_content,
                    token_estimate=candidate.token_estimate,
                    embedding_model=self._settings.gemini_embedding_model,
                    embedding_dimension=(
                        len(embeddings[idx])
                        if idx < len(embeddings) and embeddings[idx]
                        else self._settings.gemini_embedding_dimension
                    ),
                    embedding=embeddings[idx] if idx < len(embeddings) else None,
                )
                for idx, candidate in enumerate(candidates)
            ]

            await self._document_repo.replace_chunks(document.id, chunk_models)
            await self._document_repo.mark_ready(
                document,
                page_count=extracted.page_count,
                chunk_count=len(chunk_models),
            )
            await self._session.commit()

            total_ms = round((time.perf_counter() - started_at) * 1000, 1)
            logger.info(
                "document_ingestion_completed document_id=%s format=%s pages=%d chunks=%d "
                "extract_ms=%s embed_ms=%s total_ms=%s",
                document.id,
                validated.doc_format.value,
                extracted.page_count,
                len(chunk_models),
                extract_ms,
                embed_ms,
                total_ms,
            )
            return DocumentResponse.model_validate(document)

        except MarginError as exc:
            await self._session.rollback()
            await self._storage.delete_file(stored_path)
            await self._document_repo.mark_failed(document, error_message=exc.message)
            await self._session.commit()
            raise
        except Exception as exc:
            await self._session.rollback()
            await self._storage.delete_file(stored_path)
            log_service_error(
                logger,
                "document_ingestion_unexpected_failure",
                error_code=ErrorCode.INTERNAL_SERVER_ERROR.value,
                document_id=str(document.id),
                doc_format=validated.doc_format.value,
            )
            await self._document_repo.mark_failed(
                document,
                error_message="Document processing failed unexpectedly.",
            )
            await self._session.commit()
            raise exc

    async def list_documents(
        self,
        owner_session_id: str,
        *,
        doc_format: DocumentFormat | None = None,
        status: DocumentStatus | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> DocumentListResponse:
        """Return paginated documents owned by `owner_session_id` with optional library filters."""
        records, total = await self._document_repo.list_for_session(
            owner_session_id,
            doc_format=doc_format,
            status=status,
            search=search,
            limit=limit,
            offset=offset,
        )
        items = [DocumentResponse.model_validate(rec) for rec in records]
        return DocumentListResponse(items=items, total=total, limit=limit, offset=offset)

    async def get_document(
        self,
        *,
        document_id: UUID,
        owner_session_id: str,
    ) -> DocumentResponse:
        """Fetch a single document owned by `owner_session_id`."""
        document = await self._document_repo.get_for_session(document_id, owner_session_id)
        if document is None:
            raise DocumentNotFoundError("The requested document was not found in your session.")
        return DocumentResponse.model_validate(document)

    async def get_document_file(
        self,
        *,
        document_id: UUID,
        owner_session_id: str,
    ) -> StoredDocumentFile:
        """Read the raw stored document bytes for streaming to the PDF.js reader."""
        document = await self._document_repo.get_for_session(document_id, owner_session_id)
        if document is None:
            raise DocumentNotFoundError("The requested document was not found in your session.")
        try:
            raw_bytes = await self._storage.read_bytes(document.stored_path)
        except FileNotFoundError as exc:
            raise DocumentNotFoundError(
                "The stored document file could not be located."
            ) from exc
        return StoredDocumentFile(
            raw_bytes=raw_bytes,
            content_type=document.content_type,
            original_filename=document.original_filename,
        )

    async def get_document_page(
        self,
        *,
        document_id: UUID,
        page_number: int,
        owner_session_id: str,
    ) -> DocumentPageResponse:
        """Return combined extracted text for a specific 1-based page of a document."""
        document = await self._document_repo.get_for_session(document_id, owner_session_id)
        if document is None:
            raise DocumentNotFoundError("The requested document was not found in your session.")
        if document.page_count is not None and page_number > document.page_count:
            raise DocumentNotFoundError(
                f"Page {page_number} does not exist in this {document.page_count}-page document."
            )

        chunks = await self._document_repo.list_chunks_for_page(
            document_id,
            page_number,
            owner_session_id=owner_session_id,
        )
        combined_text = "\n\n".join(chunk.text_content for chunk in chunks)
        return DocumentPageResponse(
            page_number=page_number,
            text_content=combined_text,
            chunk_count=len(chunks),
        )

    async def delete_document(
        self,
        *,
        document_id: UUID,
        owner_session_id: str,
    ) -> None:
        """Delete a document from both database and underlying file storage."""
        document = await self._document_repo.get_for_session(document_id, owner_session_id)
        if document is None:
            raise DocumentNotFoundError("The requested document was not found in your session.")

        stored_path = document.stored_path
        await self._document_repo.delete_document(document)
        await self._session.commit()
        try:
            await self._storage.delete_file(stored_path)
        except Exception as exc:  # pragma: no cover
            logger.warning(
                "Underlying storage cleanup failed for deleted document %s at %s: %s",
                document_id,
                stored_path,
                exc,
            )
