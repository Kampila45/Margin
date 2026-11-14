"""Thin HTTP route handlers for document upload, listing, page inspection, and deletion."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Path, Query, Response, UploadFile, status

from app.core.dependency_container import get_document_service, get_owner_session_id
from app.documents.document_ingestion_service import DocumentService
from app.schemas.document_contracts import (
    DocumentFormat,
    DocumentListResponse,
    DocumentPageResponse,
    DocumentResponse,
    DocumentStatus,
)

router = APIRouter(prefix="/api/v1/documents", tags=["Documents"])


@router.post(
    "",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and index a document",
)
async def upload_document(
    file: Annotated[UploadFile, File(description="PDF, DOCX, or TXT file to ingest.")],
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    document_service: Annotated[DocumentService, Depends(get_document_service)],
) -> DocumentResponse:
    """Validate, store, extract, chunk, and embed a document for the current session."""
    raw_bytes = await file.read()
    return await document_service.ingest_document(
        owner_session_id=owner_session_id,
        filename=file.filename,
        content_type=file.content_type,
        raw_bytes=raw_bytes,
    )


@router.get(
    "",
    response_model=DocumentListResponse,
    summary="List documents in the current session",
)
async def list_documents(
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    document_service: Annotated[DocumentService, Depends(get_document_service)],
    doc_format: Annotated[
        DocumentFormat | None,
        Query(alias="format", description="Optional filter by file format (pdf, docx, txt)."),
    ] = None,
    doc_status: Annotated[
        DocumentStatus | None,
        Query(alias="status", description="Optional filter by ingestion status."),
    ] = None,
    search: Annotated[
        str | None,
        Query(max_length=120, description="Optional case-insensitive filename search query."),
    ] = None,
    limit: Annotated[
        int,
        Query(ge=1, le=100, description="Maximum number of documents to return."),
    ] = 50,
    offset: Annotated[
        int,
        Query(ge=0, description="Number of documents to skip for pagination."),
    ] = 0,
) -> DocumentListResponse:
    """Return paginated documents owned by the caller's session with optional library filters."""
    return await document_service.list_documents(
        owner_session_id,
        doc_format=doc_format,
        status=doc_status,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{document_id}",
    response_model=DocumentResponse,
    summary="Get document metadata and indexing status",
)
async def get_document(
    document_id: Annotated[UUID, Path(description="Unique document identifier.")],
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    document_service: Annotated[DocumentService, Depends(get_document_service)],
) -> DocumentResponse:
    """Return metadata and indexing status for a single session-owned document."""
    return await document_service.get_document(
        document_id=document_id,
        owner_session_id=owner_session_id,
    )


@router.get(
    "/{document_id}/file",
    summary="Stream raw document file for the reader",
)
async def get_document_file(
    document_id: Annotated[UUID, Path(description="Unique document identifier.")],
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    document_service: Annotated[DocumentService, Depends(get_document_service)],
) -> Response:
    """Stream the original uploaded file bytes (`inline`) for the PDF.js / document reader."""
    stored_file = await document_service.get_document_file(
        document_id=document_id,
        owner_session_id=owner_session_id,
    )
    return Response(
        content=stored_file.raw_bytes,
        media_type=stored_file.content_type,
        headers={
            "Content-Disposition": f'inline; filename="{stored_file.original_filename}"',
        },
    )


@router.get(
    "/{document_id}/pages/{page_number}",
    response_model=DocumentPageResponse,
    summary="Get extracted text for a specific page",
)
async def get_document_page(
    document_id: Annotated[UUID, Path(description="Unique document identifier.")],
    page_number: Annotated[int, Path(ge=1, description="1-based page number.")],
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    document_service: Annotated[DocumentService, Depends(get_document_service)],
) -> DocumentPageResponse:
    """Return extracted text content and chunk count for a 1-based page."""
    return await document_service.get_document_page(
        document_id=document_id,
        page_number=page_number,
        owner_session_id=owner_session_id,
    )


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a document and its indexed chunks",
)
async def delete_document(
    document_id: Annotated[UUID, Path(description="Unique document identifier.")],
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    document_service: Annotated[DocumentService, Depends(get_document_service)],
) -> Response:
    """Remove a document, its vector chunks, conversations, and stored file."""
    await document_service.delete_document(
        document_id=document_id,
        owner_session_id=owner_session_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
