"""Application service orchestrating database connections, Text-to-SQL, and read-only execution."""

from __future__ import annotations

import json
import logging
import re
from http import HTTPStatus
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.answer_formatting import strip_followup_label_prefixes
from app.core.app_settings import AppEnvironment, Settings
from app.core.domain_exceptions import (
    DatabaseConnectionNotFoundError,
    ErrorCode,
    MarginError,
)
from app.database.orm_entities import DatabaseConnectionModel, SqlQueryTurnModel
from app.ports.ai_provider_ports import LLMProviderProtocol
from app.schemas.sql_contracts import (
    DatabaseColumnSchema,
    DatabaseConnectionCreateRequest,
    DatabaseConnectionResponse,
    DatabaseConnectionTestRequest,
    DatabaseConnectionTestResponse,
    DatabaseProvider,
    DatabaseTableSchema,
    SqlChartSuggestion,
    SqlQueryExecuteRequest,
    SqlQueryGenerateRequest,
    SqlQueryTurnResponse,
    SqlWorkspaceStateResponse,
)
from app.sql.sql_agent_service import SqlAgentService
from app.sql.sql_engine_service import (
    decrypt_connection_url,
    discover_external_schema,
    encrypt_connection_url,
    execute_readonly_sql_query,
    mask_connection_url,
    normalize_sql_identifier_casing,
    validate_and_normalize_external_db_url,
    validate_readonly_select_sql,
)

logger = logging.getLogger(__name__)

TEXT_TO_SQL_SYSTEM_INSTRUCTION = (
    "You are Margin SQL Assistant, an expert PostgreSQL data analyst.\n"
    "Your job is to translate a user's question into a single safe read-only SQL SELECT query "
    "grounded strictly in the provided database schema.\n\n"
    "Rules:\n"
    '1. Output ONLY valid JSON with two keys: "sql" and "explanation".\n'
    "2. NEVER generate write, ddl, or administrative SQL statements.\n"
    "3. Use ONLY tables and columns listed in the schema. Do not invent columns.\n"
    "4. Include an appropriate ORDER BY and LIMIT (at most 100) when ranking or listing.\n"
    "5. Prefer clear column aliases (e.g. AS total_revenue) so results are readable.\n"
    "6. POSTGRESQL IDENTIFIER CASING: PostgreSQL folds unquoted identifiers to lowercase! "
    "Always enclose table and column names in double quotes matching schema casing, "
    'e.g. public."Customers", "IsDeleted", "Orders". Never omit quotes on mixed-case names.'
)

SQL_SUMMARY_SYSTEM_INSTRUCTION = (
    "You are Margin SQL Assistant.\n"
    "Given a user question, executed SQL query, and returned rows, provide a concise 1-3 sentence "
    "natural-language summary citing specific numbers, top items, or trends from the data.\n"
    "End with one brief, natural follow-up question offering a helpful next lookup based on the "
    'results (for example, "Would you like to know the name of the category?") without prefixing '
    'it with labels such as "Follow-up:" or "Follow-up question:".\n'
    "Do not invent data not present in the result rows."
)

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)
_SQL_BLOCK_RE = re.compile(r"```sql\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def format_schema_for_prompt(schema_tables: list[DatabaseTableSchema]) -> str:
    """Serialize discovered tables and columns into a compact schema block for the LLM prompt."""
    if not schema_tables:
        return "No tables found in public schema."
    lines: list[str] = []
    for table in schema_tables:
        col_strings: list[str] = []
        for col in table.columns:
            flags: list[str] = [col.data_type]
            if col.is_primary_key:
                flags.append("PRIMARY KEY")
            if col.foreign_key_target:
                flags.append(f"REFERENCES {col.foreign_key_target}")
            if not col.is_nullable and not col.is_primary_key:
                flags.append("NOT NULL")
            col_strings.append(f'  - "{col.name}" ({", ".join(flags)})')
        lines.append(f'Table: {table.schema_name}."{table.table_name}"\n' + "\n".join(col_strings))
    return "\n\n".join(lines)


def _fallback_sql_from_schema(
    question: str,
    schema_tables: list[DatabaseTableSchema],
) -> tuple[str, str]:
    """Synthesize a safe deterministic SELECT query from schema if LLM output cannot be parsed."""
    if not schema_tables:
        raise MarginError(
            "The connected database has no tables in the public schema to query.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )
    q_lower = question.lower()

    chosen_table = schema_tables[0]
    for table in schema_tables:
        t_name = table.table_name.lower()
        singular = t_name[:-1] if t_name.endswith("s") else t_name
        if t_name in q_lower or (len(singular) >= 3 and singular in q_lower):
            chosen_table = table
            break

    t_quoted = f'public."{chosen_table.table_name}"'
    col_names = [f'"{c.name}"' for c in chosen_table.columns]
    if "how many" in q_lower or "count" in q_lower:
        sql = f"SELECT COUNT(*) AS total_count FROM {t_quoted}"
        explanation = f"Counts the total number of records in `{chosen_table.table_name}`."
        return sql, explanation

    numeric_cols = [
        c.name
        for c in chosen_table.columns
        if any(
            k in c.data_type.lower()
            for k in ("int", "numeric", "decimal", "float", "double", "real", "money")
        )
        and not c.is_primary_key
        and not c.name.lower().endswith("_id")
    ]
    label_cols = [
        c.name
        for c in chosen_table.columns
        if any(k in c.data_type.lower() for k in ("char", "text", "name", "date", "time"))
    ]

    keywords = ("top", "most", "highest", "revenue", "total", "by", "monthly", "sales")
    if numeric_cols and label_cols and any(w in q_lower for w in keywords):
        label_col = f'"{label_cols[0]}"'
        metric_col = f'"{numeric_cols[0]}"'
        sql = (
            f"SELECT {label_col}, SUM({metric_col}) AS total_metric "
            f"FROM {t_quoted} "
            f"GROUP BY {label_col} "
            f"ORDER BY total_metric DESC "
            f"LIMIT 20"
        )
        explanation = (
            f"Aggregates `{numeric_cols[0]}` grouped by `{label_cols[0]}` "
            f"from `{chosen_table.table_name}`."
        )
        return sql, explanation

    selected_cols = ", ".join(col_names[:8]) if col_names else "*"
    sql = f"SELECT {selected_cols} FROM {t_quoted} LIMIT 25"
    explanation = f"Retrieves a preview of records from `{chosen_table.table_name}`."
    return sql, explanation


def parse_llm_sql_output(
    raw_output: str,
    question: str,
    schema_tables: list[DatabaseTableSchema],
) -> tuple[str, str]:
    """Extract `(sql_query, explanation)` from the LLM response with fallback support."""
    cleaned = raw_output.strip()

    json_candidate = cleaned
    json_match = _JSON_BLOCK_RE.search(cleaned)
    if json_match:
        json_candidate = json_match.group(1).strip()
    elif "{" in cleaned and "}" in cleaned:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < end:
            json_candidate = cleaned[start : end + 1]

    try:
        parsed = json.loads(json_candidate)
        if (
            isinstance(parsed, dict)
            and isinstance(parsed.get("sql"), str)
            and parsed["sql"].strip()
        ):
            sql_str = parsed["sql"].strip().rstrip(";").strip()
            explanation = str(
                parsed.get("explanation") or "Generated read-only SQL query from schema."
            ).strip()
            return sql_str, explanation
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    sql_match = _SQL_BLOCK_RE.search(cleaned)
    if sql_match and sql_match.group(1).strip():
        sql_str = sql_match.group(1).strip().rstrip(";").strip()
        explanation_text = _SQL_BLOCK_RE.sub("", cleaned).strip()
        explanation = explanation_text or "Generated read-only SQL query from schema."
        return sql_str, explanation

    if re.match(r"^(?:SELECT|WITH)\b", cleaned, re.IGNORECASE):
        lines = [line for line in cleaned.splitlines() if line.strip()]
        sql_str = "\n".join(lines).rstrip(";").strip()
        return sql_str, "Generated read-only SQL query from schema."

    return _fallback_sql_from_schema(question, schema_tables)


def serialize_schema_tables(tables: list[DatabaseTableSchema]) -> list[dict[str, Any]]:
    """Convert `DatabaseTableSchema` models into JSON-serializable dicts for storage."""
    return [t.model_dump() for t in tables]


def deserialize_schema_tables(
    raw_snapshot: list[dict[str, Any]] | None,
) -> list[DatabaseTableSchema]:
    """Rehydrate `DatabaseTableSchema` models from stored JSON snapshot."""
    if not raw_snapshot:
        return []
    result: list[DatabaseTableSchema] = []
    for item in raw_snapshot:
        if not isinstance(item, dict):
            continue
        cols = [DatabaseColumnSchema(**c) for c in item.get("columns", []) if isinstance(c, dict)]
        result.append(
            DatabaseTableSchema(
                schema_name=str(item.get("schema_name", "public")),
                table_name=str(item.get("table_name", "")),
                columns=cols,
            )
        )
    return result


class SqlAssistantService:
    """Service managing external PostgreSQL connections, schema discovery, and Text-to-SQL turns."""

    def __init__(
        self,
        *,
        session: AsyncSession,
        llm_provider: LLMProviderProtocol,
        settings: Settings,
    ) -> None:
        self._session = session
        self._llm = llm_provider
        self._settings = settings
        self._agent_service = SqlAgentService(llm_provider=llm_provider)

    async def test_connection(
        self,
        payload: DatabaseConnectionTestRequest,
        *,
        owner_session_id: str | None = None,
    ) -> DatabaseConnectionTestResponse:
        """Validate connection URL, test connectivity, and discover public schema tables."""
        if owner_session_id:
            logger.info(
                "Testing database connection for session %s (provider=%s)",
                owner_session_id[:8],
                payload.provider,
            )
        allow_sqlite = (
            self._settings.app_env == AppEnvironment.DEVELOPMENT
            and self._settings.database_url.startswith("sqlite")
        )
        normalized_url = await validate_and_normalize_external_db_url(
            payload.connection_url,
            allow_private_hosts=self._settings.sql_allow_private_hosts,
            allow_sqlite_for_tests=allow_sqlite,
        )
        schema_tables = await discover_external_schema(
            normalized_url,
            timeout_seconds=self._settings.sql_query_timeout_seconds,
            allow_private_hosts=self._settings.sql_allow_private_hosts,
        )
        masked = mask_connection_url(payload.connection_url)
        return DatabaseConnectionTestResponse(
            status="connected",
            provider=payload.provider,
            masked_connection_url=masked,
            table_count=len(schema_tables),
            tables=schema_tables,
        )

    async def create_connection(
        self,
        *,
        owner_session_id: str,
        payload: DatabaseConnectionCreateRequest,
    ) -> DatabaseConnectionResponse:
        """Validate, encrypt, and persist a database connection for the current session."""
        allow_sqlite = (
            self._settings.app_env == AppEnvironment.DEVELOPMENT
            and self._settings.database_url.startswith("sqlite")
        )
        normalized_url = await validate_and_normalize_external_db_url(
            payload.connection_url,
            allow_private_hosts=self._settings.sql_allow_private_hosts,
            allow_sqlite_for_tests=allow_sqlite,
        )
        schema_tables = await discover_external_schema(
            normalized_url,
            timeout_seconds=self._settings.sql_query_timeout_seconds,
            allow_private_hosts=self._settings.sql_allow_private_hosts,
        )
        masked = mask_connection_url(payload.connection_url)
        encrypted = encrypt_connection_url(
            normalized_url,
            secret=self._settings.credential_encryption_secret,
        )

        await self._session.execute(
            update(DatabaseConnectionModel)
            .where(DatabaseConnectionModel.owner_session_id == owner_session_id)
            .values(is_active=False)
        )

        conn_model = DatabaseConnectionModel(
            owner_session_id=owner_session_id,
            display_name=payload.display_name.strip(),
            provider=payload.provider.value,
            encrypted_connection_url=encrypted,
            masked_connection_url=masked,
            schema_snapshot_json=serialize_schema_tables(schema_tables),
            is_active=True,
        )
        self._session.add(conn_model)
        await self._session.commit()
        await self._session.refresh(conn_model)
        return self._to_connection_response(conn_model)

    async def activate_connection(
        self,
        *,
        owner_session_id: str,
        connection_id: UUID,
    ) -> DatabaseConnectionResponse:
        """Set a specific saved connection as active for the current session."""
        conn_model = await self._get_owned_connection(owner_session_id, connection_id)
        await self._session.execute(
            update(DatabaseConnectionModel)
            .where(DatabaseConnectionModel.owner_session_id == owner_session_id)
            .values(is_active=False)
        )
        conn_model.is_active = True
        await self._session.commit()
        await self._session.refresh(conn_model)
        return self._to_connection_response(conn_model)

    async def delete_connection(
        self,
        *,
        owner_session_id: str,
        connection_id: UUID,
    ) -> None:
        """Delete a database connection and its query history for the current session."""
        conn_model = await self._get_owned_connection(owner_session_id, connection_id)
        was_active = conn_model.is_active
        await self._session.delete(conn_model)
        await self._session.flush()

        if was_active:
            remaining_stmt = (
                select(DatabaseConnectionModel)
                .where(DatabaseConnectionModel.owner_session_id == owner_session_id)
                .order_by(DatabaseConnectionModel.created_at.desc())
                .limit(1)
            )
            remaining = (await self._session.execute(remaining_stmt)).scalar_one_or_none()
            if remaining is not None:
                remaining.is_active = True

        await self._session.commit()

    async def get_workspace_state(
        self,
        *,
        owner_session_id: str,
        connection_id: UUID | None = None,
    ) -> SqlWorkspaceStateResponse:
        """Return all connections for the session, active connection ID, and its query history."""
        stmt = (
            select(DatabaseConnectionModel)
            .where(DatabaseConnectionModel.owner_session_id == owner_session_id)
            .order_by(
                DatabaseConnectionModel.is_active.desc(),
                DatabaseConnectionModel.created_at.desc(),
            )
        )
        connections = list((await self._session.execute(stmt)).scalars().all())
        conn_responses = [self._to_connection_response(c) for c in connections]

        active_conn: DatabaseConnectionModel | None = None
        if connection_id is not None:
            active_conn = next((c for c in connections if c.id == connection_id), None)
        if active_conn is None and connections:
            active_conn = next((c for c in connections if c.is_active), connections[0])

        turns: list[SqlQueryTurnResponse] = []
        if active_conn is not None:
            turns_stmt = (
                select(SqlQueryTurnModel)
                .where(
                    SqlQueryTurnModel.connection_id == active_conn.id,
                    SqlQueryTurnModel.owner_session_id == owner_session_id,
                )
                .order_by(SqlQueryTurnModel.created_at.asc())
            )
            turn_models = list((await self._session.execute(turns_stmt)).scalars().all())
            turns = [self._to_turn_response(t) for t in turn_models]

        return SqlWorkspaceStateResponse(
            connections=conn_responses,
            active_connection_id=active_conn.id if active_conn is not None else None,
            turns=turns,
        )

    async def generate_sql_turn(
        self,
        *,
        owner_session_id: str,
        connection_id: UUID,
        payload: SqlQueryGenerateRequest,
    ) -> SqlQueryTurnResponse:
        """Generate a schema-grounded read-only SQL query from a natural-language question."""
        conn_model = await self._get_owned_connection(owner_session_id, connection_id)
        schema_tables = deserialize_schema_tables(conn_model.schema_snapshot_json)
        if not schema_tables:
            raise MarginError(
                "No tables were discovered in the public schema of this database.",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            )

        history_stmt = (
            select(SqlQueryTurnModel)
            .where(
                SqlQueryTurnModel.connection_id == conn_model.id,
                SqlQueryTurnModel.owner_session_id == owner_session_id,
            )
            .order_by(SqlQueryTurnModel.created_at.desc())
            .limit(4)
        )
        recent_turn_models = list((await self._session.execute(history_stmt)).scalars().all())
        conversation_history = [
            (turn.question, turn.answer_summary or turn.explanation or "")
            for turn in reversed(recent_turn_models)
        ]

        schema_by_lower = {t.table_name.lower(): t for t in schema_tables}
        focused_schemas: list[DatabaseTableSchema] = []
        seen_focused: set[str] = set()
        for raw_name in payload.focused_tables:
            matched_table = schema_by_lower.get(raw_name.strip().lower())
            if matched_table and matched_table.table_name.lower() not in seen_focused:
                seen_focused.add(matched_table.table_name.lower())
                focused_schemas.append(matched_table)
        focused_table_names = [t.table_name for t in focused_schemas]

        if payload.execute_immediately:
            decrypted_url = decrypt_connection_url(
                conn_model.encrypted_connection_url,
                secret=self._settings.credential_encryption_secret,
            )
            try:
                agent_res = await self._agent_service.run_sql_agent(
                    question=payload.question,
                    connection_url=decrypted_url,
                    schema_tables=schema_tables,
                    focused_tables=focused_table_names,
                    conversation_history=conversation_history,
                    timeout_seconds=self._settings.sql_query_timeout_seconds,
                    max_rows=self._settings.sql_max_rows,
                    allow_private_hosts=self._settings.sql_allow_private_hosts,
                )
                if agent_res.executed_sql:
                    turn_model = SqlQueryTurnModel(
                        connection_id=conn_model.id,
                        owner_session_id=owner_session_id,
                        question=payload.question.strip(),
                        generated_sql=agent_res.executed_sql,
                        explanation="Autonomous query verified by Margin SQL Agent.",
                        executed=True,
                        row_count=agent_res.row_count,
                        execution_time_ms=agent_res.execution_time_ms,
                        columns_json=agent_res.columns,
                        rows_json=agent_res.rows,
                        chart_suggestion_json=(
                            agent_res.chart_suggestion.model_dump()
                            if agent_res.chart_suggestion
                            else None
                        ),
                        answer_summary=agent_res.answer_text,
                    )
                    self._session.add(turn_model)
                    await self._session.commit()
                    await self._session.refresh(turn_model)
                    return self._to_turn_response(turn_model)
            except MarginError:
                raise
            except Exception as exc:
                logger.warning("SQL Agent failed, falling back to legacy single-shot: %s", exc)

        schema_block = format_schema_for_prompt(schema_tables)
        focused_prompt_note = (
            "Focused Tables Selected by User: "
            + ", ".join(f'{t.schema_name}."{t.table_name}"' for t in focused_schemas)
            + "\n\n"
            if focused_schemas
            else ""
        )
        user_prompt = (
            f"Database Name: {conn_model.display_name}\n"
            f"Database Provider: PostgreSQL (read-only)\n\n"
            f"Discovered Public Schema:\n{schema_block}\n\n"
            f"{focused_prompt_note}"
            f"User Question: {payload.question.strip()}\n\n"
            'Return JSON with keys "sql" and "explanation".'
        )

        raw_llm_output = await self._llm.generate_grounded_answer(
            system_instruction=TEXT_TO_SQL_SYSTEM_INSTRUCTION,
            user_prompt=user_prompt,
        )
        candidate_sql, explanation = parse_llm_sql_output(
            raw_llm_output,
            payload.question,
            focused_schemas or schema_tables,
        )
        normalized_sql = normalize_sql_identifier_casing(candidate_sql, schema_tables)
        validated_sql = validate_readonly_select_sql(normalized_sql)

        turn_model = SqlQueryTurnModel(
            connection_id=conn_model.id,
            owner_session_id=owner_session_id,
            question=payload.question.strip(),
            generated_sql=validated_sql,
            explanation=explanation,
            executed=False,
            row_count=0,
            execution_time_ms=0.0,
            columns_json=[],
            rows_json=[],
            chart_suggestion_json=None,
            answer_summary=None,
        )
        self._session.add(turn_model)
        await self._session.commit()
        await self._session.refresh(turn_model)

        if payload.execute_immediately:
            try:
                return await self.execute_sql_turn(
                    owner_session_id=owner_session_id,
                    connection_id=conn_model.id,
                    turn_id=turn_model.id,
                    payload=SqlQueryExecuteRequest(sql_query=None),
                )
            except Exception:
                await self._session.delete(turn_model)
                await self._session.commit()
                raise

        return self._to_turn_response(turn_model)

    async def execute_sql_turn(
        self,
        *,
        owner_session_id: str,
        connection_id: UUID,
        turn_id: UUID,
        payload: SqlQueryExecuteRequest,
    ) -> SqlQueryTurnResponse:
        """Execute a validated read-only SQL query turn against the external database."""
        conn_model = await self._get_owned_connection(owner_session_id, connection_id)
        turn_stmt = select(SqlQueryTurnModel).where(
            SqlQueryTurnModel.id == turn_id,
            SqlQueryTurnModel.connection_id == conn_model.id,
            SqlQueryTurnModel.owner_session_id == owner_session_id,
        )
        turn_model = (await self._session.execute(turn_stmt)).scalar_one_or_none()
        if turn_model is None:
            raise MarginError(
                "SQL query turn not found.",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=HTTPStatus.NOT_FOUND,
            )

        sql_to_run = (
            payload.sql_query.strip()
            if payload.sql_query and payload.sql_query.strip()
            else turn_model.generated_sql
        )
        schema_tables = deserialize_schema_tables(conn_model.schema_snapshot_json)
        normalized_sql = normalize_sql_identifier_casing(sql_to_run, schema_tables)
        validated_sql = validate_readonly_select_sql(normalized_sql)
        turn_model.generated_sql = validated_sql

        decrypted_url = decrypt_connection_url(
            turn_model.connection.encrypted_connection_url
            if turn_model.connection
            else conn_model.encrypted_connection_url,
            secret=self._settings.credential_encryption_secret,
        )

        columns, rows, execution_ms, chart = await execute_readonly_sql_query(
            decrypted_url,
            validated_sql,
            timeout_seconds=self._settings.sql_query_timeout_seconds,
            max_rows=self._settings.sql_max_rows,
            allow_private_hosts=self._settings.sql_allow_private_hosts,
        )

        answer_summary = await self._synthesize_answer_summary(
            question=turn_model.question,
            sql_query=validated_sql,
            columns=columns,
            rows=rows,
        )

        turn_model.executed = True
        turn_model.answer_summary = answer_summary
        turn_model.columns_json = columns
        turn_model.rows_json = rows
        turn_model.row_count = len(rows)
        turn_model.execution_time_ms = execution_ms
        turn_model.chart_suggestion_json = chart.model_dump() if chart is not None else None

        await self._session.commit()
        await self._session.refresh(turn_model)
        return self._to_turn_response(turn_model)

    async def _synthesize_answer_summary(
        self,
        *,
        question: str,
        sql_query: str,
        columns: list[str],
        rows: list[dict[str, Any]],
    ) -> str:
        """Create a concise natural-language summary of the query results."""
        if not rows:
            return "The query ran cleanly and returned 0 matching rows."

        fallback = self._deterministic_result_summary(columns, rows)
        sample_rows = rows[:15]
        prompt = (
            f"User Question: {question}\n"
            f"Executed SQL: {sql_query}\n"
            f"Returned Columns: {', '.join(columns)}\n"
            f"Total Rows Returned: {len(rows)}\n"
            f"Sample Rows (JSON): {json.dumps(sample_rows, default=str)}\n\n"
            "Write a concise 1-2 sentence summary answering the user question from these rows."
        )
        try:
            raw = await self._llm.generate_grounded_answer(
                system_instruction=SQL_SUMMARY_SYSTEM_INSTRUCTION,
                user_prompt=prompt,
            )
            cleaned = strip_followup_label_prefixes(raw)
            if cleaned and "[1]" not in cleaned:
                return cleaned
        except Exception:
            pass
        return fallback

    @staticmethod
    def _deterministic_result_summary(
        columns: list[str],
        rows: list[dict[str, Any]],
    ) -> str:
        """Format a clean data-driven summary when a single value or table is returned."""
        if len(rows) == 1 and len(columns) == 1:
            col = columns[0]
            val = rows[0].get(col)
            return f"Result: **{col.replace('_', ' ')}** is **{val}**."
        if len(rows) == 1:
            pairs = [f"**{col}**: {rows[0].get(col)}" for col in columns[:4]]
            return f"Returned 1 record ({', '.join(pairs)})."
        first_row = rows[0]
        preview_pairs = [f"{col}={first_row.get(col)}" for col in columns[:3]]
        return (
            f"Returned **{len(rows)} rows** across {len(columns)} columns "
            f"(top row: {', '.join(preview_pairs)})."
        )

    async def _get_owned_connection(
        self,
        owner_session_id: str,
        connection_id: UUID,
    ) -> DatabaseConnectionModel:
        stmt = select(DatabaseConnectionModel).where(
            DatabaseConnectionModel.id == connection_id,
            DatabaseConnectionModel.owner_session_id == owner_session_id,
        )
        conn_model = (await self._session.execute(stmt)).scalar_one_or_none()
        if conn_model is None:
            raise DatabaseConnectionNotFoundError("Database connection not found for this session.")
        return conn_model

    @staticmethod
    def _to_connection_response(model: DatabaseConnectionModel) -> DatabaseConnectionResponse:
        tables = deserialize_schema_tables(model.schema_snapshot_json)
        return DatabaseConnectionResponse(
            id=model.id,
            display_name=model.display_name,
            provider=DatabaseProvider(model.provider),
            masked_connection_url=model.masked_connection_url,
            table_count=len(tables),
            tables=tables,
            is_active=model.is_active,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    @staticmethod
    def _to_turn_response(model: SqlQueryTurnModel) -> SqlQueryTurnResponse:
        chart: SqlChartSuggestion | None = None
        if isinstance(model.chart_suggestion_json, dict):
            try:
                chart = SqlChartSuggestion(**model.chart_suggestion_json)
            except Exception:
                chart = None
        return SqlQueryTurnResponse(
            id=model.id,
            connection_id=model.connection_id,
            question=model.question,
            generated_sql=model.generated_sql,
            explanation=model.explanation,
            executed=model.executed,
            row_count=model.row_count,
            execution_time_ms=model.execution_time_ms,
            columns=list(model.columns_json or []),
            rows=list(model.rows_json or []),
            chart_suggestion=chart,
            vega_lite_spec=chart.vega_lite_spec if chart is not None else None,
            answer_summary=model.answer_summary,
            created_at=model.created_at,
        )
