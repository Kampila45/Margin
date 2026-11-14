"""PydanticAI tool for inspecting database tables, columns, constraints, and relationships."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field
from pydantic_ai import RunContext

from app.sql.sql_agent_deps import SqlAgentDeps


async def inspect_table_schema(
    ctx: RunContext[SqlAgentDeps],
    table_name: Annotated[
        str | None,
        Field(
            description=(
                "Optional name of a specific table to inspect in detail with column types "
                "and foreign keys. Omit or pass null to list all tables in the database."
            ),
        ),
    ] = None,
) -> dict[str, Any]:
    """Inspect the database schema, column types, primary keys, and foreign key relationships."""
    ctx.deps.steps_taken += 1
    schema_tables = ctx.deps.schema_tables
    if not schema_tables:
        return {"tables": [], "message": "No tables found in public schema."}

    # Case-insensitive lookup for matching table name
    if table_name and table_name.strip():
        target_name = table_name.strip().strip('"').lower()
        matching_table = next(
            (t for t in schema_tables if t.table_name.lower() == target_name),
            None,
        )
        if not matching_table:
            available = [t.table_name for t in schema_tables]
            return {
                "error": f"Table '{table_name}' not found.",
                "available_tables": available,
            }

        col_details = [
            {
                "column_name": col.name,
                "data_type": col.data_type,
                "is_primary_key": col.is_primary_key,
                "is_nullable": col.is_nullable,
                "foreign_key_target": col.foreign_key_target,
            }
            for col in matching_table.columns
        ]

        # Discover incoming references from other tables
        referenced_by = []
        for other_table in schema_tables:
            if other_table.table_name == matching_table.table_name:
                continue
            for col in other_table.columns:
                if col.foreign_key_target and col.foreign_key_target.startswith(
                    matching_table.table_name + "."
                ):
                    referenced_by.append(
                        f'{other_table.table_name}."{col.name}" -> '
                        f"{matching_table.table_name}.{col.foreign_key_target.split('.')[1]}"
                    )

        return {
            "schema": matching_table.schema_name,
            "table_name": matching_table.table_name,
            "quoted_identifier": f'{matching_table.schema_name}."{matching_table.table_name}"',
            "column_count": len(matching_table.columns),
            "columns": col_details,
            "incoming_references": referenced_by,
        }

    # Summary of all tables
    summary = []
    for t in schema_tables:
        fks = [c.foreign_key_target for c in t.columns if c.foreign_key_target]
        summary.append(
            {
                "table_name": t.table_name,
                "quoted_identifier": f'{t.schema_name}."{t.table_name}"',
                "column_count": len(t.columns),
                "primary_keys": [c.name for c in t.columns if c.is_primary_key],
                "foreign_keys": [fk for fk in fks if fk],
            }
        )

    return {
        "total_tables": len(summary),
        "tables": summary,
    }
