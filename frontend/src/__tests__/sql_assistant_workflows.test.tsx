/**
 * Frontend tests for Margin SQL Assistant: schema explorer, SQL preview, charts, and connection dialog.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ChatErrorBubble } from "../components/ui/chat_error_bubble";
import { ConnectDatabaseModal } from "../features/sql/connect_database_modal";
import { SqlResultChart } from "../features/sql/sql_result_chart";
import { SqlAssistantView } from "../features/sql/sql_assistant_view";
import { MarginApiError } from "../services/margin_http_client";
import * as sqlApi from "../services/sql_api_client";
import type {
  DatabaseConnectionResponse,
  SqlQueryTurnResponse,
  SqlWorkspaceStateResponse,
} from "../types/api_contract_types";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

const mockConnection: DatabaseConnectionResponse = {
  id: "conn-123",
  display_name: "Sales Replica DB",
  provider: "postgresql",
  masked_connection_url: "postgresql://***@pg.neon.tech:5432/sales",
  table_count: 2,
  is_active: true,
  created_at: "2026-11-11T12:00:00Z",
  updated_at: "2026-11-11T12:00:00Z",
  tables: [
    {
      schema_name: "public",
      table_name: "orders",
      columns: [
        {
          name: "id",
          data_type: "integer",
          is_nullable: false,
          is_primary_key: true,
          foreign_key_target: null,
        },
        {
          name: "category",
          data_type: "text",
          is_nullable: false,
          is_primary_key: false,
          foreign_key_target: null,
        },
        {
          name: "amount",
          data_type: "numeric",
          is_nullable: false,
          is_primary_key: false,
          foreign_key_target: null,
        },
      ],
    },
    {
      schema_name: "public",
      table_name: "customers",
      columns: [
        {
          name: "id",
          data_type: "integer",
          is_nullable: false,
          is_primary_key: true,
          foreign_key_target: null,
        },
        {
          name: "name",
          data_type: "varchar",
          is_nullable: false,
          is_primary_key: false,
          foreign_key_target: null,
        },
      ],
    },
  ],
};

const mockTurn: SqlQueryTurnResponse = {
  id: "turn-abc",
  connection_id: "conn-123",
  question: "Which category has the highest sales?",
  generated_sql: "SELECT category, SUM(amount) AS total_sales FROM orders GROUP BY category ORDER BY total_sales DESC LIMIT 5",
  explanation: "Aggregates total sales revenue grouped by category.",
  executed: true,
  row_count: 2,
  execution_time_ms: 1.45,
  columns: ["category", "total_sales"],
  rows: [
    { category: "Electronics", total_sales: 1498.99 },
    { category: "Furniture", total_sales: 249.0 },
  ],
  chart_suggestion: {
    chart_type: "bar",
    x_column: "category",
    y_column: "total_sales",
    title: "Total Sales by Category",
  },
  answer_summary: "Top category is **Electronics** with **$1,498.99** in sales.",
  created_at: "2026-11-11T12:05:00Z",
};

describe("Margin SQL Assistant Workflows", () => {
  it("renders SVG Bar Chart correctly with data labels and bars", () => {
    render(
      <SqlResultChart
        suggestion={{
          chart_type: "bar",
          x_column: "category",
          y_column: "total_sales",
          title: "Total Sales by Category",
        }}
        rows={[
          { category: "Electronics", total_sales: 1200 },
          { category: "Books", total_sales: 450 },
        ]}
      />,
    );

    expect(screen.getAllByText("Total Sales by Category")).toHaveLength(1);
    expect(screen.queryByText("Bar Chart")).not.toBeInTheDocument();
    expect(screen.queryByText("Horizontal Bar Chart")).not.toBeInTheDocument();
    expect(screen.queryByText("Vega-Lite v5")).not.toBeInTheDocument();
    expect(screen.queryByText("Spec")).not.toBeInTheDocument();
    expect(screen.queryByText("SVG")).not.toBeInTheDocument();
    expect(screen.queryByText("PNG")).not.toBeInTheDocument();
    expect(screen.getByText("Electronics")).toBeInTheDocument();
    expect(screen.getByText("Books")).toBeInTheDocument();
  });

  it("renders SVG Line Chart correctly for temporal series", () => {
    render(
      <SqlResultChart
        suggestion={{
          chart_type: "line",
          x_column: "month",
          y_column: "revenue",
          title: "Monthly Revenue Trend",
        }}
        rows={[
          { month: "Jan 2026", revenue: 5000 },
          { month: "Feb 2026", revenue: 7500 },
        ]}
      />,
    );

    expect(screen.getAllByText("Monthly Revenue Trend")).toHaveLength(1);
    expect(screen.queryByText("Trend Line Chart")).not.toBeInTheDocument();
    expect(screen.getByText("Jan 2026")).toBeInTheDocument();
    expect(screen.getByText("Feb 2026")).toBeInTheDocument();
  });

  it("opens ConnectDatabaseModal and handles test connection and submit", async () => {
    const testSpy = vi.spyOn(sqlApi, "testDatabaseConnection").mockResolvedValue({
      status: "connected",
      provider: "postgresql",
      masked_connection_url: "postgresql://***@host:5432/sales",
      table_count: 5,
      tables: [],
    });

    const createSpy = vi.spyOn(sqlApi, "createDatabaseConnection").mockResolvedValue(mockConnection);
    const onConnected = vi.fn();
    const onClose = vi.fn();

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ConnectDatabaseModal isOpen={true} onClose={onClose} onConnected={onConnected} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Connect a Database")).toBeInTheDocument();
    expect(screen.getByText("Read-only enforced")).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/Connection Name/i);
    const urlInput = screen.getByLabelText(/Connection URL/i);

    fireEvent.change(nameInput, { target: { value: "My Test DB" } });
    fireEvent.change(urlInput, {
      target: { value: "postgresql://user:secret@host:5432/testdb" },
    });

    const testBtn = screen.getByRole("button", { name: /Test Connection/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(testSpy).toHaveBeenCalledWith({
        provider: "postgresql",
        connection_url: "postgresql://user:secret@host:5432/testdb",
      });
      expect(screen.getByText(/Connection test successful/i)).toBeInTheDocument();
    });

    const connectBtn = screen.getByRole("button", { name: /Connect Database/i });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        display_name: "My Test DB",
        provider: "postgresql",
        connection_url: "postgresql://user:secret@host:5432/testdb",
      });
      expect(onConnected).toHaveBeenCalledWith("conn-123");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("renders active connection, schema explorer, answer summary, and chart without SQL or table toggles in SqlAssistantView", async () => {
    const workspaceMock: SqlWorkspaceStateResponse = {
      connections: [mockConnection],
      active_connection_id: "conn-123",
      turns: [mockTurn],
    };

    vi.spyOn(sqlApi, "fetchSqlWorkspace").mockResolvedValue(workspaceMock);

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SqlAssistantView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Sales Replica DB").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("orders")).toBeInTheDocument();
      expect(screen.getByText("customers")).toBeInTheDocument();
      expect(screen.getByText("Which category has the highest sales?")).toBeInTheDocument();
      expect(screen.getByText(/Top category is/)).toBeInTheDocument();
      expect(screen.getByText("Total Sales by Category")).toBeInTheDocument();
    });

    expect(screen.queryByText("SQL Assistant")).not.toBeInTheDocument();
    expect(screen.queryByText(/View SQL Query/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Table \(/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/SELECT category/)).not.toBeInTheDocument();

    // Expanding a table reveals columns and PK tag
    const ordersBtn = screen.getByRole("button", { name: /orders/i });
    fireEvent.click(ordersBtn);

    await waitFor(() => {
      expect(screen.getByText("PK")).toBeInTheDocument();
      expect(screen.getByText("amount")).toBeInTheDocument();
    });

    // Left schema rail can be collapsed and expanded cleanly
    expect(screen.queryByText("swap_horiz")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse schema panel" }));
    expect(screen.queryByText("Schema Explorer")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand schema panel" }));
    expect(screen.getByText("Schema Explorer")).toBeInTheDocument();
  });

  it("renders sample questions only in the center empty state and not duplicated in the bottom composer", async () => {
    const emptyWorkspaceMock: SqlWorkspaceStateResponse = {
      connections: [mockConnection],
      active_connection_id: "conn-123",
      turns: [],
    };

    vi.spyOn(sqlApi, "fetchSqlWorkspace").mockResolvedValue(emptyWorkspaceMock);

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SqlAssistantView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Connected to Sales Replica DB")).toBeInTheDocument();
      // Verifies exactly ONE instance of each sample question exists (in the center hero grid, not duplicated at the bottom)
      const promptElements = screen.getAllByText("How many records are in each table?");
      expect(promptElements).toHaveLength(1);
    });
  });

  it("displays prominent error banner and retry button when AI generation fails with 503/429", async () => {
    const emptyWorkspaceMock: SqlWorkspaceStateResponse = {
      connections: [mockConnection],
      active_connection_id: "conn-123",
      turns: [],
    };

    vi.spyOn(sqlApi, "fetchSqlWorkspace").mockResolvedValue(emptyWorkspaceMock);
    const generateSpy = vi.spyOn(sqlApi, "generateSqlQueryTurn").mockRejectedValue(
      new MarginApiError({
        errorCode: "PROVIDER_UNAVAILABLE",
        message: "The AI assistant is temporarily busy or rate-limited. Please try asking again shortly.",
        statusCode: 503,
        requestId: "req-err-123",
      }),
    );

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SqlAssistantView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Connected to Sales Replica DB")).toBeInTheDocument();
    });

    const samplePromptBtn = screen.getByText("How many records are in each table?");
    fireEvent.click(samplePromptBtn);

    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole("alert", { name: /AI Generation Failed/i })).toBeInTheDocument();
      expect(
        screen.getAllByText(/The AI assistant is temporarily busy or rate-limited/).length,
      ).toBeGreaterThanOrEqual(1);
      const retryButtons = screen.getAllByRole("button", { name: /retry/i });
      expect(retryButtons.length).toBeGreaterThanOrEqual(1);
    });

    // Clicking retry attempts generation again
    generateSpy.mockResolvedValueOnce(mockTurn);
    const retryButtons = screen.getAllByRole("button", { name: /retry/i });
    fireEvent.click(retryButtons[0]!);

    await waitFor(() => {
      expect(generateSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps the asked question continuously visible while workspace refetches after answer resolves", async () => {
    const emptyWorkspaceMock: SqlWorkspaceStateResponse = {
      connections: [mockConnection],
      active_connection_id: "conn-123",
      turns: [],
    };

    const delayedTurn: SqlQueryTurnResponse = {
      ...mockTurn,
      id: "turn-new-1",
      question: "How many categories do I have?",
      answer_summary: "You have 1 category in total. Would you like to know its name?",
      chart_suggestion: null,
      rows: [],
      row_count: 0,
    };

    let resolveRefetch!: (value: SqlWorkspaceStateResponse) => void;
    const fetchSpy = vi
      .spyOn(sqlApi, "fetchSqlWorkspace")
      .mockResolvedValueOnce(emptyWorkspaceMock)
      .mockImplementationOnce(
        () =>
          new Promise<SqlWorkspaceStateResponse>((resolve) => {
            resolveRefetch = resolve;
          }),
      );

    vi.spyOn(sqlApi, "generateSqlQueryTurn").mockResolvedValueOnce(delayedTurn);

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SqlAssistantView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Connected to Sales Replica DB")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Ask Margin...");
    fireEvent.change(input, { target: { value: "How many categories do I have?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Margin" }));

    // Immediately after submit and immediately after turn resolves (even BEFORE refetch completes),
    // the question stays continuously visible alongside the newly returned answer.
    expect(screen.getByText("How many categories do I have?")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText("You have 1 category in total. Would you like to know its name?"),
      ).toBeInTheDocument();
      expect(screen.getByText("How many categories do I have?")).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    resolveRefetch({
      connections: [mockConnection],
      active_connection_id: "conn-123",
      turns: [delayedTurn],
    });
  });

  it("allows dragging a table from Schema Explorer into chat and sends focused_tables", async () => {
    const emptyWorkspaceMock: SqlWorkspaceStateResponse = {
      connections: [mockConnection],
      active_connection_id: "conn-123",
      turns: [],
    };
    const focusedTurn: SqlQueryTurnResponse = {
      ...mockTurn,
      id: "turn-focused-1",
      question: "How many rows are in this table?",
      answer_summary: "There are 12 orders in total. Would you like to see the top categories?",
      chart_suggestion: null,
      rows: [],
      row_count: 0,
    };

    vi.spyOn(sqlApi, "fetchSqlWorkspace").mockResolvedValue(emptyWorkspaceMock);
    const generateSpy = vi
      .spyOn(sqlApi, "generateSqlQueryTurn")
      .mockResolvedValueOnce(focusedTurn);

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SqlAssistantView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("orders")).toBeInTheDocument();
    });

    const dataTransfer = {
      data: {} as Record<string, string>,
      types: ["application/x-margin-sql-table"],
      effectAllowed: "copy",
      dropEffect: "copy",
      setData(type: string, val: string) {
        this.data[type] = val;
      },
      getData(type: string) {
        return this.data[type] ?? "";
      },
    };

    const ordersCard = screen.getByText("orders").closest("[draggable='true']");
    expect(ordersCard).not.toBeNull();
    fireEvent.dragStart(ordersCard!, { dataTransfer });

    const composer = screen.getByPlaceholderText("Ask Margin...");
    const chatDropSurface = composer.closest(".relative.flex-1");
    expect(chatDropSurface).not.toBeNull();

    fireEvent.dragOver(chatDropSurface!, { dataTransfer });
    expect(
      screen.getByText("Drop table here to ask questions directly about it"),
    ).toBeInTheDocument();

    fireEvent.drop(chatDropSurface!, { dataTransfer });
    fireEvent.dragEnd(ordersCard!);

    expect(screen.getByText("Focused tables:")).toBeInTheDocument();
    const focusedInput = screen.getByPlaceholderText("Ask Margin...");
    fireEvent.change(focusedInput, { target: { value: "How many rows are in this table?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Margin" }));

    await waitFor(() => {
      expect(generateSpy).toHaveBeenCalledWith("conn-123", {
        question: "How many rows are in this table?",
        execute_immediately: true,
        focused_tables: ["orders"],
      });
    });

    // Can also remove the focused table chip cleanly
    fireEvent.click(screen.getByRole("button", { name: "Remove orders" }));
    expect(screen.queryByText("Focused tables:")).not.toBeInTheDocument();
  });

  it("renders ChatErrorBubble dismiss button and invokes onDismiss", () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();
    render(
      <ChatErrorBubble error="Network hiccup" onRetry={onRetry} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
