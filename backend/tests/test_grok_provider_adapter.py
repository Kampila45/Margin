"""Unit tests for xAI Grok generation adapter using mocked HTTP transport."""

from __future__ import annotations

import httpx
import pytest

from app.ai.grok_provider_adapter import GrokLLMProvider
from app.core.domain_exceptions import ProviderUnavailableError


@pytest.mark.asyncio
async def test_grok_llm_provider_generates_answer_with_openai_format() -> None:
    """Verify `GrokLLMProvider` sends OpenAI-compatible payload and parses completion response."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.x.ai/v1/chat/completions"
        assert request.headers.get("authorization") == "Bearer test-xai-key"
        payload = httpx.Response(200, content=request.content).json()
        assert payload["model"] == "grok-2-latest"
        assert payload["temperature"] == 0.1
        assert len(payload["messages"]) == 2
        assert payload["messages"][0]["role"] == "system"
        assert payload["messages"][0]["content"] == "You are a read-only SQL expert."
        assert payload["messages"][1]["role"] == "user"
        assert payload["messages"][1]["content"] == "Find top customers."

        mock_sql_json = (
            '{"sql": "SELECT name FROM customers LIMIT 10;", '
            '"explanation": "Queries top 10 customers."}'
        )
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test-123",
                "object": "chat.completion",
                "created": 1700000000,
                "model": "grok-2-latest",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": mock_sql_json,
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 50,
                    "completion_tokens": 25,
                    "total_tokens": 75,
                },
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = GrokLLMProvider(
            api_key="test-xai-key",
            model_name="grok-2-latest",
            http_client=client,
        )
        answer = await provider.generate_grounded_answer(
            system_instruction="You are a read-only SQL expert.",
            user_prompt="Find top customers.",
        )

    assert answer == (
        '{"sql": "SELECT name FROM customers LIMIT 10;", '
        '"explanation": "Queries top 10 customers."}'
    )


@pytest.mark.asyncio
async def test_grok_llm_provider_raises_on_missing_api_key() -> None:
    """Verify missing API key raises `ProviderUnavailableError` without making network calls."""
    provider = GrokLLMProvider(api_key="")
    with pytest.raises(ProviderUnavailableError, match="not yet configured"):
        await provider.generate_grounded_answer(
            system_instruction="system instruction",
            user_prompt="user question",
        )


@pytest.mark.asyncio
async def test_grok_llm_provider_retries_transient_429_and_succeeds() -> None:
    """Verify HTTP 429 rate limits are retried automatically."""
    attempts = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, json={"error": "Rate limit exceeded"})
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "Grok successfully answered after retry.",
                        }
                    }
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = GrokLLMProvider(
            api_key="test-xai-key",
            http_client=client,
            max_retries=1,
        )
        answer = await provider.generate_grounded_answer(
            system_instruction="system",
            user_prompt="prompt",
        )

    assert attempts == 2
    assert answer == "Grok successfully answered after retry."


@pytest.mark.asyncio
async def test_grok_llm_provider_raises_provider_unavailable_on_upstream_500() -> None:
    """Verify upstream server errors raise `ProviderUnavailableError`."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "Internal xAI error"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        provider = GrokLLMProvider(
            api_key="test-xai-key",
            http_client=client,
            max_retries=0,
        )
        with pytest.raises(ProviderUnavailableError, match="temporarily unavailable"):
            await provider.generate_grounded_answer(
                system_instruction="system",
                user_prompt="prompt",
            )
