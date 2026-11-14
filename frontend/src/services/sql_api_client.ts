/**
 * API client methods for Margin SQL Assistant external database connections and Text-to-SQL.
 */

import { requestMarginApi } from "./margin_http_client";
import type {
  DatabaseConnectionCreateRequest,
  DatabaseConnectionResponse,
  DatabaseConnectionTestRequest,
  DatabaseConnectionTestResponse,
  SqlQueryExecuteRequest,
  SqlQueryGenerateRequest,
  SqlQueryTurnResponse,
  SqlWorkspaceStateResponse,
} from "../types/api_contract_types";

export async function fetchSqlWorkspace(
  connectionId?: string | null,
): Promise<SqlWorkspaceStateResponse> {
  return requestMarginApi<SqlWorkspaceStateResponse>("/sql/workspace", {
    method: "GET",
    query: connectionId ? { connection_id: connectionId } : undefined,
  });
}

export async function testDatabaseConnection(
  payload: DatabaseConnectionTestRequest,
): Promise<DatabaseConnectionTestResponse> {
  return requestMarginApi<DatabaseConnectionTestResponse>("/sql/connections/test", {
    method: "POST",
    jsonBody: payload,
  });
}

export async function createDatabaseConnection(
  payload: DatabaseConnectionCreateRequest,
): Promise<DatabaseConnectionResponse> {
  return requestMarginApi<DatabaseConnectionResponse>("/sql/connections", {
    method: "POST",
    jsonBody: payload,
  });
}

export async function activateDatabaseConnection(
  connectionId: string,
): Promise<DatabaseConnectionResponse> {
  return requestMarginApi<DatabaseConnectionResponse>(
    `/sql/connections/${connectionId}/activate`,
    {
      method: "POST",
    },
  );
}

export async function deleteDatabaseConnection(connectionId: string): Promise<void> {
  return requestMarginApi<void>(`/sql/connections/${connectionId}`, {
    method: "DELETE",
  });
}

export async function generateSqlQueryTurn(
  connectionId: string,
  payload: SqlQueryGenerateRequest,
): Promise<SqlQueryTurnResponse> {
  return requestMarginApi<SqlQueryTurnResponse>(
    `/sql/connections/${connectionId}/generate`,
    {
      method: "POST",
      jsonBody: payload,
    },
  );
}

export async function executeSqlQueryTurn(
  connectionId: string,
  turnId: string,
  payload: SqlQueryExecuteRequest,
): Promise<SqlQueryTurnResponse> {
  return requestMarginApi<SqlQueryTurnResponse>(
    `/sql/connections/${connectionId}/turns/${turnId}/execute`,
    {
      method: "POST",
      jsonBody: payload,
    },
  );
}

