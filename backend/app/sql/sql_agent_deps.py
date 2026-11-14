"""Runtime dependency container injected into PydanticAI SQL agent tools."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.schemas.sql_contracts import DatabaseTableSchema


@dataclass
class SqlAgentDeps:
    """Per-request dependencies and mutable execution state for SQL agent turns."""

    connection_url: str
    schema_tables: list[DatabaseTableSchema]
    timeout_seconds: float = 6.0
    max_rows: int = 100
    allow_private_hosts: bool = False
    execution_state: dict[str, Any] = field(default_factory=dict)
    steps_taken: int = 0
