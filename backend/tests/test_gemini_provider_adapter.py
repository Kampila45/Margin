"""Unit tests for Google Gemini embedding and generation adapters using mocked HTTP transport."""

from __future__ import annotations

import httpx
import pytest

from app.ai.gemini_provider_adapter import GeminiEmbeddingProvider, GeminiLLMProvider
from app.core.domain_exceptions import ProviderUnavailableError


@pytest.mark.asyncio
async def test_gemini_embedding_provider_parses_batch_embeddings() -> None:
    """Verify `GeminiEmbeddingProvider` sends expected payload and parses returned vectors."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert "batchEmbedContents" in str(request.url)
        assert request.headers.get("x-goog-api-key") == "test-key"
        assert "key" not in request.url.params
        return httpx.Response(
            200,
            json={
                "embeddings": [
                    {"values": [0.25, 0.5, 0.75]},
                    {"values": [0.1, 0.2, 0.3]},
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = GeminiEmbeddingProvider(
            api_key="test-key",
            output_dimensionality=3,
            http_client=client,
        )
        vectors = await provider.embed_documents(["first chunk", "second chunk"])

    assert vectors == [[0.25, 0.5, 0.75], [0.1, 0.2, 0.3]]


@pytest.mark.asyncio
async def test_gemini_llm_provider_raises_provider_unavailable_on_503() -> None:
    """Verify upstream non-200 responses raise `ProviderUnavailableError`."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": {"message": "Service overloaded"}})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = GeminiLLMProvider(
            api_key="test-key",
            http_client=client,
            max_retries=0,
        )
        with pytest.raises(ProviderUnavailableError, match="temporarily unavailable"):
            await provider.generate_grounded_answer(
                system_instruction="Cite sources.",
                user_prompt="What is the conclusion?",
            )


@pytest.mark.asyncio
async def test_gemini_llm_provider_retries_transient_429_and_succeeds() -> None:
    """Verify transient HTTP 429 rate-limit responses are retried automatically."""
    attempts = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, json={"error": {"message": "Rate limit"}})
        return httpx.Response(
            200,
            json={
                "candidates": [{"content": {"parts": [{"text": "Recovered answer [1]."}]}}],
                "usageMetadata": {
                    "promptTokenCount": 40,
                    "candidatesTokenCount": 6,
                    "totalTokenCount": 46,
                },
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = GeminiLLMProvider(
            api_key="test-key",
            http_client=client,
            max_retries=1,
        )
        answer = await provider.generate_grounded_answer(
            system_instruction="Cite sources.",
            user_prompt="What is the conclusion?",
        )

    assert attempts == 2
    assert answer == "Recovered answer [1]."


@pytest.mark.asyncio
async def test_gemini_chat_completion_forwards_generation_params_and_rejects_tools() -> None:
    """Verify `chat_completion` honors temperature/max_tokens and rejects tool definitions."""
    import json

    captured_payload: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "Direct reply."}]}}]},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = GeminiLLMProvider(api_key="test-key", http_client=client)
        res = await provider.chat_completion(
            messages=[
                {"role": "system", "content": "Be terse."},
                {"role": "user", "content": "Hi"},
            ],
            temperature=0.4,
            max_tokens=321,
        )
        assert res.content == "Direct reply."
        gen_cfg = captured_payload["generationConfig"]
        assert gen_cfg == {"temperature": 0.4, "maxOutputTokens": 321}

        with pytest.raises(NotImplementedError):
            await provider.chat_completion(
                messages=[{"role": "user", "content": "Hi"}],
                tools=[{"type": "function", "function": {"name": "search"}}],
            )
