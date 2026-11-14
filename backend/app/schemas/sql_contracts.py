"""Pydantic request and response contracts for the Margin SQL Assistant ('Connect a Database')."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DatabaseProvider(StrEnum):
    """Supported external database engines for the SQL Assistant."""

    POSTGRESQL = "postgresql"


class SqlChartType(StrEnum):
    """Supported chart visualizations for SQL query results."""

    BAR = "bar"
    HORIZONTAL_BAR = "horizontal_bar"
    LINE = "line"


class DatabaseColumnSchema(BaseModel):
    """Discovered column metadata within an external database table."""

    model_config = ConfigDict(extra="forbid")

    name: str
    data_type: str
    is_nullable: bool = True
    is_primary_key: bool = False
    foreign_key_target: str | None = None


class DatabaseTableSchema(BaseModel):
    """Discovered table metadata and columns within an external database."""

    model_config = ConfigDict(extra="forbid")

    schema_name: str = "public"
    table_name: str
    columns: list[DatabaseColumnSchema] = Field(default_factory=list)


class DatabaseConnectionTestRequest(BaseModel):
    """Payload to test an external PostgreSQL connection URL before saving."""

    model_config = ConfigDict(extra="forbid")

    provider: DatabaseProvider = DatabaseProvider.POSTGRESQL
    connection_url: str = Field(min_length=8, max_length=2048)


class DatabaseConnectionTestResponse(BaseModel):
    """Result of testing an external database connection and discovering its schema."""

    model_config = ConfigDict(extra="forbid")

    status: str = "connected"
    provider: DatabaseProvider = DatabaseProvider.POSTGRESQL
    masked_connection_url: str
    table_count: int
    tables: list[DatabaseTableSchema]


class DatabaseConnectionCreateRequest(BaseModel):
    """Payload to register and encrypt an external PostgreSQL database connection."""

    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(min_length=1, max_length=120)
    provider: DatabaseProvider = DatabaseProvider.POSTGRESQL
    connection_url: str = Field(min_length=8, max_length=2048)


class DatabaseConnectionResponse(BaseModel):
    """Public metadata for a saved database connection (never includes raw credentials)."""

    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    display_name: str
    provider: DatabaseProvider
    masked_connection_url: str
    table_count: int
    tables: list[DatabaseTableSchema]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class SqlChartSuggestion(BaseModel):
    """Recommended chart visualization when query results contain categorical + numeric columns."""

    model_config = ConfigDict(extra="forbid")

    chart_type: SqlChartType
    x_column: str
    y_column: str
    title: str
    vega_lite_spec: dict[str, Any] | None = None


class SqlQueryGenerateRequest(BaseModel):
    """Request to translate a natural-language question into SQL."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=2, max_length=2000)
    execute_immediately: bool = False
    focused_tables: list[str] = Field(default_factory=list, max_length=20)


class SqlQueryExecuteRequest(BaseModel):
    """Request to execute a previewed (or edited) read-only SELECT query for a turn."""

    model_config = ConfigDict(extra="forbid")

    sql_query: str | None = Field(default=None, max_length=8000)


class SqlQueryTurnResponse(BaseModel):
    """Single natural-language-to-SQL turn with preview, tabular results, chart, and summary."""

    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    connection_id: uuid.UUID
    question: str
    generated_sql: str
    explanation: str
    executed: bool
    row_count: int
    execution_time_ms: float
    columns: list[str]
    rows: list[dict[str, Any]]
    chart_suggestion: SqlChartSuggestion | None = None
    vega_lite_spec: dict[str, Any] | None = None
    answer_summary: str | None = None
    created_at: datetime


class SqlWorkspaceStateResponse(BaseModel):
    """Combined SQL Assistant state returning connections and active connection turns."""

    model_config = ConfigDict(extra="forbid")

    connections: list[DatabaseConnectionResponse]
    active_connection_id: uuid.UUID | None = None
    turns: list[SqlQueryTurnResponse] = Field(default_factory=list)
