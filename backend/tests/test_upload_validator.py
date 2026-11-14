"""Unit tests for file upload validation, magic-byte checks, and filename sanitisation."""

from __future__ import annotations

import pytest

from app.core.domain_exceptions import (
    FileSizeLimitExceededError,
    UnsupportedDocumentFormatError,
)
from app.documents.upload_validator import sanitise_display_filename, validate_uploaded_file
from app.schemas.document_contracts import DocumentFormat


def test_sanitise_display_filename_strips_directory_traversal() -> None:
    """Verify path components like `../../` are stripped from user-supplied filenames."""
    cleaned = sanitise_display_filename("../../etc/secret_notes.pdf")
    assert cleaned == "secret_notes.pdf"


def test_validate_uploaded_file_accepts_valid_pdf_signature() -> None:
    """Verify a PDF starting with `%PDF-` passes validation."""
    raw_pdf = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"
    result = validate_uploaded_file(
        filename="research-paper.pdf",
        content_type="application/pdf",
        raw_bytes=raw_pdf,
        max_upload_size_bytes=1024 * 1024,
    )
    assert result.doc_format == DocumentFormat.PDF
    assert result.sanitised_filename == "research-paper.pdf"
    assert result.file_size_bytes == len(raw_pdf)


def test_validate_uploaded_file_rejects_spoofed_pdf_magic_bytes() -> None:
    """Verify an executable or plain text file renamed to `.pdf` is rejected."""
    with pytest.raises(UnsupportedDocumentFormatError, match="signature verification"):
        validate_uploaded_file(
            filename="spoofed.pdf",
            content_type="application/pdf",
            raw_bytes=b"MZ\x90\x00not_a_pdf_at_all",
            max_upload_size_bytes=1024 * 1024,
        )


def test_validate_uploaded_file_rejects_oversized_payload() -> None:
    """Verify files larger than `max_upload_size_bytes` raise `FileSizeLimitExceededError`."""
    with pytest.raises(FileSizeLimitExceededError, match="maximum allowed size"):
        validate_uploaded_file(
            filename="notes.txt",
            content_type="text/plain",
            raw_bytes=b"A" * 2048,
            max_upload_size_bytes=1024,
        )


def test_validate_uploaded_file_rejects_invalid_docx_zip_structure() -> None:
    """Verify a ZIP archive missing OpenXML `word/document.xml` is rejected as a DOCX."""
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("random.txt", "not an openxml document")

    with pytest.raises(UnsupportedDocumentFormatError, match="word/document.xml"):
        validate_uploaded_file(
            filename="fake.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            raw_bytes=buf.getvalue(),
            max_upload_size_bytes=1024 * 1024,
        )
