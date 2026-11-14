import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SqlAssistantView } from "../features/sql/sql_assistant_view";
import * as sqlApi from "../services/sql_api_client";
import type { DatabaseConnectionResponse, SqlWorkspaceStateResponse } from "../types/api_contract_types";

function makeConnection(overrides: Partial<DatabaseConnectionResponse> = {}): DatabaseConnectionResponse {
  return {
    id: "conn-1",
    display_name: "Primary Analytics DB",
    provider: "postgresql",
    masked_connection_url: "postgresql://***@db.example.com:5432/analytics",
    table_count: 12,
    is_active: true,
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-11T00:00:00Z",
    tables: [],
    ...overrides,
  };
}

describe("SQL connection removal UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows disconnect button even with a single connection and optimistically disconnects it", async () => {
    const conn = makeConnection();
    const workspaceWithConn: SqlWorkspaceStateResponse = {
      connections: [conn],
      active_connection_id: conn.id,
      turns: [],
    };
    const emptyWorkspace: SqlWorkspaceStateResponse = {
      connections: [],
      active_connection_id: null,
      turns: [],
    };

    let resolveDelete!: () => void;
    const pendingDelete = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    const fetchSpy = vi.spyOn(sqlApi, "fetchSqlWorkspace").mockResolvedValue(workspaceWithConn);
    vi.spyOn(sqlApi, "deleteDatabaseConnection").mockReturnValue(pendingDelete);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SqlAssistantView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const disconnectBtn = await screen.findByRole("button", { name: /disconnect primary analytics db/i });
    fireEvent.click(disconnectBtn);

    expect(screen.getByRole("dialog", { name: "Disconnect Database" })).toBeInTheDocument();
    fetchSpy.mockResolvedValue(emptyWorkspace);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Disconnect Database" })).not.toBeInTheDocument();
      expect(screen.getByText("Connect an External PostgreSQL Database")).toBeInTheDocument();
    });

    resolveDelete();
    await waitFor(() => {
      expect(sqlApi.deleteDatabaseConnection).toHaveBeenCalledWith(conn.id);
    });
  });
});
