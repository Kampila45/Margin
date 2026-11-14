"""Add partial unique index preventing duplicate active uploads per session and hash.

Revision ID: 0003_doc_active_sha256_uq
Revises: 0002_sql_assistant_tables
Create Date: 2026-11-14 20:30:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_doc_active_sha256_uq"
down_revision: str | None = "0002_sql_assistant_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create partial unique index `uq_documents_active_session_sha256` on `documents`."""
    op.create_index(
        "uq_documents_active_session_sha256",
        "documents",
        ["owner_session_id", "content_sha256"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('ready', 'processing') AND content_sha256 IS NOT NULL"
        ),
        sqlite_where=sa.text("status IN ('ready', 'processing') AND content_sha256 IS NOT NULL"),
    )


def downgrade() -> None:
    """Drop partial unique index `uq_documents_active_session_sha256`."""
    op.drop_index("uq_documents_active_session_sha256", table_name="documents")
