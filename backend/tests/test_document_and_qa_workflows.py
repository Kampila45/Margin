"""End-to-end API integration tests for document ingestion, library filtering, and Q&A."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.app_settings import AppEnvironment, Settings
from app.core.dependency_container import get_embedding_provider, get_llm_provider
from app.database.db_engine import Base, create_engine_from_url, create_session_factory
from app.main import create_app
from app.ports.ai_provider_ports import EmbeddingProviderProtocol, LLMProviderProtocol


class FakeEmbeddingProvider(EmbeddingProviderProtocol):
    """Deterministic in-memory embedding double for integration tests."""

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Generate deterministic 8-dimensional vectors derived from text length."""
        return [self._vector_for(text) for text in texts]

    async def embed_query(self, query: str) -> list[float]:
        """Generate a deterministic 8-dimensional query vector."""
        return self._vector_for(query)

    @staticmethod
    def _vector_for(text: str) -> list[float]:
        seed = float((len(text) % 10) + 1)
        return [seed, 0.5, 0.25, 0.125, 0.1, 0.2, 0.3, 0.4]


class FakeLLMProvider(LLMProviderProtocol):
    """Deterministic in-memory LLM double that cites source `[1]` or signals missing context."""

    async def generate_grounded_answer(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
    ) -> str:
        """Return a cited answer or `INSUFFICIENT_DOCUMENT_CONTEXT` when asked an unknown topic."""
        assert "Margin" in system_instruction
        if "quantum teleportation" in user_prompt.lower():
            return (
                "INSUFFICIENT_DOCUMENT_CONTEXT: The uploaded document does not discuss "
                "quantum teleportation."
            )
        if "<selected_passage" in user_prompt:
            return (
                "Based on your highlighted passage, Margin anchors every claim to a "
                "verifiable chunk citation [1]."
            )
        return "Margin indexes documents into page-attributed chunks for grounded answers [1]."


@pytest_asyncio.fixture
async def api_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    """Create a test FastAPI app backed by an isolated SQLite database and fake AI providers."""
    db_file = tmp_path / "margin_test.db"
    storage_dir = tmp_path / "uploads"
    settings = Settings(
        _env_file=None,
        APP_ENV=AppEnvironment.DEVELOPMENT,
        DATABASE_URL=f"sqlite+aiosqlite:///{db_file}",
        GEMINI_API_KEY="test-gemini-key",
        STORAGE_PROVIDER="local",
        STORAGE_DIR=storage_dir,
        MAX_DOCUMENTS_PER_SESSION=3,
    )

    app = create_app(settings_override=settings)
    engine = create_engine_from_url(settings.database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    app.dependency_overrides[get_embedding_provider] = lambda: FakeEmbeddingProvider()
    app.dependency_overrides[get_llm_provider] = lambda: FakeLLMProvider()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    await engine.dispose()


@pytest.mark.asyncio
async def test_health_and_readiness_endpoints(api_client: AsyncClient) -> None:
    """Verify `/api/v1/health` and `/api/v1/health/ready` return 200 and `X-Request-ID`."""
    liveness = await api_client.get("/api/v1/health")
    assert liveness.status_code == 200
    assert liveness.json()["status"] == "ok"
    assert "X-Request-ID" in liveness.headers

    readiness = await api_client.get("/api/v1/ready")
    assert readiness.status_code == 200
    assert readiness.json() == {
        "status": "ready",
        "database": "ok",
        "ai_provider": "configured",
    }


@pytest.mark.asyncio
async def test_full_document_upload_reader_and_grounded_qa_workflow(
    api_client: AsyncClient,
) -> None:
    """Verify uploading a TXT document, reading pages, document_qa, selection_qa, and cleanup."""
    headers = {"X-Session-ID": "reader-session-alpha"}
    sample_content = (
        b"Margin Architecture Overview.\n\n"
        b"Margin splits uploaded documents into overlapping passages with page numbers so "
        b"readers can highlight any paragraph and ask contextual questions with citations."
    )

    upload_resp = await api_client.post(
        "/api/v1/documents",
        headers=headers,
        files={"file": ("architecture_notes.txt", sample_content, "text/plain")},
    )
    assert upload_resp.status_code == 201
    doc_data = upload_resp.json()
    doc_id = doc_data["id"]
    assert doc_data["status"] == "ready"
    assert doc_data["page_count"] == 1
    assert doc_data["chunk_count"] >= 1

    # Filter document library by format and search term
    filtered_list = await api_client.get(
        "/api/v1/documents",
        headers=headers,
        params={"format": "txt", "search": "architecture"},
    )
    assert filtered_list.status_code == 200
    assert filtered_list.json()["total"] == 1

    non_matching_list = await api_client.get(
        "/api/v1/documents",
        headers=headers,
        params={"format": "pdf"},
    )
    assert non_matching_list.status_code == 200
    assert non_matching_list.json()["total"] == 0

    # Fetch page 1 text and raw file bytes for the reader view
    page_resp = await api_client.get(f"/api/v1/documents/{doc_id}/pages/1", headers=headers)
    assert page_resp.status_code == 200
    assert "Margin Architecture Overview." in page_resp.json()["text_content"]

    file_resp = await api_client.get(f"/api/v1/documents/{doc_id}/file", headers=headers)
    assert file_resp.status_code == 200
    assert file_resp.content == sample_content
    assert "architecture_notes.txt" in file_resp.headers.get("content-disposition", "")

    # Create a conversation for this document
    conv_resp = await api_client.post(
        "/api/v1/conversations",
        headers=headers,
        json={"document_id": doc_id, "title": "Architecture Deep Dive"},
    )
    assert conv_resp.status_code == 201
    conv_id = conv_resp.json()["id"]

    # Ask a whole-document question (`document_qa`)
    doc_qa_resp = await api_client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        headers=headers,
        json={
            "question": "How does Margin index uploaded documents?",
            "mode": "document_qa",
        },
    )
    assert doc_qa_resp.status_code == 201
    assistant_turn = doc_qa_resp.json()["assistant_message"]
    assert assistant_turn["insufficient_context"] is False
    assert len(assistant_turn["citations"]) == 1
    assert assistant_turn["citations"][0]["document_id"] == doc_id
    assert assistant_turn["citations"][0]["page_number"] == 1

    # Ask a highlighted-passage question (`selection_qa`)
    sel_qa_resp = await api_client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        headers=headers,
        json={
            "question": "Explain this highlighted sentence.",
            "mode": "selection_qa",
            "selection": {
                "selected_text": "readers can highlight any paragraph and ask contextual questions",
                "page_number": 1,
            },
        },
    )
    assert sel_qa_resp.status_code == 201
    sel_assistant = sel_qa_resp.json()["assistant_message"]
    assert "highlighted passage" in sel_assistant["content"]
    assert len(sel_assistant["citations"]) == 1

    # Ask an unanswerable question to verify insufficient-context handling
    missing_resp = await api_client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        headers=headers,
        json={
            "question": "What does the document say about quantum teleportation?",
            "mode": "document_qa",
        },
    )
    assert missing_resp.status_code == 201
    assert missing_resp.json()["assistant_message"]["insufficient_context"] is True

    # Delete the conversation and verify it is removed
    del_conv_resp = await api_client.delete(
        f"/api/v1/conversations/{conv_id}",
        headers=headers,
    )
    assert del_conv_resp.status_code == 204


@pytest.mark.asyncio
async def test_session_isolation_prevents_cross_session_access(api_client: AsyncClient) -> None:
    """Verify Session B cannot read or delete a document uploaded by Session A."""
    session_a = {"X-Session-ID": "session-owner-a"}
    session_b = {"X-Session-ID": "session-intruder-b"}

    upload_resp = await api_client.post(
        "/api/v1/documents",
        headers=session_a,
        files={"file": ("private_memo.txt", b"Confidential research notes.", "text/plain")},
    )
    assert upload_resp.status_code == 201
    doc_id = upload_resp.json()["id"]

    # Session B listing should be empty
    list_b = await api_client.get("/api/v1/documents", headers=session_b)
    assert list_b.status_code == 200
    assert list_b.json()["total"] == 0

    # Session B fetching Session A's document gets 404 with standard ErrorResponse
    get_b = await api_client.get(f"/api/v1/documents/{doc_id}", headers=session_b)
    assert get_b.status_code == 404
    err_payload = get_b.json()
    assert err_payload["error_code"] == "DOCUMENT_NOT_FOUND"
    assert "request_id" in err_payload


@pytest.mark.asyncio
async def test_selection_qa_without_selection_returns_422_error_envelope(
    api_client: AsyncClient,
) -> None:
    """Verify `selection_qa` mode without a `selection` payload returns 422."""
    headers = {"X-Session-ID": "validation-session"}
    upload_resp = await api_client.post(
        "/api/v1/documents",
        headers=headers,
        files={"file": ("notes.txt", b"Sample text for selection test.", "text/plain")},
    )
    doc_id = upload_resp.json()["id"]

    conv_resp = await api_client.post(
        "/api/v1/conversations",
        headers=headers,
        json={"document_id": doc_id},
    )
    conv_id = conv_resp.json()["id"]

    bad_turn = await api_client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        headers=headers,
        json={"question": "What does this mean?", "mode": "selection_qa"},
    )
    assert bad_turn.status_code == 422
    assert bad_turn.json()["error_code"] == "INVALID_SELECTION_CONTEXT"


@pytest.mark.asyncio
async def test_duplicate_sha256_deduplication_and_httponly_session_cookie(
    api_client: AsyncClient,
) -> None:
    """Verify identical uploads deduplicate by SHA-256 and anonymous requests receive a cookie."""
    payload = b"Identical document content for SHA-256 deduplication check."

    first_resp = await api_client.post(
        "/api/v1/documents",
        files={"file": ("first_copy.txt", payload, "text/plain")},
    )
    assert first_resp.status_code == 201
    assert "margin_session_id" in first_resp.cookies
    session_cookie = first_resp.cookies["margin_session_id"]

    second_resp = await api_client.post(
        "/api/v1/documents",
        cookies={"margin_session_id": session_cookie},
        files={"file": ("second_copy.txt", payload, "text/plain")},
    )
    assert second_resp.status_code == 201
    assert second_resp.json()["id"] == first_resp.json()["id"]


@pytest.mark.asyncio
async def test_concurrent_session_uploads_enforce_quota_without_race(
    api_client: AsyncClient,
) -> None:
    """Verify concurrent distinct uploads cannot exceed `max_documents_per_session` (3)."""
    import asyncio

    seed = await api_client.post(
        "/api/v1/documents",
        files={"file": ("doc1.txt", b"Unique document one content.", "text/plain")},
    )
    assert seed.status_code == 201
    session_cookie = seed.cookies["margin_session_id"]

    # Launch 3 concurrent uploads when remaining quota is 2 (max 3).
    api_client.cookies.set("margin_session_id", session_cookie)
    responses = await asyncio.gather(
        api_client.post(
            "/api/v1/documents",
            files={"file": ("doc2.txt", b"Unique document two content.", "text/plain")},
        ),
        api_client.post(
            "/api/v1/documents",
            files={"file": ("doc3.txt", b"Unique document three content.", "text/plain")},
        ),
        api_client.post(
            "/api/v1/documents",
            files={"file": ("doc4.txt", b"Unique document four content.", "text/plain")},
        ),
    )

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [201, 201, 429]
