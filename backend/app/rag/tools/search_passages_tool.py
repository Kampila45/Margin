"""PydanticAI tool for semantic passage retrieval using pgvector similarity search."""

from __future__ import annotations

import logging
from typing import Annotated, Any
from uuid import UUID

from pydantic import Field
from pydantic_ai import RunContext

from app.rag.document_agent_deps import DocumentAgentDeps

logger = logging.getLogger(__name__)


async def search_document_passages(
    ctx: RunContext[DocumentAgentDeps],
    query: Annotated[
        str,
        Field(
            description=(
                "The semantic search query describing facts, tables, or sections to find."
            ),
        ),
    ],
    document_id: Annotated[
        str | None,
        Field(
            description=(
                "Optional document UUID to restrict search to a specific document. "
                "Omit to search across all authorized workspace documents."
            ),
        ),
    ] = None,
) -> dict[str, Any]:
    """Search passages across authorized documents using semantic vector similarity."""
    ctx.deps.steps_taken += 1
    allowed_doc_ids = ctx.deps.allowed_doc_ids
    target_ids = list(allowed_doc_ids)

    if document_id and document_id.strip():
        try:
            parsed_id = UUID(document_id.strip())
            if parsed_id not in allowed_doc_ids:
                return {
                    "error": "Access denied. Document UUID is not authorized for this session.",
                    "passages": [],
                }
            target_ids = [parsed_id]
        except ValueError:
            return {
                "error": f"Invalid document UUID format: '{document_id}'",
                "passages": [],
            }

    if not target_ids:
        return {"passages": [], "message": "No documents authorized for search."}

    try:
        query_embedding = await ctx.deps.embedding_provider.embed_query(query.strip())
        chunks = await ctx.deps.document_repo.search_similar_chunks(
            owner_session_id=ctx.deps.owner_session_id,
            query_embedding=query_embedding,
            document_ids=target_ids,
            embedding_model=ctx.deps.embedding_model_name,
            top_k=ctx.deps.top_k,
        )

        results: list[dict[str, Any]] = []
        for c in chunks:
            citation_index = ctx.deps.register_chunk(c)
            results.append(
                {
                    "citation_index": citation_index,
                    "chunk_id": str(c.chunk_id),
                    "document_id": str(c.document_id),
                    "filename": c.document_filename,
                    "page_number": c.page_number,
                    "similarity_score": c.score,
                    "text": (
                        f'<document_source citation_index="{citation_index}" '
                        f'id="{c.chunk_id}" '
                        f'document="{c.document_filename}" '
                        f'page="{c.page_number or 1}">\n'
                        f"{c.text_content}\n"
                        f"</document_source>"
                    ),
                }
            )

        return {
            "query": query,
            "count": len(results),
            "passages": results,
        }
    except Exception as exc:
        logger.exception("Error searching document passages: %s", exc)
        return {"error": str(exc), "passages": []}
