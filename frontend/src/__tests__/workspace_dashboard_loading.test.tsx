/**
 * Frontend unit tests verifying WorkspaceDashboardView renders loading skeletons instead of
 * misleading zero counts or empty-state messages while initial workspace data is in flight.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDashboardView } from "../features/workspace/workspace_dashboard_view";
import * as conversationApi from "../services/conversation_api_client";
import * as documentApi from "../services/document_api_client";
import * as sqlApi from "../services/sql_api_client";
import { DOCUMENT_FORMAT, DOCUMENT_STATUS } from "../types/api_contract_types";

describe("WorkspaceDashboardView loading and error states", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("shows loading skeletons instead of zero counts or empty states while documents are pending", async () => {
    let resolveDocs!: (value: Awaited<ReturnType<typeof documentApi.fetchDocumentsList>>) => void;
    const docsPromise = new Promise<Awaited<ReturnType<typeof documentApi.fetchDocumentsList>>>(
      (resolve) => {
        resolveDocs = resolve;
      },
    );

    vi.spyOn(documentApi, "fetchDocumentsList").mockReturnValue(docsPromise);
    vi.spyOn(conversationApi, "fetchConversationsList").mockReturnValue(
      new Promise(() => {}),
    );
    vi.spyOn(sqlApi, "fetchSqlWorkspace").mockReturnValue(new Promise(() => {}));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <WorkspaceDashboardView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Loading workspace summary")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading recent documents")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading recent document threads")).toBeInTheDocument();
    expect(screen.queryByText("0 indexed")).not.toBeInTheDocument();
    expect(screen.queryByText(/No documents uploaded yet/i)).not.toBeInTheDocument();

    resolveDocs({
      items: [
        {
          id: "doc-1",
          original_filename: "Senior_Systems_Analyst_2026-1.pdf",
          doc_format: DOCUMENT_FORMAT.PDF,
          file_size_bytes: 95500,
          page_count: 3,
          chunk_count: 10,
          status: DOCUMENT_STATUS.READY,
          error_message: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    await waitFor(() => {
      expect(screen.getByText("1 indexed")).toBeInTheDocument();
      expect(screen.getByText("Senior_Systems_Analyst_2026-1.pdf")).toBeInTheDocument();
    });
  });

  it("shows loading skeletons on SQL Studio tab while pending instead of No Database Connected", () => {
    vi.spyOn(documentApi, "fetchDocumentsList").mockReturnValue(new Promise(() => {}));
    vi.spyOn(conversationApi, "fetchConversationsList").mockReturnValue(
      new Promise(() => {}),
    );
    vi.spyOn(sqlApi, "fetchSqlWorkspace").mockReturnValue(new Promise(() => {}));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/?tab=sql"]}>
          <WorkspaceDashboardView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Loading workspace summary")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading SQL Studio summary")).toBeInTheDocument();
    expect(screen.queryByText("No Database Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("0 databases")).not.toBeInTheDocument();
  });

  it("renders a retry state on document fetch error rather than claiming no documents exist", async () => {
    vi.spyOn(documentApi, "fetchDocumentsList").mockRejectedValue(
      new Error("Network error"),
    );
    vi.spyOn(conversationApi, "fetchConversationsList").mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(sqlApi, "fetchSqlWorkspace").mockResolvedValue({
      connections: [],
      active_connection_id: null,
      turns: [],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <WorkspaceDashboardView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Could not load your documents right now."),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/No documents uploaded yet/i)).not.toBeInTheDocument();
  });
});
