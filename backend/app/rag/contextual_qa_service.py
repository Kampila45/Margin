"""RAG orchestration service supporting both `document_qa` and `selection_qa` modes."""

from __future__ import annotations

import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from app.core.answer_formatting import strip_followup_label_prefixes
from app.core.domain_exceptions import (
    DocumentNotFoundError,
    DocumentNotReadyError,
    InvalidSelectionContextError,
)
from app.database.document_repository import DocumentRepository, RetrievedChunkRecord
from app.ports.ai_provider_ports import EmbeddingProviderProtocol, LLMProviderProtocol
from app.rag.citation_verifier import (
    detect_insufficient_context,
    extract_verified_citations,
    normalize_citation_markers,
)
from app.rag.document_agent_service import DocumentAgentService
from app.rag.grounded_prompt_builder import (
    SYSTEM_INSTRUCTION,
    PromptSourceChunk,
    build_grounded_qa_prompt,
)
from app.schemas.conversation_contracts import ChatMode, CitationResponse, SelectionInput
from app.schemas.document_contracts import DocumentStatus

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RagAnswerResult:
    """Grounded answer, verified citations, and insufficient-context flag."""

    answer_text: str
    insufficient_context: bool
    citations: list[CitationResponse]


class RagService:
    """Coordinate vector retrieval, surrounding-chunk fusion, prompting, and citation checking."""

    def __init__(
        self,
        *,
        document_repo: DocumentRepository,
        embedding_provider: EmbeddingProviderProtocol,
        llm_provider: LLMProviderProtocol,
        top_k: int = 6,
        surrounding_window: int = 1,
        embedding_model_name: str | None = None,
    ) -> None:
        self._document_repo = document_repo
        self._embedding_provider = embedding_provider
        self._llm_provider = llm_provider
        self._top_k = top_k
        self._surrounding_window = surrounding_window
        self._embedding_model_name = embedding_model_name
        self._doc_agent = DocumentAgentService(
            document_repo=document_repo,
            embedding_provider=embedding_provider,
            llm_provider=llm_provider,
            embedding_model_name=embedding_model_name,
        )

    async def answer_question(
        self,
        *,
        owner_session_id: str,
        document_id: UUID,
        document_ids: Sequence[UUID] | None = None,
        question: str,
        mode: ChatMode,
        selection: SelectionInput | None = None,
        conversation_history: Sequence[tuple[str, str]] | None = None,
    ) -> RagAnswerResult:
        """Retrieve relevant document chunks and generate a grounded, citation-verified answer."""
        if mode == ChatMode.SELECTION_QA and (
            selection is None or not selection.selected_text.strip()
        ):
            raise InvalidSelectionContextError(
                "Selection Q&A mode requires a non-empty highlighted passage."
            )

        # In selection_qa mode, strictly isolate retrieval to the single target document
        # so unrelated documents never pollute an explanation of a highlighted passage.
        if mode == ChatMode.SELECTION_QA:
            selection_doc_id = (
                selection.document_id
                if (selection and selection.document_id is not None)
                else document_id
            )
            scoped_doc_ids = [selection_doc_id]
        else:
            raw_ids = list(document_ids) if document_ids else [document_id]
            scoped_doc_ids = list(dict.fromkeys(raw_ids))

        documents = await self._document_repo.get_many_for_session(
            scoped_doc_ids,
            owner_session_id,
        )
        if len(documents) != len(scoped_doc_ids):
            raise DocumentNotFoundError(
                "One or more requested documents were not found in your session."
            )
        for doc in documents:
            if doc.status != DocumentStatus.READY.value:
                raise DocumentNotReadyError(
                    f"Document '{doc.original_filename}' is currently '{doc.status}' "
                    "and not ready for question answering."
                )

        if mode == ChatMode.DOCUMENT_QA:
            filenames_by_id = {d.id: d.original_filename for d in documents}
            try:
                agent_res = await self._doc_agent.run_document_agent(
                    owner_session_id=owner_session_id,
                    scoped_doc_ids=scoped_doc_ids,
                    filenames_by_id=filenames_by_id,
                    question=question,
                    conversation_history=conversation_history,
                )
                if agent_res.answer_text and not agent_res.insufficient_context:
                    return RagAnswerResult(
                        answer_text=agent_res.answer_text,
                        insufficient_context=agent_res.insufficient_context,
                        citations=agent_res.citations,
                    )
            except Exception as exc:
                logger.warning(
                    "Document Agent execution failed, falling back to legacy RAG: %s",
                    exc,
                )

        retrieval_start = time.perf_counter()
        retrieved_chunks = await self._retrieve_context_chunks(
            owner_session_id=owner_session_id,
            scoped_doc_ids=scoped_doc_ids,
            question=question,
            mode=mode,
            selection=selection,
        )
        retrieval_ms = round((time.perf_counter() - retrieval_start) * 1000, 1)

        if not retrieved_chunks:
            return RagAnswerResult(
                answer_text=(
                    "The uploaded document does not contain any indexed text passages to answer "
                    "this question."
                ),
                insufficient_context=True,
                citations=[],
            )

        prompt_sources = [
            PromptSourceChunk(
                citation_index=idx,
                document_filename=chunk.document_filename,
                page_number=chunk.page_number,
                chunk_index=chunk.chunk_index,
                text_content=chunk.text_content,
            )
            for idx, chunk in enumerate(retrieved_chunks, start=1)
        ]

        user_prompt = build_grounded_qa_prompt(
            mode=mode,
            question=question,
            sources=prompt_sources,
            selected_text=selection.selected_text if selection else None,
            selected_page_number=selection.page_number if selection else None,
            conversation_history=conversation_history,
        )

        gen_start = time.perf_counter()
        raw_answer = await self._llm_provider.generate_grounded_answer(
            system_instruction=SYSTEM_INSTRUCTION,
            user_prompt=user_prompt,
        )
        generation_ms = round((time.perf_counter() - gen_start) * 1000, 1)

        insufficient, cleaned_answer = detect_insufficient_context(raw_answer)
        cleaned_answer = normalize_citation_markers(cleaned_answer)
        cleaned_answer = strip_followup_label_prefixes(cleaned_answer)
        verified_citations = extract_verified_citations(cleaned_answer, retrieved_chunks)

        logger.info(
            "rag_question_answered mode=%s docs=%d chunks_retrieved=%d citations_verified=%d "
            "insufficient_context=%s retrieval_ms=%s generation_ms=%s",
            mode.value,
            len(scoped_doc_ids),
            len(retrieved_chunks),
            len(verified_citations),
            insufficient,
            retrieval_ms,
            generation_ms,
        )

        return RagAnswerResult(
            answer_text=cleaned_answer,
            insufficient_context=insufficient,
            citations=verified_citations,
        )

    async def _retrieve_context_chunks(
        self,
        *,
        owner_session_id: str,
        scoped_doc_ids: list[UUID],
        question: str,
        mode: ChatMode,
        selection: SelectionInput | None,
    ) -> list[RetrievedChunkRecord]:
        """Combine surrounding page chunks (for `selection_qa`) with top-k vector search."""
        merged: list[RetrievedChunkRecord] = []
        seen_chunk_ids: set[UUID] = set()

        if mode == ChatMode.SELECTION_QA and selection is not None:
            surrounding = await self._document_repo.get_surrounding_chunks(
                document_id=scoped_doc_ids[0],
                owner_session_id=owner_session_id,
                page_number=selection.page_number,
                window=self._surrounding_window,
            )
            for chunk in surrounding:
                if chunk.chunk_id not in seen_chunk_ids:
                    seen_chunk_ids.add(chunk.chunk_id)
                    merged.append(chunk)

        query_text = (
            f"{selection.selected_text}\n\nQuestion: {question}"
            if (mode == ChatMode.SELECTION_QA and selection is not None)
            else question
        )
        query_vector = await self._embedding_provider.embed_query(query_text)
        vector_matches = await self._document_repo.search_similar_chunks(
            owner_session_id=owner_session_id,
            query_embedding=query_vector,
            document_ids=scoped_doc_ids,
            embedding_model=self._embedding_model_name,
            top_k=self._top_k,
        )
        for chunk in vector_matches:
            if chunk.chunk_id not in seen_chunk_ids and len(merged) < self._top_k:
                seen_chunk_ids.add(chunk.chunk_id)
                merged.append(chunk)

        return merged
