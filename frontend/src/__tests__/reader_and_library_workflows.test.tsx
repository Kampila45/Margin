/**
 * Frontend unit & component tests for reader selection state, floating toolbar actions, and citation cards.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSidebarNav } from "../components/shared/workspace_sidebar_nav";
import { ChatMessageTranscript } from "../features/chat/chat_message_transcript";
import { CitationSourceCard } from "../features/chat/citation_source_card";
import { ReaderAssistantSidebar } from "../features/chat/reader_assistant_sidebar";
import { FloatingSelectionToolbar } from "../features/reader/floating_selection_toolbar";
import { highlightPassageInTextLayer } from "../features/reader/pdf_document_stage";
import * as conversationApi from "../services/conversation_api_client";
import * as documentApi from "../services/document_api_client";
import { useReaderSelectionStore } from "../stores/reader_selection_store";
import {
  CHAT_MODE,
  DOCUMENT_FORMAT,
  DOCUMENT_STATUS,
  MESSAGE_ROLE,
  type CitationResponse,
} from "../types/api_contract_types";

describe("Margin Frontend Reader Selection & Citation Workflows", () => {
  beforeEach(() => {
    useReaderSelectionStore.setState({
      activeDocumentId: null,
      currentPageNumber: 1,
      zoomPercentage: 100,
      activeConversationId: null,
      activeChatMode: CHAT_MODE.DOCUMENT_QA,
      activeSelection: null,
      pendingQuickPrompt: null,
      isUploadModalOpen: false,
    });
  });

  it("switches chat mode to selection_qa when a passage is captured and resets on clear", () => {
    const store = useReaderSelectionStore.getState();
    store.capturePassageSelection(
      {
        document_id: "doc-123",
        selected_text: "Multi-head latent attention compresses KV activations.",
        page_number: 4,
      },
      "Explain this passage.",
    );

    const updated = useReaderSelectionStore.getState();
    expect(updated.activeChatMode).toBe(CHAT_MODE.SELECTION_QA);
    expect(updated.activeSelection?.page_number).toBe(4);
    expect(updated.pendingQuickPrompt).toBe("Explain this passage.");

    updated.clearPassageSelection();
    const cleared = useReaderSelectionStore.getState();
    expect(cleared.activeChatMode).toBe(CHAT_MODE.DOCUMENT_QA);
    expect(cleared.activeSelection).toBeNull();
  });

  it("renders floating selection toolbar only when non-empty text is selected and triggers actions", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();

    const { rerender } = render(
      <FloatingSelectionToolbar
        selectedText=""
        position={{ top: 100, left: 200 }}
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();

    rerender(
      <FloatingSelectionToolbar
        selectedText="Highlighted claim from page 4"
        position={{ top: 100, left: 200 }}
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Explain"));
    expect(onAction).toHaveBeenCalledWith("explain");
  });

  it("navigates to the cited document and page when a CitationSourceCard is clicked", () => {
    const onNavigate = vi.fn();
    const sampleCitation: CitationResponse = {
      citation_index: 1,
      chunk_id: "chunk-1",
      document_id: "doc-99",
      document_filename: "deepseek_v3.pdf",
      chunk_index: 3,
      page_number: 8,
      excerpt: "We compress the key and value into a low-rank joint latent space.",
      score: 0.94,
    };

    render(
      <CitationSourceCard
        citation={sampleCitation}
        onNavigateToCitation={onNavigate}
      />,
    );

    expect(screen.getByText("deepseek_v3.pdf")).toBeInTheDocument();
    expect(screen.getByText("Page 8")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));
    expect(onNavigate).toHaveBeenCalledWith(sampleCitation);
  });

  it("highlights only Library and not Active Reader when visiting /library with 0 documents", () => {
    render(
      <MemoryRouter initialEntries={["/library"]}>
        <WorkspaceSidebarNav
          documentCount={0}
          conversationCount={0}
          totalBytesUsed={0}
          firstReadyDocumentId={null}
        />
      </MemoryRouter>,
    );

    const libraryLink = screen.getByRole("link", { name: /Library/i });
    const activeReaderLink = screen.getByRole("link", { name: /Active Reader/i });

    expect(libraryLink).toHaveAttribute("aria-current", "page");
    expect(activeReaderLink).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: /AI Synthesis/i })).not.toBeInTheDocument();
    expect(screen.getByText("Document Storage")).toBeInTheDocument();
    expect(screen.getByText("SQL Session")).toBeInTheDocument();
    expect(screen.getByText("0 dbs")).toBeInTheDocument();
    expect(screen.getByText("100 rows · 5s max")).toBeInTheDocument();
  });

  it("displays connected SQL database and table counts in the sidebar footer card", () => {
    render(
      <MemoryRouter initialEntries={["/sql"]}>
        <WorkspaceSidebarNav
          documentCount={2}
          databaseCount={1}
          sqlTableCount={26}
          totalBytesUsed={124_416}
          firstReadyDocumentId={null}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("2 / 25 docs")).toBeInTheDocument();
    expect(screen.getByText("1 db")).toBeInTheDocument();
    expect(screen.getByText("26 tables")).toBeInTheDocument();
    expect(screen.getByText("100 rows · 5s max")).toBeInTheDocument();
  });

  it("displays the optimistic user message bubble alongside the answer-in-progress indicator", () => {
    render(
      <ChatMessageTranscript
        messages={[
          {
            id: "optimistic-user-1",
            conversation_id: "pending",
            role: MESSAGE_ROLE.USER,
            mode: CHAT_MODE.SELECTION_QA,
            content: "tell me more about highlighted section?",
            selected_text: "Systems analysts bridge business requirements and architecture.",
            selected_page_number: 2,
            insufficient_context: false,
            citations: [],
            created_at: new Date().toISOString(),
          },
        ]}
        isGenerating={true}
        onNavigateToCitation={vi.fn()}
      />,
    );

    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("tell me more about highlighted section?")).toBeInTheDocument();
    expect(screen.getByText("Page 2 selection")).toBeInTheDocument();
    expect(screen.getByLabelText("Thinking…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("renders structured markdown headings, bullet lists, bold labels, and clickable inline citation pills in assistant answers", () => {
    const onNavigate = vi.fn();
    const citation: CitationResponse = {
      citation_index: 1,
      chunk_id: "chunk-1",
      document_id: "doc-warma",
      document_filename: "Senior_Systems_Analyst_2026-1.pdf",
      chunk_index: 0,
      page_number: 1,
      excerpt: "WARMA is an Equal Opportunity Employer.",
      score: 0.96,
    };

    render(
      <ChatMessageTranscript
        messages={[
          {
            id: "assistant-msg-1",
            conversation_id: "conv-1",
            role: MESSAGE_ROLE.ASSISTANT,
            mode: CHAT_MODE.SELECTION_QA,
            content:
              "### Organization and Mandate\n* **Organization:** Water Resources Management Authority (WARMA) [1].\n* **Notice Date:** September 2026 [1].",
            selected_text: null,
            selected_page_number: null,
            insufficient_context: false,
            citations: [citation],
            created_at: new Date().toISOString(),
          },
        ]}
        isGenerating={false}
        onNavigateToCitation={onNavigate}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Organization and Mandate" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Organization:")).toBeInTheDocument();
    expect(screen.getByText("Notice Date:")).toBeInTheDocument();

    const inlineCitationButtons = screen.getAllByRole("button", { name: "[1]" });
    expect(inlineCitationButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(inlineCitationButtons[0]!);
    expect(onNavigate).toHaveBeenCalledWith(citation);
  });

  it("normalizes provider-native lenticular citation tags into clickable [1] pills", () => {
    const onNavigate = vi.fn();
    const citation: CitationResponse = {
      citation_index: 1,
      chunk_id: "chunk-warma-1",
      document_id: "doc-warma",
      document_filename: "Senior_Systems_Analyst_2026-1.pdf",
      chunk_index: 0,
      page_number: 1,
      excerpt: "Regulate and manage the use of Zambia's water resources.",
      score: 0.96,
    };

    render(
      <ChatMessageTranscript
        messages={[
          {
            id: "assistant-msg-lenticular",
            conversation_id: "conv-1",
            role: MESSAGE_ROLE.ASSISTANT,
            mode: CHAT_MODE.SELECTION_QA,
            content: "WARMA manages water resources 【1†L1-L4】 .",
            selected_text: null,
            selected_page_number: null,
            insufficient_context: false,
            citations: [citation],
            created_at: new Date().toISOString(),
          },
        ]}
        isGenerating={false}
        onNavigateToCitation={onNavigate}
      />,
    );

    expect(screen.queryByText(/【1†L1-L4】/)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "[1]" });
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledWith(citation);
  });

  it("highlights matching PDF text-layer spans and updates current page when a citation is clicked", () => {
    const citation: CitationResponse = {
      citation_index: 2,
      chunk_id: "chunk-2",
      document_id: "doc-warma",
      document_filename: "Senior_Systems_Analyst_2026-1.pdf",
      chunk_index: 1,
      page_number: 2,
      excerpt:
        "Business Analysis: Analysing business needs and converting them into clear functional and technical requirements, process maps, data models, diagrams, and system specifications.",
      score: 0.93,
    };

    useReaderSelectionStore.getState().highlightCitation(citation);
    const state = useReaderSelectionStore.getState();
    expect(state.activeDocumentId).toBe("doc-warma");
    expect(state.currentPageNumber).toBe(2);
    expect(state.activeCitationHighlight?.citation_index).toBe(2);

    const container = document.createElement("div");
    const spanHeader = document.createElement("span");
    spanHeader.textContent = "WATER RESOURCES MANAGEMENT AUTHORITY";
    const spanLine1 = document.createElement("span");
    spanLine1.textContent =
      "• Analyse business needs and translate them into clear functional and technical";
    const spanLine2 = document.createElement("span");
    spanLine2.textContent =
      "requirements, process maps, data models, diagrams and system specifications.";
    container.append(spanHeader, spanLine1, spanLine2);

    const firstMatched = highlightPassageInTextLayer(container, citation.excerpt);
    expect(firstMatched).toBe(spanLine1);
    expect(spanHeader).not.toHaveClass("margin-pdf-citation-highlight");
    expect(spanLine1).toHaveClass("margin-pdf-citation-highlight");
    expect(spanLine2).toHaveClass("margin-pdf-citation-highlight");
  });

  it("renders markdown tables, inline breaks, and table-cell citations without raw pipes", () => {
    const onNavigate = vi.fn();
    const citation: CitationResponse = {
      citation_index: 1,
      chunk_id: "chunk-1",
      document_id: "doc-warma",
      document_filename: "Senior_Systems_Analyst_2026-1.pdf",
      chunk_index: 0,
      page_number: 1,
      excerpt: "Water Resources Management Authority (WARMA) — Lusaka Head Office.",
      score: 0.91,
    };

    render(
      <ChatMessageTranscript
        messages={[
          {
            id: "msg-table-1",
            conversation_id: "conv-table-1",
            role: MESSAGE_ROLE.ASSISTANT,
            mode: CHAT_MODE.DOCUMENT_QA,
            content: [
              "**Document Overview**",
              "",
              "| Item | Details |",
              "|------|---------|",
              "| **Employer** | Water Resources Management Authority [1] |",
              "| **Duties** | • Analyse systems [1] <br>• Maintain APIs |",
            ].join("\n"),
            selected_text: null,
            selected_page_number: null,
            insufficient_context: false,
            citations: [citation],
            created_at: new Date().toISOString(),
          },
        ]}
        isGenerating={false}
        onNavigateToCitation={onNavigate}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByText("Employer")).toBeInTheDocument();
    expect(screen.queryByText(/<br>/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\|------\|/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Verified Citation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Verified Source Passages/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Margin Synthesis")).not.toBeInTheDocument();
    expect(screen.queryByText("Margin AI")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "[1]" }).length).toBeGreaterThanOrEqual(2);
  });

  it("resets activeConversationId when switching to a different active document", () => {
    const store = useReaderSelectionStore.getState();
    store.setActiveDocument("doc-a", 1);
    store.setActiveConversationId("conv-for-doc-a");
    expect(useReaderSelectionStore.getState().activeConversationId).toBe("conv-for-doc-a");

    // Re-setting the same document preserves the conversation thread.
    store.setActiveDocument("doc-a", 2);
    expect(useReaderSelectionStore.getState().activeConversationId).toBe("conv-for-doc-a");

    // Switching to another document clears the prior thread immediately.
    store.setActiveDocument("doc-b", 1);
    expect(useReaderSelectionStore.getState().activeConversationId).toBeNull();
  });

  it("allows resizing the active reader chat sidebar via border drag or keyboard", async () => {
    vi.spyOn(conversationApi, "fetchConversationsList").mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(documentApi, "fetchDocumentsList").mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ReaderAssistantSidebar
          document={{
            id: "doc-resize-1",
            original_filename: "Nyasha Kampila CL.docx",
            doc_format: DOCUMENT_FORMAT.DOCX,
            file_size_bytes: 20480,
            page_count: 1,
            chunk_count: 3,
            status: DOCUMENT_STATUS.READY,
            error_message: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }}
          onNavigateToCitation={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const aside = screen.getByRole("complementary", { name: "Margin AI Chat Panel" });
    const separator = screen.getByRole("separator", { name: "Resize chat panel" });
    expect(aside).toHaveStyle({ width: "410px" });

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(aside).toHaveStyle({ width: "434px" });

    fireEvent.mouseDown(separator, { clientX: 600 });
    fireEvent.mouseMove(window, { clientX: 500 });
    fireEvent.mouseUp(window);
    expect(aside).toHaveStyle({ width: "534px" });
  });

  it("allows adding other indexed documents into Active Reader chat scope", async () => {
    const nowIso = new Date().toISOString();
    const primaryDoc = {
      id: "doc-primary-1",
      original_filename: "Senior_Systems_Analyst_2026-1.pdf",
      doc_format: DOCUMENT_FORMAT.PDF,
      file_size_bytes: 40960,
      page_count: 3,
      chunk_count: 8,
      status: DOCUMENT_STATUS.READY,
      error_message: null,
      created_at: nowIso,
      updated_at: nowIso,
    };
    const extraDoc = {
      id: "doc-extra-2",
      original_filename: "Architecture_Appendix.pdf",
      doc_format: DOCUMENT_FORMAT.PDF,
      file_size_bytes: 20480,
      page_count: 5,
      chunk_count: 10,
      status: DOCUMENT_STATUS.READY,
      error_message: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    vi.spyOn(conversationApi, "fetchConversationsList").mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(documentApi, "fetchDocumentsList").mockResolvedValue({
      items: [primaryDoc, extraDoc],
      total: 2,
      limit: 50,
      offset: 0,
    });
    const createConvSpy = vi.spyOn(conversationApi, "createConversationThread").mockResolvedValue({
      id: "conv-multi-1",
      document_id: primaryDoc.id,
      document_ids: [primaryDoc.id, extraDoc.id],
      title: "Multi-doc thread",
      created_at: nowIso,
      updated_at: nowIso,
    });
    vi.spyOn(conversationApi, "submitConversationQuestion").mockResolvedValue({
      user_message: {
        id: "u1",
        conversation_id: "conv-multi-1",
        role: MESSAGE_ROLE.USER,
        mode: CHAT_MODE.DOCUMENT_QA,
        content: "Compare both docs",
        selected_text: null,
        selected_page_number: null,
        insufficient_context: false,
        citations: [],
        created_at: nowIso,
      },
      assistant_message: {
        id: "a1",
        conversation_id: "conv-multi-1",
        role: MESSAGE_ROLE.ASSISTANT,
        mode: CHAT_MODE.DOCUMENT_QA,
        content: "Here is the comparison.",
        selected_text: null,
        selected_page_number: null,
        insufficient_context: false,
        citations: [],
        created_at: nowIso,
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ReaderAssistantSidebar document={primaryDoc} onNavigateToCitation={vi.fn()} />
      </QueryClientProvider>,
    );

    const addDocBtn = await screen.findByRole("button", { name: "Add documents to scope" });
    fireEvent.click(addDocBtn);

    const extraOption = screen.getByRole("button", { name: /Architecture_Appendix\.pdf/i });
    fireEvent.click(extraOption);

    expect(
      screen.getAllByText("Architecture_Appendix.pdf").length,
    ).toBeGreaterThanOrEqual(2);

    const input = screen.getByPlaceholderText("Ask Margin...");
    fireEvent.change(input, { target: { value: "Compare both docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Margin" }));

    await waitFor(() => {
      expect(createConvSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          document_ids: ["doc-primary-1", "doc-extra-2"],
        }),
      );
    });
  });

  it("hides the thinking indicator immediately once an answer renders even while background refetch is pending", async () => {
    const nowIso = new Date().toISOString();
    const doc = {
      id: "doc-thinking-1",
      original_filename: "Nyasha Kampila CL.docx",
      doc_format: DOCUMENT_FORMAT.DOCX,
      file_size_bytes: 20480,
      page_count: 1,
      chunk_count: 3,
      status: DOCUMENT_STATUS.READY,
      error_message: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    vi.spyOn(conversationApi, "fetchConversationsList").mockResolvedValue({
      items: [
        {
          id: "conv-existing-1",
          document_id: doc.id,
          document_ids: [doc.id],
          title: "Notes on Nyasha Kampila CL.docx",
          created_at: nowIso,
          updated_at: nowIso,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    vi.spyOn(documentApi, "fetchDocumentsList").mockResolvedValue({
      items: [doc],
      total: 1,
      limit: 50,
      offset: 0,
    });

    let resolveRefetch!: (val: Awaited<ReturnType<typeof conversationApi.fetchConversationDetail>>) => void;
    const detailSpy = vi
      .spyOn(conversationApi, "fetchConversationDetail")
      .mockResolvedValueOnce({
        id: "conv-existing-1",
        document_id: doc.id,
        document_ids: [doc.id],
        title: "Notes on Nyasha Kampila CL.docx",
        created_at: nowIso,
        updated_at: nowIso,
        messages: [],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefetch = resolve;
          }),
      );

    const turnResponse = {
      user_message: {
        id: "u-think-1",
        conversation_id: "conv-existing-1",
        role: MESSAGE_ROLE.USER,
        mode: CHAT_MODE.DOCUMENT_QA,
        content: "so why did you say she?",
        selected_text: null,
        selected_page_number: null,
        insufficient_context: false,
        citations: [],
        created_at: nowIso,
      },
      assistant_message: {
        id: "a-think-1",
        conversation_id: "conv-existing-1",
        role: MESSAGE_ROLE.ASSISTANT,
        mode: CHAT_MODE.DOCUMENT_QA,
        content: "The documents do not contain any gender-specific language.",
        selected_text: null,
        selected_page_number: null,
        insufficient_context: false,
        citations: [],
        created_at: nowIso,
      },
    };
    vi.spyOn(conversationApi, "submitConversationQuestion").mockResolvedValue(turnResponse);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ReaderAssistantSidebar document={doc} onNavigateToCitation={vi.fn()} />
      </QueryClientProvider>,
    );

    const input = await screen.findByPlaceholderText("Ask Margin...");
    await waitFor(() => {
      expect(detailSpy).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(input, { target: { value: "so why did you say she?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Margin" }));

    await waitFor(() => {
      expect(
        screen.getByText("The documents do not contain any gender-specific language."),
      ).toBeInTheDocument();
    });

    // Thinking indicator must already be hidden even before the background detail refetch resolves.
    expect(screen.queryByRole("status", { name: "Thinking…" })).not.toBeInTheDocument();

    resolveRefetch({
      id: "conv-existing-1",
      document_id: doc.id,
      document_ids: [doc.id],
      title: "Notes on Nyasha Kampila CL.docx",
      created_at: nowIso,
      updated_at: nowIso,
      messages: [turnResponse.user_message, turnResponse.assistant_message],
    });
  });
});

