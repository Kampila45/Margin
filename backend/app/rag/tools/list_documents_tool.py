"""PydanticAI tool for discovering all authorized documents in the current workspace session."""

from __future__ import annotations

from typing import Any

from pydantic_ai import RunContext

from app.rag.document_agent_deps import DocumentAgentDeps


async def list_workspace_documents(
    ctx: RunContext[DocumentAgentDeps],
) -> dict[str, Any]:
    """List all authorized documents in this workspace session (UUIDs, filenames, page counts)."""
    ctx.deps.steps_taken += 1
    docs = await ctx.deps.document_repo.get_many_for_session(
        ctx.deps.allowed_doc_ids,
        ctx.deps.owner_session_id,
    )
    results = [
        {
            "document_id": str(d.id),
            "filename": d.original_filename,
            "page_count": d.page_count,
            "status": d.status,
        }
        for d in docs
    ]
    return {
        "total_documents": len(results),
        "documents": results,
    }
