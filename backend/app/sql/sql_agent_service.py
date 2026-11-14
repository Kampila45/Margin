"""SQL Agent service coordinating autonomous schema discovery, execution, and self-correction."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Sequence
from typing import Any

from pydantic_ai import Agent, ModelSettings, UsageLimits
from pydantic_ai.exceptions import ModelAPIError, UsageLimitExceeded
from pydantic_ai.models import Model

from app.agents.agent_contracts import AgentExecutionBudget
from app.agents.pydantic_model_factory import resolve_pydantic_model
from app.core.answer_formatting import strip_followup_label_prefixes
from app.core.domain_exceptions import MarginError, ProviderUnavailableError
from app.ports.ai_provider_ports import LLMProviderProtocol
from app.schemas.sql_contracts import DatabaseTableSchema, SqlChartSuggestion
from app.sql.chart_specification_service import ChartSpecificationService
from app.sql.sql_agent_deps import SqlAgentDeps
from app.sql.tools.execute_sql_tool import execute_sql_query
from app.sql.tools.inspect_schema_tool import inspect_table_schema

logger = logging.getLogger(__name__)

SQL_AGENT_SYSTEM_INSTRUCTION = (
    "You are Margin SQL Assistant, an autonomous data analyst with direct tool access to "
    "a read-only PostgreSQL database.\n\n"
    "Your objective: Answer the user's question directly with plain English words, "
    "grounded strictly in verified query results.\n\n"
    "Available Tools:\n"
    "1. `inspect_table_schema`: Inspect columns, data types, primary keys, and foreign keys.\n"
    "2. `execute_sql_query`: Execute a read-only SELECT query against the database.\n\n"
    "Workflow & Rules:\n"
    "1. If you need column names or relationships, call `inspect_table_schema`.\n"
    "2. Formulate a single safe SELECT query. Always double-quote table and column names matching "
    'PostgreSQL casing (e.g. public."Customers", "IsActive", "Orders").\n'
    "3. Execute query using `execute_sql_query`. Once executed successfully, STOP calling tools "
    "and write your final plain English answer.\n"
    "4. If execution returns a database error, analyze the error (e.g. casing or column name) "
    "and self-correct the SQL (at most 1 retry).\n"
    "5. If execution returns 0 rows, this is a VALID result indicating no records matched. "
    "Do not retry as an error; explain that 0 records were found.\n"
    "6. When writing your final response:\n"
    "   - Speak in clear, plain English words like a conversational chatbot.\n"
    "   - Cite specific numbers, top items, and totals from the data.\n"
    "   - Do NOT include raw SQL in your response text.\n"
    "   - End with one brief, helpful follow-up question suggesting a logical next insight or "
    "drill-down based on the answer and schema (for example, after answering a count like "
    '"You have 1 category in total.", ask "Would you like to know the name of the category?"). '
    'Write it naturally without labels such as "Follow-up:" or "Follow-up question:".\n'
    "   - If the data can be visualized as a chart, you may append an optional chart suggestion "
    "at the very end of your response formatted exactly as:\n"
    "```json\n"
    '{"chart_suggestion": {"chart_type": "bar", "x_field": "a", "y_field": "b", "title": "T"}}\n'
    "```"
)

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)

_sql_agent: Agent[SqlAgentDeps, str] = Agent(
    deps_type=SqlAgentDeps,
    instructions=SQL_AGENT_SYSTEM_INSTRUCTION,
    tools=[inspect_table_schema, execute_sql_query],
    defer_model_check=True,
)


class SqlAgentResult:
    """Normalized output from a SQL agent execution turn."""

    __slots__ = (
        "answer_text",
        "executed_sql",
        "columns",
        "rows",
        "row_count",
        "execution_time_ms",
        "chart_suggestion",
        "steps_taken",
    )

    def __init__(
        self,
        *,
        answer_text: str,
        executed_sql: str | None,
        columns: list[str],
        rows: list[dict[str, Any]],
        row_count: int,
        execution_time_ms: float,
        chart_suggestion: SqlChartSuggestion | None,
        steps_taken: int,
    ) -> None:
        self.answer_text = answer_text
        self.executed_sql = executed_sql
        self.columns = columns
        self.rows = rows
        self.row_count = row_count
        self.execution_time_ms = execution_time_ms
        self.chart_suggestion = chart_suggestion
        self.steps_taken = steps_taken


class SqlAgentService:
    """Orchestrate schema-aware SQL agent execution using PydanticAI."""

    def __init__(
        self,
        *,
        llm_provider: LLMProviderProtocol | Model,
        budget: AgentExecutionBudget | None = None,
    ) -> None:
        self._llm = llm_provider
        self._budget = budget or AgentExecutionBudget(
            max_rounds=3,
            max_tool_calls=3,
            max_total_timeout_seconds=12.0,
            tool_timeout_seconds=5.0,
        )

    async def run_sql_agent(
        self,
        *,
        question: str,
        connection_url: str,
        schema_tables: list[DatabaseTableSchema],
        focused_tables: Sequence[str] | None = None,
        conversation_history: Sequence[tuple[str, str]] | None = None,
        timeout_seconds: float = 6.0,
        max_rows: int = 100,
        allow_private_hosts: bool = False,
    ) -> SqlAgentResult:
        """Execute the PydanticAI SQL agent loop to answer a natural-language question."""
        deps = SqlAgentDeps(
            connection_url=connection_url,
            schema_tables=schema_tables,
            timeout_seconds=timeout_seconds,
            max_rows=max_rows,
            allow_private_hosts=allow_private_hosts,
        )

        # Build initial prompt with schema overview, optional focused tables, and recent turns
        table_names = [f'{t.schema_name}."{t.table_name}"' for t in schema_tables]
        tables_preview = ", ".join(table_names[:25])
        if len(table_names) > 25:
            tables_preview += f" ... ({len(table_names) - 25} more)"

        focused_block = ""
        if focused_tables:
            schema_by_lower = {t.table_name.lower(): t for t in schema_tables}
            matched_focused: list[DatabaseTableSchema] = []
            seen_focused: set[str] = set()
            for raw_name in focused_tables:
                table_schema = schema_by_lower.get(raw_name.strip().lower())
                if table_schema and table_schema.table_name.lower() not in seen_focused:
                    seen_focused.add(table_schema.table_name.lower())
                    matched_focused.append(table_schema)
            if matched_focused:
                focused_names = ", ".join(
                    f'{t.schema_name}."{t.table_name}"' for t in matched_focused
                )
                focused_details = "\n".join(
                    f'- {t.schema_name}."{t.table_name}" columns: '
                    + ", ".join(
                        f'"{c.name}" ({c.data_type}'
                        + (", PK" if c.is_primary_key else "")
                        + (f", FK -> {c.foreign_key_target}" if c.foreign_key_target else "")
                        + ")"
                        for c in t.columns
                    )
                    for t in matched_focused
                )
                focused_block = (
                    f"Focused Tables Selected by User: {focused_names}\n"
                    f"Focused Table Columns:\n{focused_details}\n"
                    "Prioritize answering directly about these focused tables "
                    "(joining related tables only when needed).\n\n"
                )

        history_block = ""
        if conversation_history:
            recent = [
                f"User: {q.strip()}\nAssistant: {a.strip()}"
                for q, a in list(conversation_history)[-4:]
                if q.strip() or a.strip()
            ]
            if recent:
                history_block = "Recent Conversation:\n" + "\n\n".join(recent) + "\n\n"

        user_prompt = (
            f"Available Database Tables: {tables_preview}\n"
            f"{focused_block}"
            f"{history_block}"
            f"Question: {question.strip()}\n\n"
            "Inspect schema if needed, execute a read-only query, answer in plain English, "
            "and end with one concise follow-up question."
        )

        resolved_model = resolve_pydantic_model(self._llm)
        raw_output = ""
        try:
            run_result = await _sql_agent.run(
                user_prompt,
                deps=deps,
                model=resolved_model,
                model_settings=ModelSettings(temperature=0.1),
                usage_limits=UsageLimits(
                    request_limit=self._budget.max_rounds + 2,
                    tool_calls_limit=self._budget.max_tool_calls,
                ),
                timeout=self._budget.max_total_timeout_seconds,
            )
            raw_output = (run_result.output or "").strip()
        except (UsageLimitExceeded, TimeoutError) as exc:
            logger.warning("SQL Agent reached execution budget limit: %s", exc)
        except MarginError:
            raise
        except ModelAPIError as exc:
            logger.warning("PydanticAI Groq/Gemini upstream API error: %s", exc)
            raise ProviderUnavailableError(
                "The AI assistant is temporarily unavailable. Please try asking again shortly."
            ) from exc

        # Extract chart suggestion and clean final answer prose
        clean_prose, chart_dict = self._parse_chart_suggestion(raw_output)
        clean_prose = strip_followup_label_prefixes(clean_prose)

        execution_state = deps.execution_state
        columns = execution_state.get("columns", [])
        rows = execution_state.get("rows", [])
        executed_sql = execution_state.get("executed_sql")
        execution_time_ms = float(execution_state.get("execution_ms", 0.0))

        if not clean_prose:
            if rows:
                if len(rows) == 1 and len(columns) == 1:
                    col = columns[0]
                    val = rows[0].get(col)
                    clean_prose = f"Result: **{col.replace('_', ' ')}** is **{val}**."
                else:
                    first_row = rows[0]
                    preview = ", ".join(f"{c}={first_row.get(c)}" for c in columns[:3])
                    clean_prose = (
                        f"Returned **{len(rows)} rows** across {len(columns)} columns ({preview})."
                    )
            elif executed_sql:
                clean_prose = "The query ran cleanly and returned 0 matching records."
            else:
                clean_prose = "Could not formulate a query for that question."

        # Build verified Vega-Lite chart suggestion
        chart_suggestion = None
        if rows and columns:
            chart_suggestion = ChartSpecificationService.build_chart_suggestion(
                columns=columns,
                rows=rows,
                suggestion=chart_dict,
            )

        return SqlAgentResult(
            answer_text=clean_prose,
            executed_sql=executed_sql,
            columns=columns,
            rows=rows,
            row_count=len(rows),
            execution_time_ms=execution_time_ms,
            chart_suggestion=chart_suggestion,
            steps_taken=deps.steps_taken,
        )

    @classmethod
    def _parse_chart_suggestion(cls, raw_text: str) -> tuple[str, dict[str, Any] | None]:
        """Extract embedded chart suggestion JSON block and return cleaned conversational prose."""
        match = _JSON_BLOCK_RE.search(raw_text)
        if not match:
            return raw_text.strip(), None

        json_str = match.group(1)
        chart_dict: dict[str, Any] | None = None
        try:
            parsed = json.loads(json_str)
            if isinstance(parsed, dict):
                chart_dict = parsed.get("chart_suggestion", parsed)
        except Exception:
            pass

        # Remove the code block from the user-facing text
        clean_text = raw_text[: match.start()] + raw_text[match.end() :]
        clean_text = clean_text.strip()
        return (clean_text if clean_text else raw_text.strip()), chart_dict
