/**
 * TanStack Query hooks for Margin SQL Assistant data sources, schema discovery, and query turns.
 */

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import * as sqlApiClient from "../../services/sql_api_client";
import type {
  DatabaseConnectionCreateRequest,
  DatabaseConnectionTestRequest,
  SqlQueryExecuteRequest,
  SqlQueryGenerateRequest,
  SqlQueryTurnResponse,
  SqlWorkspaceStateResponse,
} from "../../types/api_contract_types";

export const SQL_QUERY_KEYS = {
  workspace: (connectionId?: string | null) => ["sql-workspace", connectionId ?? "default"] as const,
};

export function useSqlWorkspaceQuery(connectionId?: string | null) {
  return useQuery({
    queryKey: SQL_QUERY_KEYS.workspace(connectionId),
    queryFn: () => sqlApiClient.fetchSqlWorkspace(connectionId),
    staleTime: 10_000,
  });
}

export function useTestDatabaseConnectionMutation() {
  return useMutation({
    mutationFn: (payload: DatabaseConnectionTestRequest) =>
      sqlApiClient.testDatabaseConnection(payload),
  });
}

export function useCreateDatabaseConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: DatabaseConnectionCreateRequest) =>
      sqlApiClient.createDatabaseConnection(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sql-workspace"] });
    },
  });
}

export function useActivateDatabaseConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      sqlApiClient.activateDatabaseConnection(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sql-workspace"] });
    },
  });
}

interface DeleteConnectionRollbackContext {
  previousWorkspaces: Array<[QueryKey, SqlWorkspaceStateResponse | undefined]>;
}

export function useDeleteDatabaseConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string, DeleteConnectionRollbackContext>({
    mutationFn: (connectionId: string) =>
      sqlApiClient.deleteDatabaseConnection(connectionId),
    onMutate: async (connectionId) => {
      await queryClient.cancelQueries({ queryKey: ["sql-workspace"] });
      const previousWorkspaces = queryClient.getQueriesData<SqlWorkspaceStateResponse>({
        queryKey: ["sql-workspace"],
      });

      queryClient.setQueriesData<SqlWorkspaceStateResponse>(
        { queryKey: ["sql-workspace"] },
        (existing) => {
          if (!existing) return existing;
          const remaining = existing.connections.filter((c) => c.id !== connectionId);
          if (remaining.length === existing.connections.length) return existing;

          const removedWasActive = existing.active_connection_id === connectionId;
          const nextActive = removedWasActive ? (remaining[0]?.id ?? null) : existing.active_connection_id;
          return {
            ...existing,
            connections: remaining.map((c) => ({
              ...c,
              is_active: c.id === nextActive,
            })),
            active_connection_id: nextActive,
            turns: removedWasActive ? [] : existing.turns,
          };
        },
      );

      return { previousWorkspaces };
    },
    onError: (_err, _connectionId, context) => {
      if (!context) return;
      for (const [key, snapshot] of context.previousWorkspaces) {
        queryClient.setQueryData(key, snapshot);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sql-workspace"] });
    },
  });
}

async function syncWorkspaceTurnCache(
  queryClient: ReturnType<typeof useQueryClient>,
  connectionId: string,
  transform: (existing: SqlWorkspaceStateResponse) => SqlWorkspaceStateResponse,
) {
  const connectionKey = SQL_QUERY_KEYS.workspace(connectionId);
  const defaultKey = SQL_QUERY_KEYS.workspace();
  await queryClient.cancelQueries({ queryKey: connectionKey });
  await queryClient.cancelQueries({ queryKey: defaultKey });

  queryClient.setQueryData<SqlWorkspaceStateResponse>(connectionKey, (existing) =>
    existing ? transform(existing) : existing,
  );
  queryClient.setQueryData<SqlWorkspaceStateResponse>(defaultKey, (existing) => {
    if (!existing || existing.active_connection_id !== connectionId) {
      return existing;
    }
    return transform(existing);
  });

  void queryClient.invalidateQueries({ queryKey: connectionKey });
  void queryClient.invalidateQueries({ queryKey: defaultKey });
}

export function useGenerateSqlQueryTurnMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      connectionId,
      payload,
    }: {
      connectionId: string;
      payload: SqlQueryGenerateRequest;
    }) => sqlApiClient.generateSqlQueryTurn(connectionId, payload),
    onSuccess: async (turn: SqlQueryTurnResponse, variables) => {
      await syncWorkspaceTurnCache(queryClient, variables.connectionId, (existing) => {
        const alreadyExists = existing.turns.some((t) => t.id === turn.id);
        return {
          ...existing,
          turns: alreadyExists
            ? existing.turns.map((t) => (t.id === turn.id ? turn : t))
            : [...existing.turns, turn],
        };
      });
    },
  });
}

export function useExecuteSqlQueryTurnMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      connectionId,
      turnId,
      payload,
    }: {
      connectionId: string;
      turnId: string;
      payload: SqlQueryExecuteRequest;
    }) => sqlApiClient.executeSqlQueryTurn(connectionId, turnId, payload),
    onSuccess: async (turn: SqlQueryTurnResponse, variables) => {
      await syncWorkspaceTurnCache(queryClient, variables.connectionId, (existing) => ({
        ...existing,
        turns: existing.turns.map((t) => (t.id === turn.id ? turn : t)),
      }));
    },
  });
}

