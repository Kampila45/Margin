"""PydanticAI tool for executing safe read-only SQL queries with error classification."""

from __future__ import annotations

import logging
from typing import Annotated, Any

from pydantic import Field
from pydantic_ai import RunContext

from app.core.domain_exceptions import MarginError
from app.sql.sql_agent_deps import SqlAgentDeps
from app.sql.sql_engine_service import (
    execute_readonly_sql_query,
    normalize_sql_identifier_casing,
    validate_readonly_select_sql,
)

logger = logging.getLogger(__name__)

_RECOVERABLE_ERROR_SUBSTRINGS = (
    "does not exist",
    "syntax error",
    "undefinedtable",
    "undefinedcolumn",
    "ambiguous",
    "operator does not exist",
    "cannot cast",
    "group by",
    "column",
    "relation",
)


async def execute_sql_query(
    ctx: RunContext[SqlAgentDeps],
    sql_query: Annotated[
        str,
        Field(
            description=(
                "The read-only PostgreSQL SELECT query to execute. All table and column names "
                'must be double-quoted matching schema casing, e.g. public."Customers".'
            ),
        ),
    ],
) -> dict[str, Any]:
    """Execute a read-only PostgreSQL SELECT query and record verified row state."""
    ctx.deps.steps_taken += 1
    execution_state = ctx.deps.execution_state

    if execution_state.get("executed_sql"):
        return {
            "success": True,
            "already_executed": True,
            "columns": execution_state.get("columns", []),
            "row_count": execution_state.get("row_count", 0),
            "message": (
                "A query has already executed successfully. Do not execute any further "
                "queries. Write your final answer now in plain English based on the rows."
            ),
        }

    raw_sql = sql_query.strip()
    normalized_sql = normalize_sql_identifier_casing(raw_sql, ctx.deps.schema_tables)

    # 1. Security validation outside agent control
    try:
        validated_sql = validate_readonly_select_sql(normalized_sql)
    except MarginError as err:
        logger.warning("Security validation rejected candidate SQL: %s", err.message)
        return {
            "success": False,
            "error": err.message,
            "recoverable": False,
            "message": (
                "Security validation failed. Only single read-only SELECT statements "
                "are permitted. Do not attempt administrative, write, or chained commands."
            ),
        }

    # 2. Safe read-only execution in sandbox
    try:
        columns, rows, execution_ms, _ = await execute_readonly_sql_query(
            ctx.deps.connection_url,
            validated_sql,
            timeout_seconds=ctx.deps.timeout_seconds,
            max_rows=ctx.deps.max_rows,
            allow_private_hosts=ctx.deps.allow_private_hosts,
        )

        # Record successful state for turn persistence
        execution_state["executed_sql"] = validated_sql
        execution_state["columns"] = columns
        execution_state["rows"] = rows
        execution_state["row_count"] = len(rows)
        execution_state["execution_ms"] = execution_ms

        return {
            "success": True,
            "columns": columns,
            "row_count": len(rows),
            "sample_rows": rows[:10],
            "execution_time_ms": execution_ms,
            "note": (
                "Query executed cleanly. STOP: Do not execute any further queries. "
                "Write your final conversational plain English answer for the user now, "
                "citing specific numbers, totals, or trends from these results."
            ),
        }
    except MarginError as err:
        err_msg = err.message.lower()
        is_timeout = "timed out" in err_msg or "timeout" in err_msg
        is_security = "read-only" in err_msg or "permission" in err_msg or "denied" in err_msg

        if is_timeout or is_security:
            return {
                "success": False,
                "error": err.message,
                "recoverable": False,
                "message": "Non-recoverable execution error. Explain the error to the user.",
            }

        is_recoverable = any(sub in err_msg for sub in _RECOVERABLE_ERROR_SUBSTRINGS)
        return {
            "success": False,
            "error": err.message,
            "recoverable": is_recoverable,
            "message": (
                f"Database execution error: {err.message}. "
                "If table or column was not found, verify schema names and ensure double "
                'quotes are used (e.g. public."Customers", "IsDeleted"). '
                "You may correct the query and retry once."
                if is_recoverable
                else "Non-recoverable database error."
            ),
        }
    except Exception as exc:
        logger.exception("Unexpected error executing read-only SQL: %s", exc)
        return {
            "success": False,
            "error": str(exc),
            "recoverable": False,
            "message": "Unexpected execution failure.",
        }
