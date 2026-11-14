"""Unit tests for the autonomous SQL Agent and structured Chart Specification service."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.ports.ai_provider_ports import LLMProviderProtocol, LLMResponsePayload, ToolCallPayload
from app.schemas.sql_contracts import DatabaseColumnSchema, DatabaseTableSchema, SqlChartType
from app.sql.chart_specification_service import ChartSpecificationService
from app.sql.sql_agent_service import SqlAgentService


@pytest_asyncio.fixture
async def sample_external_db(tmp_path: Path) -> AsyncIterator[str]:
    """Create a sample SQLite database with Customers table."""
    db_path = tmp_path / "sample_customers.db"
    db_url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                'CREATE TABLE "Customers" ('
                '  "Id" INTEGER PRIMARY KEY,'
                '  "Name" TEXT NOT NULL,'
                '  "IsActive" INTEGER NOT NULL'
                ")"
            )
        )
        await conn.execute(
            text(
                'INSERT INTO "Customers" ("Id", "Name", "IsActive") VALUES '
                "(1, 'Alice', 1),"
                "(2, 'Bob', 1)"
            )
        )
    await engine.dispose()
    yield db_url


class MockToolCallingLLM(LLMProviderProtocol):
    """Mock LLM simulating tool calling sequences for SQL Agent tests."""

    def __init__(self, turns: list[LLMResponsePayload]) -> None:
        self._turns = list(turns)
        self.recorded_messages: list[list[dict[str, Any]]] = []

    async def generate_grounded_answer(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
    ) -> str:
        return "Legacy fallback answer"

    async def chat_completion(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str = "auto",
        temperature: float = 0.1,
        max_tokens: int = 1500,
    ) -> LLMResponsePayload:
        self.recorded_messages.append(messages)
        if self._turns:
            return self._turns.pop(0)
        return LLMResponsePayload(content="Default final response.")


def _sample_schema() -> list[DatabaseTableSchema]:
    return [
        DatabaseTableSchema(
            schema_name="public",
            table_name="Customers",
            columns=[
                DatabaseColumnSchema(
                    name="Id",
                    data_type="integer",
                    is_primary_key=True,
                ),
                DatabaseColumnSchema(
                    name="Name",
                    data_type="varchar",
                    is_nullable=False,
                ),
                DatabaseColumnSchema(
                    name="IsActive",
                    data_type="boolean",
                    is_nullable=False,
                ),
            ],
        ),
        DatabaseTableSchema(
            schema_name="public",
            table_name="Orders",
            columns=[
                DatabaseColumnSchema(
                    name="Id",
                    data_type="integer",
                    is_primary_key=True,
                ),
                DatabaseColumnSchema(
                    name="CustomerId",
                    data_type="integer",
                    foreign_key_target="Customers.Id",
                ),
                DatabaseColumnSchema(
                    name="Amount",
                    data_type="numeric",
                ),
            ],
        ),
    ]


def test_chart_specification_service_build_bar_chart():
    """Verify ChartSpecificationService validates and builds a responsive bar chart spec."""
    columns = ["category", "sales"]
    rows = [
        {"category": "Electronics", "sales": 450},
        {"category": "Books", "sales": 120},
        {"category": "Clothing", "sales": 310},
    ]

    suggestion = {
        "chart_type": "bar",
        "x_field": "category",
        "y_field": "sales",
        "title": "Total Sales by Category",
    }

    result = ChartSpecificationService.build_chart_suggestion(
        columns=columns,
        rows=rows,
        suggestion=suggestion,
    )

    assert result is not None
    assert result.chart_type == SqlChartType.BAR
    assert result.x_column == "category"
    assert result.y_column == "sales"
    assert result.title == "Total Sales by Category"
    assert result.vega_lite_spec is not None
    assert result.vega_lite_spec["mark"]["color"] == "#4143d5"
    assert result.vega_lite_spec["encoding"]["x"]["field"] == "category"
    assert result.vega_lite_spec["encoding"]["y"]["field"] == "sales"


def test_chart_specification_service_invalid_columns_fallback():
    """Verify invalid requested column names safely fall back to heuristics."""
    columns = ["department", "headcount"]
    rows = [
        {"department": "Engineering", "headcount": 42},
        {"department": "Design", "headcount": 12},
    ]

    suggestion = {
        "chart_type": "bar",
        "x_field": "nonexistent_col",
        "y_field": "another_bad_col",
    }

    result = ChartSpecificationService.build_chart_suggestion(
        columns=columns,
        rows=rows,
        suggestion=suggestion,
    )

    assert result is not None
    assert result.x_column == "department"
    assert result.y_column == "headcount"


@pytest.mark.asyncio
async def test_sql_agent_inspects_schema_and_executes_query(sample_external_db: str):
    """Test SQL Agent inspecting schema first, executing read-only query, and returning prose."""
    mock_llm = MockToolCallingLLM(
        turns=[
            # Round 1: Model asks to inspect schema for Customers
            LLMResponsePayload(
                tool_calls=[
                    ToolCallPayload(
                        id="call_inspect_1",
                        name="inspect_table_schema",
                        arguments_json=json.dumps({"table_name": "Customers"}),
                    )
                ]
            ),
            # Round 2: Model executes the read-only query
            LLMResponsePayload(
                tool_calls=[
                    ToolCallPayload(
                        id="call_exec_1",
                        name="execute_sql_query",
                        arguments_json=json.dumps(
                            {"sql_query": 'SELECT "Name", "IsActive" FROM public."Customers"'}
                        ),
                    )
                ]
            ),
            # Round 3: Model returns plain English answer and chart suggestion
            LLMResponsePayload(
                content=(
                    "There are 2 active customers in the database: Alice and Bob.\n\n"
                    "```json\n"
                    '{"chart_suggestion": {"chart_type": "bar", "x_field": "Name", '
                    '"y_field": "IsActive", "title": "Customer Status"}}\n'
                    "```"
                )
            ),
        ]
    )

    agent_service = SqlAgentService(llm_provider=mock_llm)
    schema = _sample_schema()

    result = await agent_service.run_sql_agent(
        question="How many customers do I have and what are their names?",
        connection_url=sample_external_db,
        schema_tables=schema,
    )

    assert "There are 2 active customers" in result.answer_text
    assert "```json" not in result.answer_text  # stripped from prose
    assert result.executed_sql is not None
    assert result.steps_taken == 2


@pytest.mark.asyncio
async def test_sql_agent_self_corrects_on_recoverable_error(sample_external_db: str):
    """Test SQL Agent self-correcting after an initial query typo."""
    mock_llm = MockToolCallingLLM(
        turns=[
            # Round 1: Generates query with an unquoted identifier / wrong table name
            LLMResponsePayload(
                tool_calls=[
                    ToolCallPayload(
                        id="call_exec_bad",
                        name="execute_sql_query",
                        arguments_json=json.dumps(
                            {"sql_query": "SELECT COUNT(*) FROM nonexistent_table"}
                        ),
                    )
                ]
            ),
            # Round 2: Self-corrects to the proper table
            LLMResponsePayload(
                tool_calls=[
                    ToolCallPayload(
                        id="call_exec_good",
                        name="execute_sql_query",
                        arguments_json=json.dumps(
                            {"sql_query": 'SELECT COUNT(*) AS total FROM public."Customers"'}
                        ),
                    )
                ]
            ),
            # Round 3: Final answer
            LLMResponsePayload(content="You currently have 2 customers recorded in the database."),
        ]
    )

    agent_service = SqlAgentService(llm_provider=mock_llm)
    schema = _sample_schema()

    result = await agent_service.run_sql_agent(
        question="how many customers do i have?",
        connection_url=sample_external_db,
        schema_tables=schema,
    )

    assert "You currently have 2 customers" in result.answer_text
    assert result.executed_sql is not None
    assert result.steps_taken == 2


@pytest.mark.asyncio
async def test_sql_agent_forwards_recent_history_and_followup_instruction(
    sample_external_db: str,
) -> None:
    """Verify history and follow-up question guidance are forwarded to the SQL model."""
    mock_llm = MockToolCallingLLM(
        [
            LLMResponsePayload(
                tool_calls=[
                    ToolCallPayload(
                        id="call_exec_names",
                        name="execute_sql_query",
                        arguments_json=json.dumps(
                            {"sql_query": 'SELECT "Name" FROM public."Customers"'}
                        ),
                    )
                ]
            ),
            LLMResponsePayload(
                content=(
                    "Your customers are Alice and Bob. Would you like to see their order totals?"
                )
            ),
        ]
    )

    agent_service = SqlAgentService(llm_provider=mock_llm)
    result = await agent_service.run_sql_agent(
        question="Yes, show me their names",
        connection_url=sample_external_db,
        schema_tables=_sample_schema(),
        conversation_history=[
            (
                "How many customers do I have?",
                "You have 2 customers in total. Would you like to know their names?",
            )
        ],
    )

    combined = json.dumps(mock_llm.recorded_messages)
    assert "follow-up question" in combined.lower()
    assert "How many customers do I have?" in combined
    assert "Would you like to know their names?" in combined
    assert "Alice and Bob" in result.answer_text


@pytest.mark.asyncio
async def test_sql_agent_highlights_user_focused_tables(sample_external_db: str) -> None:
    """Verify dragged/focused table context is passed to the SQL model."""
    mock_llm = MockToolCallingLLM(
        [
            LLMResponsePayload(
                tool_calls=[
                    ToolCallPayload(
                        id="call_exec_focused",
                        name="execute_sql_query",
                        arguments_json=json.dumps(
                            {"sql_query": 'SELECT COUNT(*) AS total FROM public."Customers"'}
                        ),
                    )
                ]
            ),
            LLMResponsePayload(
                content=(
                    "The Customers table contains 2 records. Would you like to see their names?"
                )
            ),
        ]
    )

    agent_service = SqlAgentService(llm_provider=mock_llm)
    result = await agent_service.run_sql_agent(
        question="Summarize this table",
        connection_url=sample_external_db,
        schema_tables=_sample_schema(),
        focused_tables=["Customers"],
    )

    combined = json.dumps(mock_llm.recorded_messages)
    assert "Focused Tables Selected by User" in combined
    assert "Customers" in combined
    assert "The Customers table contains 2 records." in result.answer_text
