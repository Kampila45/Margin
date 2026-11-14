"""Structural protocols for embedding and language model providers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class ToolCallPayload:
    """Normalized tool call emitted by an LLM."""

    id: str
    name: str
    arguments_json: str


@dataclass(frozen=True, slots=True)
class LLMResponsePayload:
    """Normalized response payload from an LLM chat completion."""

    content: str | None = None
    tool_calls: list[ToolCallPayload] = field(default_factory=list)


@runtime_checkable
class EmbeddingProviderProtocol(Protocol):
    """Port interface for generating vector embeddings from text passages and queries."""

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Generate vector embeddings for a batch of document chunk texts."""
        ...

    async def embed_query(self, query: str) -> list[float]:
        """Generate a vector embedding for a user search or question string."""
        ...


@runtime_checkable
class LLMProviderProtocol(Protocol):
    """Port interface for grounded text generation from an AI model."""

    async def generate_grounded_answer(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
    ) -> str:
        """Generate an answer strictly following `system_instruction` and `user_prompt`."""
        ...

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str = "auto",
        temperature: float = 0.1,
        max_tokens: int = 1500,
    ) -> LLMResponsePayload:
        """Send chat messages with optional tool definitions, returning normalized payload."""
        ...
