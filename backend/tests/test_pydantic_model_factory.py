"""Unit tests for PydanticAI model resolution, protocol bridging, and agent execution."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.groq import GroqModel

from app.agents.pydantic_model_factory import resolve_pydantic_model
from app.ai.gemini_provider_adapter import GeminiLLMProvider
from app.ai.grok_provider_adapter import GroqLLMProvider
from app.ports.ai_provider_ports import LLMProviderProtocol, LLMResponsePayload


class _DummyProtocolLLM(LLMProviderProtocol):
    async def generate_grounded_answer(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
    ) -> str:
        return "dummy"

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str = "auto",
        temperature: float = 0.1,
        max_tokens: int = 1500,
    ) -> LLMResponsePayload:
        return LLMResponsePayload(content="bridged response")


def test_resolve_pydantic_model_groq_provider() -> None:
    """GroqLLMProvider with a gsk_ key resolves to native PydanticAI GroqModel."""
    provider = GroqLLMProvider(
        api_key="gsk_test_key_12345",
        model_name="openai/gpt-oss-120b",
        base_url="https://api.groq.com/openai/v1",
    )
    resolved = resolve_pydantic_model(provider)
    assert isinstance(resolved, GroqModel)
    assert resolved.model_name == "openai/gpt-oss-120b"


def test_resolve_pydantic_model_gemini_provider() -> None:
    """GeminiLLMProvider with an API key resolves to native PydanticAI GoogleModel."""
    provider = GeminiLLMProvider(
        api_key="AIza_test_key",
        model_name="gemini-2.5-flash",
    )
    resolved = resolve_pydantic_model(provider)
    assert isinstance(resolved, GoogleModel)
    assert resolved.model_name == "gemini-2.5-flash"


def test_resolve_pydantic_model_passthrough_and_bridge() -> None:
    """Native Models pass through; custom LLMProviderProtocol bridges via FunctionModel."""

    async def _fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart(content="native")])

    native = FunctionModel(_fn)
    assert resolve_pydantic_model(native) is native

    bridged = resolve_pydantic_model(_DummyProtocolLLM())
    assert isinstance(bridged, FunctionModel)


@pytest.mark.asyncio
async def test_sql_agent_works_with_native_pydanticai_function_model(tmp_path: Any) -> None:
    """Verify SqlAgentService runs cleanly when passed a native PydanticAI FunctionModel."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.schemas.sql_contracts import DatabaseColumnSchema, DatabaseTableSchema
    from app.sql.sql_agent_service import SqlAgentService

    db_path = tmp_path / "native_model.db"
    db_url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        await conn.execute(text('CREATE TABLE "Customers" ("Id" INTEGER PRIMARY KEY, "Name" TEXT)'))
        await conn.execute(text('INSERT INTO "Customers" ("Id", "Name") VALUES (1, \'Ada\')'))
    await engine.dispose()

    schema = [
        DatabaseTableSchema(
            schema_name="public",
            table_name="Customers",
            columns=[
                DatabaseColumnSchema(name="Id", data_type="integer", is_primary_key=True),
                DatabaseColumnSchema(name="Name", data_type="text"),
            ],
        )
    ]

    step = {"count": 0}

    async def _model_fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        step["count"] += 1
        if step["count"] == 1:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="execute_sql_query",
                        args=(
                            '{"sql_query": "SELECT COUNT(*) AS total FROM public.\\"Customers\\""}'
                        ),
                        tool_call_id="call_native_1",
                    )
                ]
            )
        return ModelResponse(parts=[TextPart(content="You have 1 customer in total.")])

    service = SqlAgentService(llm_provider=FunctionModel(_model_fn))
    res = await service.run_sql_agent(
        question="How many customers?",
        connection_url=db_url,
        schema_tables=schema,
    )

    assert res.executed_sql == 'SELECT COUNT(*) AS total FROM public."Customers"'
    assert res.row_count == 1
    assert res.rows == [{"total": 1}]
    assert "1 customer" in res.answer_text
