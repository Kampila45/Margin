"""Google Gemini REST API adapters for embeddings and grounded text generation."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from http import HTTPStatus
from typing import Any

import httpx

from app.core.app_telemetry import log_service_error
from app.core.domain_exceptions import ErrorCode, ProviderUnavailableError
from app.ports.ai_provider_ports import LLMResponsePayload

logger = logging.getLogger(__name__)

_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
_RETRYABLE_STATUS_CODES = {
    HTTPStatus.TOO_MANY_REQUESTS,
    HTTPStatus.BAD_GATEWAY,
    HTTPStatus.SERVICE_UNAVAILABLE,
    HTTPStatus.GATEWAY_TIMEOUT,
}


async def _post_with_retry(
    *,
    url: str,
    api_key: str,
    payload: dict[str, Any],
    timeout_seconds: float,
    http_client: httpx.AsyncClient | None,
    operation_name: str,
    max_retries: int = 2,
) -> httpx.Response:
    """Execute a Gemini REST POST request with bounded exponential backoff on transient failures."""
    last_exc: Exception | None = None
    headers = {"x-goog-api-key": api_key}
    client_ctx = (
        contextlib.nullcontext(http_client)
        if http_client is not None
        else httpx.AsyncClient(timeout=timeout_seconds)
    )

    async with client_ctx as client:
        for attempt in range(max_retries + 1):
            try:
                response = await client.post(
                    url,
                    headers=headers,
                    json=payload,
                    timeout=timeout_seconds,
                )

                if response.status_code in _RETRYABLE_STATUS_CODES and attempt < max_retries:
                    backoff_seconds = 0.25 * (2**attempt)
                    await asyncio.sleep(backoff_seconds)
                    continue

                return response

            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt < max_retries:
                    backoff_seconds = 0.25 * (2**attempt)
                    await asyncio.sleep(backoff_seconds)
                    continue
                log_service_error(
                    logger,
                    f"{operation_name}_transport_error",
                    error_code=ErrorCode.PROVIDER_UNAVAILABLE.value,
                    attempts=attempt + 1,
                )
                raise ProviderUnavailableError(
                    "The AI assistant is temporarily unavailable. Please try asking again shortly."
                ) from exc

    raise ProviderUnavailableError(
        "The AI assistant is temporarily unavailable. Please try asking again shortly."
    ) from last_exc


class GeminiEmbeddingProvider:
    """Generate document and query embeddings via the hosted Google Gemini API."""

    def __init__(
        self,
        *,
        api_key: str,
        model_name: str = "gemini-embedding-001",
        output_dimensionality: int = 768,
        timeout_seconds: float = 30.0,
        http_client: httpx.AsyncClient | None = None,
        max_retries: int = 2,
    ) -> None:
        self._api_key = api_key.strip()
        normalized_model = (
            "gemini-embedding-001"
            if model_name.strip() in {"text-embedding-004", "models/text-embedding-004"}
            else model_name.strip()
        )
        self._model_path = (
            normalized_model
            if normalized_model.startswith("models/")
            else f"models/{normalized_model}"
        )
        self._output_dimensionality = output_dimensionality
        self._timeout_seconds = timeout_seconds
        self._http_client = http_client
        self._max_retries = max_retries

    def _require_api_key(self) -> None:
        if not self._api_key:
            raise ProviderUnavailableError(
                "The reading assistant is not yet configured. Please try again shortly."
            )

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Batch-embed document chunks in groups of up to 100 texts per request."""
        if not texts:
            return []
        self._require_api_key()

        all_embeddings: list[list[float]] = []
        batch_size = 100
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            batch_vectors = await self._embed_batch(
                batch,
                task_type="RETRIEVAL_DOCUMENT",
            )
            all_embeddings.extend(batch_vectors)
        return all_embeddings

    async def embed_query(self, query: str) -> list[float]:
        """Embed a single user question for similarity search."""
        self._require_api_key()
        vectors = await self._embed_batch([query], task_type="RETRIEVAL_QUERY")
        if not vectors:
            raise ProviderUnavailableError("Gemini embedding provider returned no vector.")
        return vectors[0]

    async def _embed_batch(
        self,
        texts: list[str],
        *,
        task_type: str,
    ) -> list[list[float]]:
        started = time.perf_counter()
        url = f"{_GEMINI_API_BASE}/{self._model_path}:batchEmbedContents"
        payload: dict[str, Any] = {
            "requests": [
                {
                    "model": self._model_path,
                    "content": {"parts": [{"text": text}]},
                    "taskType": task_type,
                    "outputDimensionality": self._output_dimensionality,
                }
                for text in texts
            ]
        }

        response = await _post_with_retry(
            url=url,
            api_key=self._api_key,
            payload=payload,
            timeout_seconds=self._timeout_seconds,
            http_client=self._http_client,
            operation_name="gemini_embedding",
            max_retries=self._max_retries,
        )

        if response.status_code != HTTPStatus.OK:
            log_service_error(
                logger,
                "gemini_embedding_http_error",
                error_code=ErrorCode.PROVIDER_UNAVAILABLE.value,
                exc_info=False,
                upstream_status=response.status_code,
                batch_size=len(texts),
            )
            raise ProviderUnavailableError(
                "We couldn't finish preparing this document right now. Please try uploading again."
            )

        data = response.json()
        raw_embeddings = data.get("embeddings", [])
        vectors: list[list[float]] = []
        for item in raw_embeddings:
            values = item.get("values")
            if not isinstance(values, list) or not values:
                raise ProviderUnavailableError(
                    "We couldn't finish preparing this document right now. Please try again."
                )
            vectors.append([float(v) for v in values])

        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info(
            "gemini_embedding_completed model=%s task_type=%s batch_size=%d duration_ms=%s",
            self._model_path,
            task_type,
            len(texts),
            duration_ms,
        )
        return vectors


class GeminiLLMProvider:
    """Generate grounded answers with citations via the hosted Google Gemini API."""

    def __init__(
        self,
        *,
        api_key: str,
        model_name: str = "gemini-flash-latest",
        timeout_seconds: float = 30.0,
        http_client: httpx.AsyncClient | None = None,
        max_retries: int = 2,
    ) -> None:
        self._api_key = api_key.strip()
        self._model_path = (
            model_name if model_name.startswith("models/") else f"models/{model_name}"
        )
        self._timeout_seconds = timeout_seconds
        self._http_client = http_client
        self._max_retries = max_retries

    async def _discover_fallback_generation_model(self) -> str | None:
        """Query `/v1beta/models` to find an active `generateContent` model on 404."""
        url = f"{_GEMINI_API_BASE}/models"
        headers = {"x-goog-api-key": self._api_key}
        try:
            if self._http_client is not None:
                resp = await self._http_client.get(
                    url,
                    headers=headers,
                    timeout=self._timeout_seconds,
                )
            else:
                async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                    resp = await client.get(url, headers=headers)

            if resp.status_code != HTTPStatus.OK:
                return None

            models = resp.json().get("models", [])
            candidates: list[str] = []
            for item in models:
                name = str(item.get("name", ""))
                methods = item.get("supportedGenerationMethods", [])
                if (
                    name.startswith("models/gemini")
                    and isinstance(methods, list)
                    and "generateContent" in methods
                    and "embedding" not in name
                    and "imagen" not in name
                    and "veo" not in name
                    and "tts" not in name
                    and "audio" not in name
                ):
                    candidates.append(name)

            preferred_order = (
                "flash-latest",
                "3-flash",
                "2.5-flash",
                "2.0-flash",
                "flash",
                "pro",
            )
            for preferred_substr in preferred_order:
                for candidate in candidates:
                    if preferred_substr in candidate and candidate != self._model_path:
                        return candidate
            return candidates[0] if candidates else None
        except httpx.HTTPError:
            return None

    async def generate_grounded_answer(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
        temperature: float = 0.1,
        max_output_tokens: int = 1024,
    ) -> str:
        """Call Gemini `generateContent` with low temperature for faithful citation grounding."""
        if not self._api_key:
            raise ProviderUnavailableError(
                "The reading assistant is not yet configured. Please try again shortly."
            )

        started = time.perf_counter()
        url = f"{_GEMINI_API_BASE}/{self._model_path}:generateContent"
        payload: dict[str, Any] = {
            "systemInstruction": {
                "parts": [{"text": system_instruction}],
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_prompt}],
                }
            ],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
            },
        }

        response = await _post_with_retry(
            url=url,
            api_key=self._api_key,
            payload=payload,
            timeout_seconds=self._timeout_seconds,
            http_client=self._http_client,
            operation_name="gemini_generation",
            max_retries=self._max_retries,
        )

        # If the configured model identifier was retired or renamed upstream, auto-discover
        # an active `generateContent` Gemini model for this API key and retry once.
        if response.status_code == HTTPStatus.NOT_FOUND:
            fallback_model = await self._discover_fallback_generation_model()
            if fallback_model:
                logger.info(
                    "gemini_generation_model_fallback previous=%s discovered=%s",
                    self._model_path,
                    fallback_model,
                )
                self._model_path = fallback_model
                retry_url = f"{_GEMINI_API_BASE}/{self._model_path}:generateContent"
                response = await _post_with_retry(
                    url=retry_url,
                    api_key=self._api_key,
                    payload=payload,
                    timeout_seconds=self._timeout_seconds,
                    http_client=self._http_client,
                    operation_name="gemini_generation",
                    max_retries=self._max_retries,
                )

        if response.status_code != HTTPStatus.OK:
            log_service_error(
                logger,
                "gemini_generation_http_error",
                error_code=ErrorCode.PROVIDER_UNAVAILABLE.value,
                exc_info=False,
                upstream_status=response.status_code,
                model=self._model_path,
            )
            raise ProviderUnavailableError(
                "The AI assistant is temporarily unavailable. Please try asking again shortly."
            )

        data = response.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise ProviderUnavailableError(
                "We couldn't generate an answer for that question. Please try rephrasing."
            )
        parts = candidates[0].get("content", {}).get("parts", [])
        text_segments = [
            part.get("text", "") for part in parts if isinstance(part.get("text"), str)
        ]
        answer = "".join(text_segments).strip()
        if not answer:
            raise ProviderUnavailableError(
                "We couldn't generate an answer for that question. Please try rephrasing."
            )

        usage = data.get("usageMetadata", {})
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info(
            "gemini_generation_completed model=%s prompt_tokens=%s completion_tokens=%s "
            "total_tokens=%s duration_ms=%s",
            self._model_path,
            usage.get("promptTokenCount", 0),
            usage.get("candidatesTokenCount", 0),
            usage.get("totalTokenCount", 0),
            duration_ms,
        )
        return answer

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str = "auto",
        temperature: float = 0.1,
        max_tokens: int = 1500,
    ) -> LLMResponsePayload:
        """Provide a chat completion response matching `LLMProviderProtocol`."""
        if tools:
            raise NotImplementedError(
                "GeminiLLMProvider.chat_completion does not support OpenAI tool schemas; "
                "use GoogleModel via resolve_pydantic_model instead."
            )
        _ = tool_choice
        system_instruction = "\n".join(
            str(m.get("content", "")) for m in messages if m.get("role") == "system"
        )
        user_prompt = "\n\n".join(
            f"{m.get('role', 'user')}: {m.get('content', '')}"
            for m in messages
            if m.get("role") != "system"
        )
        content = await self.generate_grounded_answer(
            system_instruction=system_instruction or "You are a helpful assistant.",
            user_prompt=user_prompt,
            temperature=temperature,
            max_output_tokens=max_tokens,
        )
        return LLMResponsePayload(content=content, tool_calls=[])
