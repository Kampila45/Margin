"""Structural protocol and value objects for page-aware document text extraction."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from app.schemas.document_contracts import DocumentFormat


@dataclass(frozen=True, slots=True)
class ExtractedPage:
    """Text extracted from a single 1-based page or logical document section."""

    page_number: int
    text: str


@dataclass(frozen=True, slots=True)
class ExtractedDocument:
    """Complete page-ordered extraction result for an uploaded document."""

    page_count: int
    pages: list[ExtractedPage]


@runtime_checkable
class DocumentExtractorProtocol(Protocol):
    """Port interface for parsing uploaded document bytes into page-attributed text."""

    def extract(self, *, doc_format: DocumentFormat, raw_bytes: bytes) -> ExtractedDocument:
        """Extract ordered pages from `raw_bytes` according to `doc_format`."""
        ...
