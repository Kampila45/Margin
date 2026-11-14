"""Data-access repository for documents, extracted pages, and vector chunk search."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.orm_entities import DocumentChunkModel, DocumentModel
from app.schemas.document_contracts import DocumentFormat, DocumentStatus


@dataclass(frozen=True, slots=True)
class RetrievedChunkRecord:
    """Chunk record paired with its parent document filename and similarity score."""

    chunk_id: UUID
    document_id: UUID
    document_filename: str
    chunk_index: int
    page_number: int | None
    text_content: str
    score: float


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """Compute bounded cosine similarity in `[0.0, 1.0]` for non-Postgres test fallbacks."""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b, strict=False))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    raw = dot / (norm_a * norm_b)
    return max(0.0, min(1.0, raw))


class DocumentRepository:
    """Session-scoped persistence and vector retrieval operations for documents and chunks."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def count_for_session(self, owner_session_id: str) -> int:
        """Return total number of documents currently stored by `owner_session_id`."""
        stmt = (
            select(func.count())
            .select_from(DocumentModel)
            .where(DocumentModel.owner_session_id == owner_session_id)
        )
        result = await self._session.execute(stmt)
        return int(result.scalar_one())

    async def find_ready_by_sha256(
        self,
        *,
        owner_session_id: str,
        content_sha256: str,
    ) -> DocumentModel | None:
        """Return an active (ready or processing) document matching SHA-256."""
        stmt = (
            select(DocumentModel)
            .where(
                DocumentModel.owner_session_id == owner_session_id,
                DocumentModel.content_sha256 == content_sha256,
                DocumentModel.status.in_(
                    [DocumentStatus.READY.value, DocumentStatus.PROCESSING.value]
                ),
            )
            .order_by(DocumentModel.created_at.desc())
            .limit(1)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def find_active_by_sha256(
        self,
        *,
        owner_session_id: str,
        content_sha256: str,
    ) -> DocumentModel | None:
        """Find active (ready/processing) document to prevent duplicate ingestion."""
        return await self.find_ready_by_sha256(
            owner_session_id=owner_session_id,
            content_sha256=content_sha256,
        )

    async def create_document(
        self,
        *,
        document_id: UUID,
        owner_session_id: str,
        original_filename: str,
        stored_path: str,
        content_type: str,
        doc_format: DocumentFormat,
        file_size_bytes: int,
        content_sha256: str | None = None,
        status: DocumentStatus = DocumentStatus.PROCESSING,
    ) -> DocumentModel:
        """Persist a new document record before extraction and embedding."""
        doc = DocumentModel(
            id=document_id,
            owner_session_id=owner_session_id,
            original_filename=original_filename,
            stored_path=stored_path,
            content_type=content_type,
            doc_format=doc_format.value,
            file_size_bytes=file_size_bytes,
            content_sha256=content_sha256,
            status=status.value,
        )
        self._session.add(doc)
        await self._session.flush()
        return doc

    async def get_for_session(
        self,
        document_id: UUID,
        owner_session_id: str,
    ) -> DocumentModel | None:
        """Fetch a single document only if owned by `owner_session_id`."""
        stmt = select(DocumentModel).where(
            DocumentModel.id == document_id,
            DocumentModel.owner_session_id == owner_session_id,
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_many_for_session(
        self,
        document_ids: Sequence[UUID],
        owner_session_id: str,
    ) -> list[DocumentModel]:
        """Fetch multiple documents only if owned by `owner_session_id`."""
        if not document_ids:
            return []
        stmt = select(DocumentModel).where(
            DocumentModel.id.in_(list(document_ids)),
            DocumentModel.owner_session_id == owner_session_id,
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def list_for_session(
        self,
        owner_session_id: str,
        *,
        doc_format: DocumentFormat | None = None,
        status: DocumentStatus | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[DocumentModel], int]:
        """List paginated documents owned by `owner_session_id` with optional filters."""
        base_stmt = select(DocumentModel).where(DocumentModel.owner_session_id == owner_session_id)
        if doc_format is not None:
            base_stmt = base_stmt.where(DocumentModel.doc_format == doc_format.value)
        if status is not None:
            base_stmt = base_stmt.where(DocumentModel.status == status.value)
        if search and search.strip():
            pattern = f"%{search.strip()}%"
            base_stmt = base_stmt.where(DocumentModel.original_filename.ilike(pattern))

        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = int((await self._session.execute(count_stmt)).scalar_one())

        stmt = base_stmt.order_by(DocumentModel.created_at.desc()).limit(limit).offset(offset)
        result = await self._session.execute(stmt)
        return list(result.scalars().all()), total

    async def mark_ready(
        self,
        document: DocumentModel,
        *,
        page_count: int,
        chunk_count: int,
    ) -> DocumentModel:
        """Transition a document to `ready` once its chunks and embeddings are stored."""
        document.status = DocumentStatus.READY.value
        document.page_count = page_count
        document.chunk_count = chunk_count
        document.error_message = None
        document.updated_at = datetime.now(UTC)
        await self._session.flush()
        return document

    async def mark_failed(
        self,
        document: DocumentModel,
        *,
        error_message: str,
    ) -> DocumentModel:
        """Transition a document to `failed` with a safe user-facing reason."""
        document.status = DocumentStatus.FAILED.value
        document.error_message = error_message
        document.updated_at = datetime.now(UTC)
        await self._session.flush()
        return document

    async def replace_chunks(
        self,
        document_id: UUID,
        chunks: list[DocumentChunkModel],
    ) -> None:
        """Replace all chunks for a document atomically within the current transaction."""
        await self._session.execute(
            delete(DocumentChunkModel).where(DocumentChunkModel.document_id == document_id)
        )
        if chunks:
            self._session.add_all(chunks)
        await self._session.flush()

    async def list_chunks_for_page(
        self,
        document_id: UUID,
        page_number: int,
        *,
        owner_session_id: str,
    ) -> list[DocumentChunkModel]:
        """Return ordered chunks belonging to a specific 1-based page scoped to an owner session."""
        stmt = (
            select(DocumentChunkModel)
            .join(DocumentModel, DocumentChunkModel.document_id == DocumentModel.id)
            .where(
                DocumentChunkModel.document_id == document_id,
                DocumentChunkModel.page_number == page_number,
                DocumentModel.owner_session_id == owner_session_id,
            )
            .order_by(DocumentChunkModel.chunk_index.asc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def get_surrounding_chunks(
        self,
        *,
        document_id: UUID,
        owner_session_id: str,
        page_number: int | None,
        window: int = 1,
    ) -> list[RetrievedChunkRecord]:
        """Retrieve chunks from the selected page and adjacent pages for `selection_qa`."""
        stmt = (
            select(DocumentChunkModel, DocumentModel.original_filename)
            .join(DocumentModel, DocumentChunkModel.document_id == DocumentModel.id)
            .where(
                DocumentModel.id == document_id,
                DocumentModel.owner_session_id == owner_session_id,
            )
        )
        if page_number is not None:
            min_page = max(1, page_number - window)
            max_page = page_number + window
            stmt = stmt.where(
                DocumentChunkModel.page_number >= min_page,
                DocumentChunkModel.page_number <= max_page,
            )
        stmt = stmt.order_by(DocumentChunkModel.chunk_index.asc()).limit(6)
        rows = (await self._session.execute(stmt)).all()
        return [
            RetrievedChunkRecord(
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                document_filename=filename,
                chunk_index=chunk.chunk_index,
                page_number=chunk.page_number,
                text_content=chunk.text_content,
                score=1.0 if chunk.page_number == page_number else 0.85,
            )
            for chunk, filename in rows
        ]

    async def search_similar_chunks(
        self,
        *,
        owner_session_id: str,
        query_embedding: list[float],
        document_ids: Sequence[UUID],
        embedding_model: str | None = None,
        top_k: int = 6,
    ) -> list[RetrievedChunkRecord]:
        """Perform pgvector cosine-similarity search scoped to session and `document_ids`."""
        if not document_ids or top_k <= 0:
            return []

        bind = self._session.get_bind()
        dialect_name = bind.dialect.name if bind is not None else "postgresql"
        query_dim = len(query_embedding)

        if dialect_name == "postgresql":
            embedding_col: Any = DocumentChunkModel.embedding
            distance_expr: Any = embedding_col.cosine_distance(query_embedding)
            pg_stmt: Any = (
                select(
                    DocumentChunkModel,
                    DocumentModel.original_filename,
                    distance_expr.label("distance"),
                )
                .join(DocumentModel, DocumentChunkModel.document_id == DocumentModel.id)
                .where(
                    DocumentModel.owner_session_id == owner_session_id,
                    DocumentModel.id.in_(list(document_ids)),
                    DocumentChunkModel.embedding.is_not(None),
                    DocumentChunkModel.embedding_dimension == query_dim,
                )
            )
            if embedding_model:
                pg_stmt = pg_stmt.where(DocumentChunkModel.embedding_model == embedding_model)

            pg_stmt = pg_stmt.order_by(distance_expr.asc()).limit(top_k)
            pg_rows: list[tuple[DocumentChunkModel, str, float]] = list(
                (await self._session.execute(pg_stmt)).all()
            )
            return [
                RetrievedChunkRecord(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    document_filename=filename,
                    chunk_index=chunk.chunk_index,
                    page_number=chunk.page_number,
                    text_content=chunk.text_content,
                    score=round(max(0.0, min(1.0, 1.0 - float(distance))), 4),
                )
                for chunk, filename, distance in pg_rows
            ]

        # Non-PostgreSQL fallback used by SQLite integration tests.
        fallback_stmt = (
            select(DocumentChunkModel, DocumentModel.original_filename)
            .join(DocumentModel, DocumentChunkModel.document_id == DocumentModel.id)
            .where(
                DocumentModel.owner_session_id == owner_session_id,
                DocumentModel.id.in_(list(document_ids)),
                DocumentChunkModel.embedding.is_not(None),
                DocumentChunkModel.embedding_dimension == query_dim,
            )
        )
        if embedding_model:
            fallback_stmt = fallback_stmt.where(
                DocumentChunkModel.embedding_model == embedding_model
            )

        fallback_rows = list((await self._session.execute(fallback_stmt)).all())
        scored: list[RetrievedChunkRecord] = []
        for chunk, filename in fallback_rows:
            score = _cosine_similarity(query_embedding, chunk.embedding or [])
            scored.append(
                RetrievedChunkRecord(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    document_filename=filename,
                    chunk_index=chunk.chunk_index,
                    page_number=chunk.page_number,
                    text_content=chunk.text_content,
                    score=round(score, 4),
                )
            )
        scored.sort(key=lambda item: (-item.score, item.chunk_index))
        return scored[:top_k]

    async def delete_document(self, document: DocumentModel) -> None:
        """Delete a document and cascade-delete its chunks and conversations."""
        await self._session.delete(document)
        await self._session.flush()
