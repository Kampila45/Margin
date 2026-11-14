import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentLibraryView } from "../features/documents/document_library_view";
import * as documentApi from "../services/document_api_client";
import { DOCUMENT_FORMAT, DOCUMENT_STATUS, type DocumentResponse } from "../types/api_contract_types";

function makeDoc(overrides: Partial<DocumentResponse> = {}): DocumentResponse {
  return {
    id: "doc-1",
    original_filename: "sample.pdf",
    doc_format: DOCUMENT_FORMAT.PDF,
    file_size_bytes: 2048,
    page_count: 3,
    chunk_count: 5,
    status: DOCUMENT_STATUS.READY,
    error_message: null,
    created_at: "2026-11-11T00:00:00Z",
    updated_at: "2026-11-11T00:00:00Z",
    ...overrides,
  };
}

function renderLibrary() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DocumentLibraryView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Optimistic document deletion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("removes the document and closes the modal immediately while DELETE is in flight", async () => {
    const doc = makeDoc();
    let resolveDelete!: () => void;
    const pendingDelete = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    const listSpy = vi.spyOn(documentApi, "fetchDocumentsList");
    listSpy.mockResolvedValue({ items: [doc], total: 1, limit: 50, offset: 0 });
    vi.spyOn(documentApi, "deleteDocumentById").mockReturnValue(pendingDelete);

    renderLibrary();
    expect(await screen.findByText("sample.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete sample\.pdf/i }));
    expect(screen.getByRole("dialog", { name: "Delete Document?" })).toBeInTheDocument();

    // Update mock before clicking confirm so post-delete refetch stays empty.
    listSpy.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Delete Document" }));

    // Even before pendingDelete resolves, card and modal should already be gone.
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete Document?" })).not.toBeInTheDocument();
      expect(screen.queryByText("sample.pdf")).not.toBeInTheDocument();
    });

    resolveDelete();
    expect(await screen.findByText("Your Margin library is empty")).toBeInTheDocument();
  });

  it("restores the document and shows an alert if deletion fails", async () => {
    const doc = makeDoc();
    let rejectDelete!: (reason?: unknown) => void;
    const failingDelete = new Promise<void>((_resolve, reject) => {
      rejectDelete = reject;
    });

    vi.spyOn(documentApi, "fetchDocumentsList").mockResolvedValue({
      items: [doc],
      total: 1,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(documentApi, "deleteDocumentById").mockReturnValue(failingDelete);

    renderLibrary();
    expect(await screen.findByText("sample.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete sample\.pdf/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Document" }));

    await waitFor(() => {
      expect(screen.queryByText("sample.pdf")).not.toBeInTheDocument();
    });

    rejectDelete(new Error("Network failure"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not delete the document. Your library has been restored.",
    );
    expect(await screen.findByText("sample.pdf")).toBeInTheDocument();
  });
});

