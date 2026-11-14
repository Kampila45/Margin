"""SQLAlchemy 2.0 ORM models for documents, vector chunks, conversations, and messages."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.core.app_settings import PG_EMBEDDING_DIMENSION
from app.database.db_engine import Base
from app.schemas.conversation_contracts import ChatMode, MessageRole
from app.schemas.document_contracts import DocumentFormat, DocumentStatus


def _utc_now() -> datetime:
    """Return timezone-aware UTC timestamp."""
    return datetime.now(UTC)


class EmbeddingVectorType(TypeDecorator[list[float]]):
    """Dialect-aware vector column using `pgvector` on PostgreSQL and JSON in SQLite tests."""

    impl = JSON
    cache_ok = True
    comparator_factory = Vector.comparator_factory

    def __init__(self, dimension: int = PG_EMBEDDING_DIMENSION) -> None:
        super().__init__()
        self.dimension = dimension

    def load_dialect_impl(self, dialect: Dialect) -> Any:
        """Select native pgvector `VECTOR(dimension)` when connected to PostgreSQL."""
        if dialect.name == "postgresql":
            return dialect.type_descriptor(Vector(self.dimension))
        return dialect.type_descriptor(JSON())

    def process_bind_param(self, value: list[float] | None, dialect: Dialect) -> Any:
        """Pass float lists directly to pgvector or JSON serializer."""
        if value is None:
            return None
        return [float(x) for x in value]

    def process_result_value(self, value: Any, dialect: Dialect) -> list[float] | None:
        """Normalise database vector representations back into a Python list of floats."""
        if value is None:
            return None
        return [float(x) for x in value]


class DocumentModel(Base):
    """Uploaded document metadata and ingestion status scoped to an owner session."""

    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_session_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    doc_format: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=DocumentFormat.PDF.value,
    )
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=DocumentStatus.PENDING.value,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        onupdate=_utc_now,
    )

    chunks: Mapped[list[DocumentChunkModel]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="DocumentChunkModel.chunk_index",
    )
    conversations: Mapped[list[ConversationModel]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_documents_owner_created", "owner_session_id", "created_at"),
        Index(
            "uq_documents_active_session_sha256",
            "owner_session_id",
            "content_sha256",
            unique=True,
            sqlite_where=text("status IN ('ready', 'processing') AND content_sha256 IS NOT NULL"),
            postgresql_where=text(
                "status IN ('ready', 'processing') AND content_sha256 IS NOT NULL"
            ),
        ),
    )


class DocumentChunkModel(Base):
    """Indexed text passage and vector embedding belonging to a document."""

    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_char_offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    end_char_offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text_content: Mapped[str] = mapped_column(Text, nullable=False)
    token_estimate: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding_model: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="gemini-embedding-001",
    )
    embedding_dimension: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=PG_EMBEDDING_DIMENSION,
    )
    embedding: Mapped[list[float] | None] = mapped_column(
        EmbeddingVectorType(PG_EMBEDDING_DIMENSION),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
    )

    document: Mapped[DocumentModel] = relationship(back_populates="chunks")

    __table_args__ = (
        Index("ix_document_chunks_doc_index", "document_id", "chunk_index", unique=True),
        Index("ix_document_chunks_doc_page", "document_id", "page_number"),
    )


class ConversationModel(Base):
    """Reader conversation thread anchored to a specific document and owner session."""

    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_session_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_ids_json: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
        default=list,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        onupdate=_utc_now,
    )

    document: Mapped[DocumentModel] = relationship(back_populates="conversations")
    messages: Mapped[list[ConversationMessageModel]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ConversationMessageModel.created_at",
    )


class ConversationMessageModel(Base):
    """Individual user or assistant turn within a conversation, including verified citations."""

    __tablename__ = "conversation_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=MessageRole.USER.value,
    )
    mode: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=ChatMode.DOCUMENT_QA.value,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    selected_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected_page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    insufficient_context: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    citations_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON,
        nullable=False,
        default=list,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
    )

    conversation: Mapped[ConversationModel] = relationship(back_populates="messages")


class DatabaseConnectionModel(Base):
    """External PostgreSQL connection metadata and discovered schema scoped to a session."""

    __tablename__ = "database_connections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_session_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="postgresql")
    encrypted_connection_url: Mapped[str] = mapped_column(Text, nullable=False)
    masked_connection_url: Mapped[str] = mapped_column(String(255), nullable=False)
    schema_snapshot_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON,
        nullable=False,
        default=list,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        onupdate=_utc_now,
    )

    turns: Mapped[list[SqlQueryTurnModel]] = relationship(
        back_populates="connection",
        cascade="all, delete-orphan",
        order_by="SqlQueryTurnModel.created_at",
    )


class SqlQueryTurnModel(Base):
    """Natural-language-to-SQL turn storing generated SQL, results, and grounded summary."""

    __tablename__ = "sql_query_turns"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("database_connections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_session_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    generated_sql: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    executed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    execution_time_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    columns_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    rows_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    chart_suggestion_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    answer_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
    )

    connection: Mapped[DatabaseConnectionModel] = relationship(back_populates="turns")
