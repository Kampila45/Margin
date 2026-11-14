"""Runtime dependency container injected into PydanticAI Document Agent tools."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from app.database.document_repository import DocumentRepository, RetrievedChunkRecord
from app.ports.ai_provider_ports import EmbeddingProviderProtocol


@dataclass
class DocumentAgentDeps:
    """Per-request dependencies and retrieved chunk store for document Q&A agent turns."""

    document_repo: DocumentRepository
    embedding_provider: EmbeddingProviderProtocol
    owner_session_id: str
    allowed_doc_ids: list[UUID]
    filenames_by_id: dict[UUID, str]
    embedding_model_name: str | None = None
    top_k: int = 6
    retrieved_chunks_store: dict[UUID, RetrievedChunkRecord] = field(default_factory=dict)
    citation_indices_by_chunk_id: dict[UUID, int] = field(default_factory=dict)
    steps_taken: int = 0

    def register_chunk(self, chunk: RetrievedChunkRecord) -> int:
        """Store `chunk` once in retrieval order and return its stable 1-based citation index."""
        existing_idx = self.citation_indices_by_chunk_id.get(chunk.chunk_id)
        if existing_idx is not None:
            return existing_idx
        self.retrieved_chunks_store[chunk.chunk_id] = chunk
        next_idx = len(self.retrieved_chunks_store)
        self.citation_indices_by_chunk_id[chunk.chunk_id] = next_idx
        return next_idx
