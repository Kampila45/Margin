"""Resolve PydanticAI models from Margin LLM provider configuration or test doubles."""

from __future__ import annotations

import json
from typing import Any

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    ModelResponsePart,
    RetryPromptPart,
    SystemPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.groq import GroqProvider

from app.ai.gemini_provider_adapter import GeminiLLMProvider
from app.ai.grok_provider_adapter import GroqLLMProvider
from app.ports.ai_provider_ports import LLMProviderProtocol


def _normalize_groq_base_url(base_url: str) -> str:
    """Strip OpenAI path suffix since AsyncGroq appends `/openai/v1` internally."""
    cleaned = base_url.rstrip("/")
    if cleaned.endswith("/openai/v1"):
        return cleaned[: -len("/openai/v1")]
    return cleaned


def _to_openai_messages(
    messages: list[ModelMessage],
    instructions: str | None,
) -> list[dict[str, Any]]:
    """Convert PydanticAI message history into OpenAI chat message dictionaries."""
    openai_messages: list[dict[str, Any]] = []
    if instructions:
        openai_messages.append({"role": "system", "content": instructions})

    for msg in messages:
        if isinstance(msg, ModelRequest):
            for part in msg.parts:
                if isinstance(part, SystemPromptPart):
                    openai_messages.append({"role": "system", "content": part.content})
                elif isinstance(part, UserPromptPart):
                    text_content = (
                        part.content if isinstance(part.content, str) else str(part.content)
                    )
                    openai_messages.append({"role": "user", "content": text_content})
                elif isinstance(part, ToolReturnPart):
                    serialized = (
                        part.content
                        if isinstance(part.content, str)
                        else json.dumps(part.content, default=str)
                    )
                    openai_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": part.tool_call_id or "",
                            "content": serialized,
                        }
                    )
                elif isinstance(part, RetryPromptPart):
                    serialized_retry = (
                        part.content
                        if isinstance(part.content, str)
                        else json.dumps(part.content, default=str)
                    )
                    if part.tool_call_id:
                        openai_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": part.tool_call_id,
                                "content": serialized_retry,
                            }
                        )
                    else:
                        openai_messages.append({"role": "user", "content": serialized_retry})
        elif isinstance(msg, ModelResponse):
            text_segments: list[str] = []
            tool_calls_payload: list[dict[str, Any]] = []
            for resp_part in msg.parts:
                if isinstance(resp_part, TextPart) and resp_part.content:
                    text_segments.append(resp_part.content)
                elif isinstance(resp_part, ToolCallPart):
                    args_str = (
                        resp_part.args
                        if isinstance(resp_part.args, str)
                        else json.dumps(resp_part.args, default=str)
                    )
                    tool_calls_payload.append(
                        {
                            "id": resp_part.tool_call_id or "",
                            "type": "function",
                            "function": {
                                "name": resp_part.tool_name,
                                "arguments": args_str,
                            },
                        }
                    )
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": "\n".join(text_segments) if text_segments else None,
            }
            if tool_calls_payload:
                assistant_msg["tool_calls"] = tool_calls_payload
            openai_messages.append(assistant_msg)

    return openai_messages


def build_protocol_function_model(llm_provider: LLMProviderProtocol) -> FunctionModel:
    """Wrap any `LLMProviderProtocol` (test doubles or xAI Grok) in a PydanticAI `FunctionModel`."""

    async def _invoke_protocol(
        messages: list[ModelMessage],
        info: AgentInfo,
    ) -> ModelResponse:
        openai_messages = _to_openai_messages(messages, info.instructions)
        openai_tools = [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": tool.parameters_json_schema,
                },
            }
            for tool in info.function_tools
        ]
        temp = 0.1
        if info.model_settings and "temperature" in info.model_settings:
            raw_temp = info.model_settings["temperature"]
            if isinstance(raw_temp, (int, float)):
                temp = float(raw_temp)

        response = await llm_provider.chat_completion(
            messages=openai_messages,
            tools=openai_tools or None,
            temperature=temp,
        )

        parts: list[ModelResponsePart] = []
        if response.content:
            parts.append(TextPart(content=response.content))
        for tc in response.tool_calls:
            parts.append(
                ToolCallPart(
                    tool_name=tc.name,
                    args=tc.arguments_json,
                    tool_call_id=tc.id,
                )
            )
        if not parts:
            parts.append(TextPart(content=""))
        return ModelResponse(parts=parts)

    return FunctionModel(_invoke_protocol)


def resolve_pydantic_model(llm_provider: LLMProviderProtocol | Model) -> Model:
    """Resolve a native PydanticAI `Model` for production providers or bridge test doubles."""
    if isinstance(llm_provider, Model):
        return llm_provider

    if isinstance(llm_provider, GroqLLMProvider) and llm_provider._api_key.startswith("gsk_"):
        provider = GroqProvider(
            api_key=llm_provider._api_key,
            base_url=_normalize_groq_base_url(llm_provider._base_url),
            http_client=llm_provider._http_client,
        )
        return GroqModel(llm_provider._model_name, provider=provider)

    if isinstance(llm_provider, GeminiLLMProvider) and llm_provider._api_key:
        gemini_model_name = llm_provider._model_path.removeprefix("models/")
        provider_gemini = GoogleProvider(api_key=llm_provider._api_key)
        return GoogleModel(gemini_model_name, provider=provider_gemini)

    return build_protocol_function_model(llm_provider)
