"""Add database_connections and sql_query_turns tables for Margin SQL Assistant.

Revision ID: 0002_sql_assistant_tables
Revises: 0001_initial_schema
Create Date: 2026-11-11 14:30:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_sql_assistant_tables"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create `database_connections` and `sql_query_turns` tables."""
    op.create_table(
        "database_connections",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("owner_session_id", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="postgresql"),
        sa.Column("encrypted_connection_url", sa.Text(), nullable=False),
        sa.Column("masked_connection_url", sa.String(length=255), nullable=False),
        sa.Column("schema_snapshot_json", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_database_connections_owner_session_id",
        "database_connections",
        ["owner_session_id"],
    )
    op.create_index(
        "ix_database_connections_owner_created",
        "database_connections",
        ["owner_session_id", "created_at"],
    )

    op.create_table(
        "sql_query_turns",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "connection_id",
            sa.Uuid(),
            sa.ForeignKey("database_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner_session_id", sa.String(length=128), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("generated_sql", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False, server_default=""),
        sa.Column("executed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("execution_time_ms", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("columns_json", sa.JSON(), nullable=False),
        sa.Column("rows_json", sa.JSON(), nullable=False),
        sa.Column("chart_suggestion_json", sa.JSON(), nullable=True),
        sa.Column("answer_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sql_query_turns_connection_id", "sql_query_turns", ["connection_id"])
    op.create_index("ix_sql_query_turns_owner_session_id", "sql_query_turns", ["owner_session_id"])


def downgrade() -> None:
    """Drop `sql_query_turns` and `database_connections` tables."""
    op.drop_table("sql_query_turns")
    op.drop_table("database_connections")
