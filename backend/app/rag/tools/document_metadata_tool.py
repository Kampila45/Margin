"""PydanticAI tool for retrieving metadata and structural details for a specific document."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from pydantic import Field
from pydantic_ai import RunContext

from app.rag.document_agent_deps import DocumentAgentDeps


async def get_document_metadata(
    ctx: RunContext[DocumentAgentDeps],
    document_id: Annotated[str, Field(description="The document UUID to inspect.")],
) -> dict[str, Any]:
    """Retrieve metadata for an authorized document, including page count, file size, and status."""
    ctx.deps.steps_taken += 1
    try:
        doc_uuid = UUID(document_id.strip())
        if doc_uuid not in ctx.deps.allowed_doc_ids:
            return {"error": "Access denied. Document UUID not authorized for this session."}
    except ValueError:
        return {"error": f"Invalid document UUID format: '{document_id}'"}

    docs = await ctx.deps.document_repo.get_many_for_session(
        [doc_uuid],
        ctx.deps.owner_session_id,
    )
    if not docs:
        return {"error": f"Document '{document_id}' not found."}

    doc = docs[0]
    return {
        "document_id": str(doc.id),
        "filename": doc.original_filename,
        "page_count": doc.page_count,
        "status": doc.status,
        "file_size_bytes": doc.file_size_bytes,
    }
