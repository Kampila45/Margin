"""Page-aware text extraction for PDF, DOCX, and TXT documents."""

from __future__ import annotations

import io

from docx import Document as DocxDocument
from pypdf import PdfReader

from app.core.domain_exceptions import UnsupportedDocumentFormatError
from app.ports.document_extractor_port import (
    DocumentExtractorProtocol,
    ExtractedDocument,
    ExtractedPage,
)
from app.schemas.document_contracts import DocumentFormat

__all__ = [
    "DefaultDocumentExtractor",
    "DocumentExtractorProtocol",
    "ExtractedDocument",
    "ExtractedPage",
]


class DefaultDocumentExtractor:
    """Extract page-attributed text from PDF, DOCX, and TXT files."""

    def __init__(self, *, logical_page_chars: int = 3_000) -> None:
        self._logical_page_chars = logical_page_chars

    def extract(self, *, doc_format: DocumentFormat, raw_bytes: bytes) -> ExtractedDocument:
        """Dispatch extraction by validated `DocumentFormat`."""
        if doc_format == DocumentFormat.PDF:
            return self._extract_pdf(raw_bytes)
        if doc_format == DocumentFormat.DOCX:
            return self._extract_docx(raw_bytes)
        if doc_format == DocumentFormat.TXT:
            return self._extract_txt(raw_bytes)
        raise UnsupportedDocumentFormatError(f"Unsupported format: {doc_format}")

    def _extract_pdf(self, raw_bytes: bytes) -> ExtractedDocument:
        """Extract 1-based pages from a PDF stream using `pypdf`."""
        try:
            reader = PdfReader(io.BytesIO(raw_bytes))
        except Exception as exc:
            raise UnsupportedDocumentFormatError(
                "Could not parse PDF structure; the file may be corrupted or encrypted."
            ) from exc

        pages: list[ExtractedPage] = []
        for idx, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            pages.append(ExtractedPage(page_number=idx, text=text))

        return ExtractedDocument(page_count=len(pages), pages=pages)

    def _extract_docx(self, raw_bytes: bytes) -> ExtractedDocument:
        """Extract paragraphs from a DOCX archive and group into logical pages."""
        try:
            doc = DocxDocument(io.BytesIO(raw_bytes))
        except Exception as exc:
            raise UnsupportedDocumentFormatError(
                "Could not parse DOCX archive; the file may be corrupted."
            ) from exc

        paragraphs = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
        full_text = "\n\n".join(paragraphs)
        return self._paginate_text(full_text)

    def _extract_txt(self, raw_bytes: bytes) -> ExtractedDocument:
        """Decode plain text and group into logical pages for consistent reader navigation."""
        try:
            decoded = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            decoded = raw_bytes.decode("latin-1")
        return self._paginate_text(decoded)

    def _paginate_text(self, full_text: str) -> ExtractedDocument:
        """Split continuous text into logical pages on paragraph boundaries."""
        cleaned = full_text.strip()
        if not cleaned:
            return ExtractedDocument(page_count=1, pages=[ExtractedPage(page_number=1, text="")])

        paragraphs = [p.strip() for p in cleaned.split("\n\n") if p.strip()]
        pages: list[ExtractedPage] = []
        current_parts: list[str] = []
        current_len = 0

        for para in paragraphs:
            if current_parts and current_len + len(para) + 2 > self._logical_page_chars:
                pages.append(
                    ExtractedPage(
                        page_number=len(pages) + 1,
                        text="\n\n".join(current_parts),
                    )
                )
                current_parts = [para]
                current_len = len(para)
            else:
                current_parts.append(para)
                current_len += len(para) + 2

        if current_parts:
            pages.append(
                ExtractedPage(
                    page_number=len(pages) + 1,
                    text="\n\n".join(current_parts),
                )
            )

        return ExtractedDocument(page_count=len(pages), pages=pages)
