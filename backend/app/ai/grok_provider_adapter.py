"""Groq & xAI Grok REST API adapter for grounded text and SQL generation."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from http import HTTPStatus
from typing import Any

import httpx

from app.core.app_telemetry import log_service_error
from app.core.domain_exceptions import ErrorCode, ProviderUnavailableError
from app.ports.ai_provider_ports import LLMResponsePayload, ToolCallPayload

logger = logging.getLogger(__name__)

_DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1"
_DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1"

_RETRYABLE_STATUS_CODES = {
    HTTPStatus.TOO_MANY_REQUESTS,
    HTTPStatus.BAD_GATEWAY,
    HTTPStatus.SERVICE_UNAVAILABLE,
    HTTPStatus.GATEWAY_TIMEOUT,
}


def _resolve_provider_endpoints(
    api_key: str,
    model_name: str,
    base_url: str,
) -> tuple[str, str]:
    """Auto-detect whether key is Groq (gsk_...) or xAI Grok (xai-...)."""
    key = api_key.strip()
    # Groq keys always start with gsk_
    if key.startswith("gsk_"):
        resolved_base = (
            _DEFAULT_GROQ_BASE_URL
            if base_url in (_DEFAULT_GROK_BASE_URL, "")
            else base_url.rstrip("/")
        )
        resolved_model = (
            "openai/gpt-oss-120b"
            if model_name in ("grok-2-latest", "grok-beta", "llama-3.3-70b-versatile", "")
            else model_name
        )
        return resolved_base, resolved_model

    # Default to xAI Grok
    resolved_base = base_url.rstrip("/") if base_url else _DEFAULT_GROK_BASE_URL
    resolved_model = model_name if model_name else "grok-2-latest"
    return resolved_base, resolved_model


class GroqLLMProvider:
    """Generate grounded answers and SQL queries via Groq (LPU) or xAI Grok APIs."""

    def __init__(
        self,
        *,
        api_key: str,
        model_name: str = "grok-2-latest",
        base_url: str = _DEFAULT_GROK_BASE_URL,
        timeout_seconds: float = 30.0,
        http_client: httpx.AsyncClient | None = None,
        max_retries: int = 2,
    ) -> None:
        self._api_key = api_key.strip()
        resolved_base, resolved_model = _resolve_provider_endpoints(
            self._api_key,
            model_name.strip(),
            base_url,
        )
        self._base_url = resolved_base
        self._model_name = resolved_model
        self._timeout_seconds = timeout_seconds
        self._http_client = http_client
        self._max_retries = max_retries

    def _require_api_key(self) -> None:
        if not self._api_key:
            raise ProviderUnavailableError(
                "The AI assistant is not yet configured. "
                "Please set GROQ_API_KEY or XAI_API_KEY in your environment."
            )

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str = "auto",
        temperature: float = 0.1,
        max_tokens: int = 1500,
    ) -> LLMResponsePayload:
        """Call Groq / xAI chat completions with optional OpenAI-format tool definitions."""
        self._require_api_key()
        started = time.perf_counter()

        url = f"{self._base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {
            "model": self._model_name,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice

        last_exc: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                if self._http_client is not None:
                    response = await self._http_client.post(
                        url,
                        headers=headers,
                        json=payload,
                        timeout=self._timeout_seconds,
                    )
                else:
                    async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                        response = await client.post(
                            url,
                            headers=headers,
                            json=payload,
                        )

                if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self._max_retries:
                    backoff_seconds = 0.25 * (2**attempt)
                    await asyncio.sleep(backoff_seconds)
                    continue

                if response.status_code != HTTPStatus.OK:
                    if (
                        response.status_code == HTTPStatus.BAD_REQUEST
                        and "Tool choice is none" in response.text
                    ):
                        try:
                            err_json = response.json().get("error", {})
                            failed_gen = err_json.get("failed_generation", "")
                            parsed_call = json.loads(failed_gen)
                            call_name = parsed_call.get("name", "")
                            call_args = parsed_call.get("arguments", {})
                            args_str = (
                                json.dumps(call_args)
                                if isinstance(call_args, dict)
                                else str(call_args)
                            )
                            return LLMResponsePayload(
                                content="",
                                tool_calls=[
                                    ToolCallPayload(
                                        id="call_groq_fallback",
                                        name=call_name,
                                        arguments_json=args_str,
                                    )
                                ],
                            )
                        except Exception:
                            pass

                    log_service_error(
                        logger,
                        "llm_generation_http_error",
                        error_code=ErrorCode.PROVIDER_UNAVAILABLE.value,
                        exc_info=False,
                        upstream_status=response.status_code,
                        model=self._model_name,
                        endpoint=url,
                        response_text=response.text[:200],
                    )
                    raise ProviderUnavailableError(
                        "The AI assistant is temporarily unavailable. "
                        "Please try asking again shortly."
                    )

                data = response.json()
                choices = data.get("choices", [])
                if not choices:
                    raise ProviderUnavailableError(
                        "We couldn't generate an answer for that question. Please try rephrasing."
                    )

                message = choices[0].get("message", {})
                raw_tool_calls = message.get("tool_calls") or []
                tool_calls_payload: list[ToolCallPayload] = []
                for tc in raw_tool_calls:
                    fn = tc.get("function") or {}
                    tool_calls_payload.append(
                        ToolCallPayload(
                            id=str(tc.get("id", "")),
                            name=str(fn.get("name", "")),
                            arguments_json=str(fn.get("arguments", "{}")),
                        )
                    )

                usage = data.get("usage", {})
                duration_ms = round((time.perf_counter() - started) * 1000, 1)
                logger.info(
                    "llm_completion_completed model=%s prompt_tokens=%s completion_tokens=%s "
                    "total_tokens=%s duration_ms=%s tool_calls=%s",
                    self._model_name,
                    usage.get("prompt_tokens", 0),
                    usage.get("completion_tokens", 0),
                    usage.get("total_tokens", 0),
                    duration_ms,
                    len(tool_calls_payload),
                )
                return LLMResponsePayload(
                    content=message.get("content"),
                    tool_calls=tool_calls_payload,
                )

            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt < self._max_retries:
                    backoff_seconds = 0.25 * (2**attempt)
                    await asyncio.sleep(backoff_seconds)
                    continue
                log_service_error(
                    logger,
                    "llm_generation_transport_error",
                    error_code=ErrorCode.PROVIDER_UNAVAILABLE.value,
                    attempts=attempt + 1,
                )
                raise ProviderUnavailableError(
                    "The AI assistant is temporarily unavailable. Please try asking again shortly."
                ) from exc

        raise ProviderUnavailableError(
            "The AI assistant is temporarily unavailable. Please try asking again shortly."
        ) from last_exc

    async def generate_grounded_answer(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
    ) -> str:
        """Call Groq / xAI chat completions with temperature=0.1 for faithful grounding."""
        messages = [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_prompt},
        ]
        response = await self.chat_completion(messages=messages)
        content = (response.content or "").strip()
        if not content:
            raise ProviderUnavailableError(
                "We couldn't generate an answer for that question. Please try rephrasing."
            )
        return content


# Backward compatibility alias
GrokLLMProvider = GroqLLMProvider
