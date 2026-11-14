"""Unit tests for DocumentAgentService and autonomous multi-hop document retrieval."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.database.document_repository import DocumentRepository, RetrievedChunkRecord
from app.ports.ai_provider_ports import (
    EmbeddingProviderProtocol,
    LLMProviderProtocol,
    LLMResponsePayload,
    ToolCallPayload,
)
from app.rag.document_agent_service import DocumentAgentService


class MockEmbeddingProvider(EmbeddingProviderProtocol):
    """Mock embedding provider returning deterministic unit vectors."""

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.1] * 8 for _ in texts]

    async def embed_query(self, query: str) -> list[float]:
        return [0.1] * 8


class MockDocLLMProvider(LLMProviderProtocol):
    """Mock LLM returning scripted tool calls and final answers."""

    def __init__(self, turns: list[LLMResponsePayload]) -> None:
        self._turns = list(turns)

    async def generate_grounded_answer(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
    ) -> str:
        return "Legacy answer"

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str = "auto",
        temperature: float = 0.1,
        max_tokens: int = 1500,
    ) -> LLMResponsePayload:
        if self._turns:
            return self._turns.pop(0)
        return LLMResponsePayload(content="Final default prose.")


class MockDocumentRepository(DocumentRepository):
    """In-memory mock document repository for isolated agent testing."""

    def __init__(self, chunks: list[RetrievedChunkRecord]) -> None:
        self._chunks = chunks

    async def get_many_for_session(
        self,
        document_ids: Any,
        owner_session_id: str,
    ) -> list[Any]:
        return []

    async def search_similar_chunks(
        self,
        *,
        owner_session_id: str,
        query_embedding: list[float],
        document_ids: Any,
        embedding_model: str | None = None,
        top_k: int = 6,
    ) -> list[RetrievedChunkRecord]:
        return [c for c in self._chunks if c.document_id in document_ids][:top_k]

    async def list_chunks_for_page(
        self,
        document_id: UUID,
        page_number: int,
        *,
        owner_session_id: str,
    ) -> list[Any]:
        return [
            c for c in self._chunks if c.document_id == document_id and c.page_number == page_number
        ]


@pytest.mark.asyncio
async def test_document_agent_searches_passages_and_returns_verified_citations():
    """Verify DocumentAgent invokes search_document_passages and extracts verified citations."""
    doc_id = uuid4()
    chunk_1 = RetrievedChunkRecord(
        chunk_id=uuid4(),
        document_id=doc_id,
        document_filename="Annual_Report.pdf",
        chunk_index=0,
        page_number=3,
        text_content="Total revenue grew by 24% to $120 million in fiscal year 2024.",
        score=0.92,
    )

    mock_repo = MockDocumentRepository(chunks=[chunk_1])
    mock_embed = MockEmbeddingProvider()

    mock_llm = MockDocLLMProvider(
        turns=[
            # Round 1: Model calls search_document_passages
            LLMResponsePayload(
                tool_calls=[
                    ToolCallPayload(
                        id="call_search_1",
                        name="search_document_passages",
                        arguments_json=json.dumps({"query": "revenue growth fiscal year 2024"}),
                    )
                ]
            ),
            # Round 2: Model answers citing [1]
            LLMResponsePayload(
                content="Total revenue for 2024 grew by 24% reaching $120 million [1]."
            ),
        ]
    )

    agent_service = DocumentAgentService(
        document_repo=mock_repo,
        embedding_provider=mock_embed,
        llm_provider=mock_llm,
    )

    result = await agent_service.run_document_agent(
        owner_session_id="session-user-bob",
        scoped_doc_ids=[doc_id],
        filenames_by_id={doc_id: "Annual_Report.pdf"},
        question="What was the revenue growth for 2024?",
    )

    assert "Total revenue for 2024 grew by 24%" in result.answer_text
    assert not result.insufficient_context
    assert len(result.citations) == 1
    assert result.citations[0].citation_index == 1
    assert result.citations[0].page_number == 3
    assert result.citations[0].document_filename == "Annual_Report.pdf"
    assert result.steps_taken == 1


@pytest.mark.asyncio
async def test_document_agent_detects_insufficient_context():
    """Verify DocumentAgent detects insufficient context when passages do not contain facts."""
    doc_id = uuid4()
    mock_repo = MockDocumentRepository(chunks=[])
    mock_embed = MockEmbeddingProvider()

    mock_llm = MockDocLLMProvider(
        turns=[
            LLMResponsePayload(
                tool_calls=[
                    ToolCallPayload(
                        id="call_search_empty",
                        name="search_document_passages",
                        arguments_json=json.dumps({"query": "quantum computing breakthroughs"}),
                    )
                ]
            ),
            LLMResponsePayload(
                content="The document does not contain information about quantum computing."
            ),
        ]
    )

    agent_service = DocumentAgentService(
        document_repo=mock_repo,
        embedding_provider=mock_embed,
        llm_provider=mock_llm,
    )

    result = await agent_service.run_document_agent(
        owner_session_id="session-user-bob",
        scoped_doc_ids=[doc_id],
        filenames_by_id={doc_id: "Annual_Report.pdf"},
        question="What are the quantum computing breakthroughs?",
    )

    assert result.insufficient_context is True
    assert len(result.citations) == 0


@pytest.mark.asyncio
async def test_document_agent_assigns_deterministic_citation_indices_to_tool_outputs() -> None:
    """Verify tool outputs include explicit 1-based `citation_index` tags matching citations."""
    doc_id = uuid4()
    chunk_1 = RetrievedChunkRecord(
        chunk_id=uuid4(),
        document_id=doc_id,
        document_filename="Cover_Letter.docx",
        chunk_index=0,
        page_number=1,
        text_content="Applicant is Nyasha Kampila applying for Senior Systems Analyst.",
        score=0.95,
    )
    chunk_2 = RetrievedChunkRecord(
        chunk_id=uuid4(),
        document_id=doc_id,
        document_filename="Cover_Letter.docx",
        chunk_index=1,
        page_number=1,
        text_content="Highlights Azure Serverless Functions and Python AI SQL Copilot.",
        score=0.89,
    )

    recorded_tool_outputs: list[str] = []

    class RecordingDocLLM(MockDocLLMProvider):
        async def chat_completion(
            self,
            *,
            messages: list[dict[str, Any]],
            tools: list[dict[str, Any]] | None = None,
            tool_choice: str = "auto",
            temperature: float = 0.1,
            max_tokens: int = 1500,
        ) -> LLMResponsePayload:
            for msg in messages:
                if msg.get("role") == "tool" and isinstance(msg.get("content"), str):
                    recorded_tool_outputs.append(msg["content"])
            return await super().chat_completion(
                messages=messages,
                tools=tools,
                tool_choice=tool_choice,
                temperature=temperature,
                max_tokens=max_tokens,
            )

    mock_llm = RecordingDocLLM(
        turns=[
            LLMResponsePayload(
                tool_calls=[
                    ToolCallPayload(
                        id="call_search_multi",
                        name="search_document_passages",
                        arguments_json=json.dumps({"query": "applicant overview"}),
                    )
                ]
            ),
            LLMResponsePayload(
                content=(
                    "The letter is from Nyasha Kampila [1] highlighting Azure and Python work [2]."
                )
            ),
        ]
    )

    agent_service = DocumentAgentService(
        document_repo=MockDocumentRepository(chunks=[chunk_1, chunk_2]),
        embedding_provider=MockEmbeddingProvider(),
        llm_provider=mock_llm,
    )

    result = await agent_service.run_document_agent(
        owner_session_id="session-user-bob",
        scoped_doc_ids=[doc_id],
        filenames_by_id={doc_id: "Cover_Letter.docx"},
        question="What can you tell me about this document?",
    )

    assert len(recorded_tool_outputs) == 1
    parsed_tool_output = json.loads(recorded_tool_outputs[0])
    assert parsed_tool_output["passages"][0]["citation_index"] == 1
    assert parsed_tool_output["passages"][1]["citation_index"] == 2
    assert 'citation_index="1"' in parsed_tool_output["passages"][0]["text"]
    assert 'citation_index="2"' in parsed_tool_output["passages"][1]["text"]
    assert [c.citation_index for c in result.citations] == [1, 2]
    assert result.citations[0].chunk_id == chunk_1.chunk_id
    assert result.citations[1].chunk_id == chunk_2.chunk_id
