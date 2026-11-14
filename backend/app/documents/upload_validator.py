"""Upload validation enforcing extension, signature, DOCX archive safety, and size limits."""

from __future__ import annotations

import hashlib
import io
import os
import re
import zipfile
from dataclasses import dataclass

from app.core.domain_exceptions import (
    FileSizeLimitExceededError,
    UnsupportedDocumentFormatError,
)
from app.schemas.document_contracts import DocumentFormat

_PDF_MAGIC = b"%PDF-"
_ZIP_MAGIC_PREFIXES = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")

# Maximum uncompressed size (50 MB) and member count allowed inside a DOCX archive.
_MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
_MAX_DOCX_ARCHIVE_ENTRIES = 1_000
_REQUIRED_DOCX_MEMBERS = {"[Content_Types].xml", "word/document.xml"}

_ALLOWED_EXTENSIONS: dict[str, DocumentFormat] = {
    ".pdf": DocumentFormat.PDF,
    ".docx": DocumentFormat.DOCX,
    ".txt": DocumentFormat.TXT,
}

_CANONICAL_MIME_BY_FORMAT: dict[DocumentFormat, str] = {
    DocumentFormat.PDF: "application/pdf",
    DocumentFormat.DOCX: (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
    DocumentFormat.TXT: "text/plain",
}

_ALLOWED_MIME_BY_FORMAT: dict[DocumentFormat, set[str]] = {
    DocumentFormat.PDF: {
        "application/pdf",
        "application/x-pdf",
        "application/octet-stream",
    },
    DocumentFormat.DOCX: {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
        "application/octet-stream",
    },
    DocumentFormat.TXT: {
        "text/plain",
        "application/octet-stream",
    },
}


@dataclass(frozen=True, slots=True)
class ValidatedUpload:
    """Sanitised, signature-verified, and hash-tagged upload payload."""

    sanitised_filename: str
    content_type: str
    doc_format: DocumentFormat
    file_size_bytes: int
    content_sha256: str
    raw_bytes: bytes


def sanitise_display_filename(filename: str | None) -> str:
    """Strip directory components and unsafe control characters from user-supplied filenames."""
    if not filename or not filename.strip():
        raise UnsupportedDocumentFormatError("Uploaded file must include a valid filename.")
    basename = os.path.basename(filename.strip().replace("\\", "/"))
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", "", basename).strip()
    if not cleaned or cleaned in {".", ".."}:
        raise UnsupportedDocumentFormatError("Uploaded filename is invalid.")
    return cleaned[:255]


def _verify_docx_archive_safety(raw_bytes: bytes) -> None:
    """Inspect DOCX ZIP structure for required OpenXML members and ZIP-bomb expansion limits."""
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
            infos = archive.infolist()
            if len(infos) > _MAX_DOCX_ARCHIVE_ENTRIES:
                raise FileSizeLimitExceededError(
                    "Uploaded DOCX archive contains too many internal entries."
                )
            total_uncompressed = sum(max(0, info.file_size) for info in infos)
            if total_uncompressed > _MAX_DOCX_UNCOMPRESSED_BYTES:
                raise FileSizeLimitExceededError(
                    "Uploaded DOCX decompressed content exceeds maximum safety limit."
                )
            member_names = {info.filename for info in infos}
            if not _REQUIRED_DOCX_MEMBERS.issubset(member_names):
                raise UnsupportedDocumentFormatError(
                    "Uploaded DOCX archive is missing required OpenXML word/document.xml structure."
                )
    except zipfile.BadZipFile as exc:
        raise UnsupportedDocumentFormatError(
            "Uploaded DOCX file is not a valid ZIP/OpenXML archive."
        ) from exc


def _verify_magic_bytes(doc_format: DocumentFormat, raw_bytes: bytes) -> None:
    """Verify binary file header signatures so disguised executables or ZIP bombs are rejected."""
    if doc_format == DocumentFormat.PDF:
        if not raw_bytes.startswith(_PDF_MAGIC):
            raise UnsupportedDocumentFormatError(
                "Uploaded PDF file failed signature verification (missing %PDF- header)."
            )
    elif doc_format == DocumentFormat.DOCX:
        if not raw_bytes.startswith(_ZIP_MAGIC_PREFIXES):
            raise UnsupportedDocumentFormatError(
                "Uploaded DOCX file failed signature verification (not a valid OpenXML archive)."
            )
        _verify_docx_archive_safety(raw_bytes)
    elif doc_format == DocumentFormat.TXT:
        if b"\x00" in raw_bytes[:8192]:
            raise UnsupportedDocumentFormatError(
                "Uploaded TXT file contains binary null bytes and is not valid plain text."
            )
        try:
            raw_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            try:
                raw_bytes.decode("latin-1")
            except UnicodeDecodeError:
                raise UnsupportedDocumentFormatError(
                    "Uploaded TXT file is not valid UTF-8 or Latin-1 text."
                ) from exc


def validate_uploaded_file(
    *,
    filename: str | None,
    content_type: str | None,
    raw_bytes: bytes,
    max_upload_size_bytes: int,
) -> ValidatedUpload:
    """Validate file size, extension, declared MIME type, magic-byte signature, and SHA-256."""
    sanitised_name = sanitise_display_filename(filename)
    _, ext = os.path.splitext(sanitised_name.lower())

    doc_format = _ALLOWED_EXTENSIONS.get(ext)
    if doc_format is None:
        raise UnsupportedDocumentFormatError(
            f"Unsupported file extension '{ext or 'none'}'. Supported formats: PDF, DOCX, TXT."
        )

    size_bytes = len(raw_bytes)
    if size_bytes == 0:
        raise FileSizeLimitExceededError("Uploaded file is empty (0 bytes).")
    if size_bytes > max_upload_size_bytes:
        limit_mb = round(max_upload_size_bytes / (1024 * 1024), 1)
        raise FileSizeLimitExceededError(
            f"Uploaded file exceeds the maximum allowed size of {limit_mb} MB."
        )

    normalised_mime = (content_type or "application/octet-stream").split(";")[0].strip().lower()
    allowed_mimes = _ALLOWED_MIME_BY_FORMAT[doc_format]
    if normalised_mime not in allowed_mimes:
        raise UnsupportedDocumentFormatError(
            f"Content-Type '{normalised_mime}' does not match file extension '{ext}'."
        )

    _verify_magic_bytes(doc_format, raw_bytes)
    content_sha256 = hashlib.sha256(raw_bytes).hexdigest()

    return ValidatedUpload(
        sanitised_filename=sanitised_name,
        content_type=_CANONICAL_MIME_BY_FORMAT[doc_format],
        doc_format=doc_format,
        file_size_bytes=size_bytes,
        content_sha256=content_sha256,
        raw_bytes=raw_bytes,
    )
