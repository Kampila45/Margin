"""Pydantic contracts and enums for document ingestion, metadata, and page content."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DocumentStatus(StrEnum):
    """Lifecycle states of an uploaded document during ingestion and indexing."""

    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class DocumentFormat(StrEnum):
    """Supported input file formats for document ingestion."""

    PDF = "pdf"
    DOCX = "docx"
    TXT = "txt"


class DocumentResponse(BaseModel):
    """Public metadata representation of a document owned by a session."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    original_filename: str
    doc_format: DocumentFormat
    file_size_bytes: int
    page_count: int | None = None
    chunk_count: int = 0
    status: DocumentStatus
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


class DocumentListResponse(BaseModel):
    """Paginated and session-scoped collection of documents."""

    items: list[DocumentResponse]
    total: int
    limit: int = 50
    offset: int = 0


class DocumentPageResponse(BaseModel):
    """Extracted text content for a single page or section of a document."""

    page_number: int = Field(ge=1, description="1-based page or logical section index.")
    text_content: str = Field(description="Combined normalised text for this page.")
    chunk_count: int = Field(ge=0, description="Number of indexed chunks on this page.")
