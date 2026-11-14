"""PydanticAI tool for reading all content on a specific page of an authorized document."""

from __future__ import annotations

import logging
from typing import Annotated, Any
from uuid import UUID

from pydantic import Field
from pydantic_ai import RunContext

from app.database.document_repository import RetrievedChunkRecord
from app.rag.document_agent_deps import DocumentAgentDeps

logger = logging.getLogger(__name__)


async def read_document_page(
    ctx: RunContext[DocumentAgentDeps],
    document_id: Annotated[str, Field(description="The document UUID to read from.")],
    page_number: Annotated[
        int,
        Field(ge=1, description="1-based page number to inspect in full."),
    ],
) -> dict[str, Any]:
    """Read the complete text of a specific page from an authorized document."""
    ctx.deps.steps_taken += 1
    try:
        doc_uuid = UUID(document_id.strip())
        if doc_uuid not in ctx.deps.allowed_doc_ids:
            return {
                "error": "Access denied. Document UUID is not authorized for this session.",
                "content": "",
            }
    except ValueError:
        return {
            "error": f"Invalid document UUID format: '{document_id}'",
            "content": "",
        }

    try:
        chunks = await ctx.deps.document_repo.list_chunks_for_page(
            document_id=doc_uuid,
            page_number=page_number,
            owner_session_id=ctx.deps.owner_session_id,
        )

        if not chunks:
            return {
                "document_id": str(doc_uuid),
                "page_number": page_number,
                "message": f"No text content found on page {page_number}.",
                "content": "",
            }

        filename = ctx.deps.filenames_by_id.get(doc_uuid, "document")
        passage_texts: list[str] = []

        for c in chunks:
            record = RetrievedChunkRecord(
                chunk_id=c.id,
                document_id=c.document_id,
                document_filename=filename,
                chunk_index=c.chunk_index,
                page_number=c.page_number,
                text_content=c.text_content,
                score=1.0,
            )
            citation_index = ctx.deps.register_chunk(record)
            passage_texts.append(
                f'<document_source citation_index="{citation_index}" '
                f'id="{c.id}" '
                f'document="{filename}" '
                f'page="{page_number}">\n'
                f"{c.text_content}\n"
                f"</document_source>"
            )

        return {
            "document_id": str(doc_uuid),
            "filename": filename,
            "page_number": page_number,
            "chunks_count": len(chunks),
            "content": "\n\n".join(passage_texts),
        }
    except Exception as exc:
        logger.exception("Error reading document page: %s", exc)
        return {"error": str(exc), "content": ""}
