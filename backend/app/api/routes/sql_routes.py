"""HTTP route handlers for external database connections and the Margin SQL Assistant."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.core.dependency_container import get_owner_session_id, get_sql_assistant_service
from app.schemas.sql_contracts import (
    DatabaseConnectionCreateRequest,
    DatabaseConnectionResponse,
    DatabaseConnectionTestRequest,
    DatabaseConnectionTestResponse,
    SqlQueryExecuteRequest,
    SqlQueryGenerateRequest,
    SqlQueryTurnResponse,
    SqlWorkspaceStateResponse,
)
from app.sql.sql_assistant_service import SqlAssistantService

router = APIRouter(prefix="/api/v1/sql", tags=["SQL Assistant"])


@router.get(
    "/workspace",
    response_model=SqlWorkspaceStateResponse,
    summary="Get active SQL Assistant connections, schema, and query history",
)
async def get_sql_workspace(
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    sql_service: Annotated[SqlAssistantService, Depends(get_sql_assistant_service)],
    connection_id: Annotated[
        UUID | None,
        Query(description="Optional connection ID to inspect."),
    ] = None,
) -> SqlWorkspaceStateResponse:
    """Return the caller's connected databases, active schema, and SQL query turns."""
    return await sql_service.get_workspace_state(
        owner_session_id=owner_session_id,
        connection_id=connection_id,
    )


@router.post(
    "/connections/test",
    response_model=DatabaseConnectionTestResponse,
    summary="Test an external PostgreSQL connection URL and discover public schema",
)
async def test_database_connection(
    payload: DatabaseConnectionTestRequest,
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    sql_service: Annotated[SqlAssistantService, Depends(get_sql_assistant_service)],
) -> DatabaseConnectionTestResponse:
    """Validate connectivity in read-only mode and return discovered tables and columns."""
    return await sql_service.test_connection(payload, owner_session_id=owner_session_id)


@router.post(
    "/connections",
    response_model=DatabaseConnectionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Save an encrypted external database connection for the current session",
)
async def create_database_connection(
    payload: DatabaseConnectionCreateRequest,
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    sql_service: Annotated[SqlAssistantService, Depends(get_sql_assistant_service)],
) -> DatabaseConnectionResponse:
    """Encrypt credentials, store discovered schema, and activate the connection."""
    return await sql_service.create_connection(
        owner_session_id=owner_session_id,
        payload=payload,
    )


@router.post(
    "/connections/{connection_id}/activate",
    response_model=DatabaseConnectionResponse,
    summary="Set a saved database connection as the active SQL Assistant data source",
)
async def activate_database_connection(
    connection_id: Annotated[UUID, Path(description="Database connection identifier.")],
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    sql_service: Annotated[SqlAssistantService, Depends(get_sql_assistant_service)],
) -> DatabaseConnectionResponse:
    """Switch the active database connection for the current session."""
    return await sql_service.activate_connection(
        owner_session_id=owner_session_id,
        connection_id=connection_id,
    )


@router.delete(
    "/connections/{connection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Disconnect and delete a saved database connection",
)
async def delete_database_connection(
    connection_id: Annotated[UUID, Path(description="Database connection identifier.")],
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    sql_service: Annotated[SqlAssistantService, Depends(get_sql_assistant_service)],
) -> Response:
    """Remove a saved database connection and its query turns."""
    await sql_service.delete_connection(
        owner_session_id=owner_session_id,
        connection_id=connection_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/connections/{connection_id}/generate",
    response_model=SqlQueryTurnResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a read-only SQL query from a natural-language question",
)
async def generate_sql_query_turn(
    connection_id: Annotated[UUID, Path(description="Database connection identifier.")],
    payload: SqlQueryGenerateRequest,
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    sql_service: Annotated[SqlAssistantService, Depends(get_sql_assistant_service)],
) -> SqlQueryTurnResponse:
    """Translate question into validated SELECT query (with optional immediate execution)."""
    return await sql_service.generate_sql_turn(
        owner_session_id=owner_session_id,
        connection_id=connection_id,
        payload=payload,
    )


@router.post(
    "/connections/{connection_id}/turns/{turn_id}/execute",
    response_model=SqlQueryTurnResponse,
    summary="Execute a generated or edited read-only SQL query turn",
)
async def execute_sql_query_turn(
    connection_id: Annotated[UUID, Path(description="Database connection identifier.")],
    turn_id: Annotated[UUID, Path(description="SQL query turn identifier.")],
    payload: SqlQueryExecuteRequest,
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    sql_service: Annotated[SqlAssistantService, Depends(get_sql_assistant_service)],
) -> SqlQueryTurnResponse:
    """Run validated SELECT query in read-only transaction and return rows, summary, and chart."""
    return await sql_service.execute_sql_turn(
        owner_session_id=owner_session_id,
        connection_id=connection_id,
        turn_id=turn_id,
        payload=payload,
    )
