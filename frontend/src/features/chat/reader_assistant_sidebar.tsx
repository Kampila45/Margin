/**
 * Right-hand contextual AI assistant sidebar inside the Three-Panel Document Reader.
 * Supports switching between `selection_qa` (when a passage is highlighted) and `document_qa`
 * across the open document plus any additional indexed documents added to scope.
 */

import { useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { MarginChatPanel } from "../../components/shared/margin_chat_panel";
import { MarginBrandLogo } from "../../components/ui/margin_brand_logo";
import { submitConversationQuestion } from "../../services/conversation_api_client";
import { getUserFriendlyErrorMessage } from "../../services/margin_http_client";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";
import {
  CHAT_MODE,
  DOCUMENT_STATUS,
  MESSAGE_ROLE,
  type ChatMessageResponse,
  type CitationResponse,
  type ConversationDetailResponse,
  type DocumentResponse,
} from "../../types/api_contract_types";
import { useDocumentsListQuery } from "../documents/use_document_queries";
import { mapConversationMessagesToChatMessages } from "./chat_message_transcript";
import {
  CONVERSATION_QUERY_KEYS,
  useAskConversationQuestionMutation,
  useConversationDetailQuery,
  useConversationsListQuery,
  useCreateConversationMutation,
} from "./use_conversation_queries";

interface ReaderAssistantSidebarProps {
  document: DocumentResponse;
  initialConversationId?: string | null;
  onNavigateToCitation: (citation: CitationResponse) => void;
}

export function ReaderAssistantSidebar({
  document,
  initialConversationId,
  onNavigateToCitation,
}: ReaderAssistantSidebarProps) {
  const queryClient = useQueryClient();
  const activeConversationId = useReaderSelectionStore((s) => s.activeConversationId);
  const setActiveConversationId = useReaderSelectionStore((s) => s.setActiveConversationId);
  const activeChatMode = useReaderSelectionStore((s) => s.activeChatMode);
  const activeSelection = useReaderSelectionStore((s) => s.activeSelection);
  const pendingQuickPrompt = useReaderSelectionStore((s) => s.pendingQuickPrompt);
  const clearPassageSelection = useReaderSelectionStore((s) => s.clearPassageSelection);
  const consumePendingQuickPrompt = useReaderSelectionStore((s) => s.consumePendingQuickPrompt);

  const [questionInput, setQuestionInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessageResponse | null>(null);
  const [failedUserMessage, setFailedUserMessage] = useState<ChatMessageResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(410);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [scopedDocumentIds, setScopedDocumentIds] = useState<string[]>([document.id]);
  const [isScopePickerOpen, setIsScopePickerOpen] = useState(false);
  const initializedThreadForDocRef = useRef<string | null>(null);

  const clampSidebarWidth = (width: number) => {
    const maxViewportWidth =
      typeof window !== "undefined" ? Math.max(480, Math.floor(window.innerWidth * 0.65)) : 820;
    return Math.min(Math.min(820, maxViewportWidth), Math.max(320, width));
  };

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeStateRef.current) {
        return;
      }
      const deltaX = resizeStateRef.current.startX - event.clientX;
      setSidebarWidth(clampSidebarWidth(resizeStateRef.current.startWidth + deltaX));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeStateRef.current = null;
      window.document.body.style.userSelect = "";
      window.document.body.style.cursor = "";
    };

    window.document.body.style.userSelect = "none";
    window.document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.document.body.style.userSelect = "";
      window.document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const handleResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    setIsResizing(true);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSidebarWidth((prev) => clampSidebarWidth(prev + 24));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSidebarWidth((prev) => clampSidebarWidth(prev - 24));
    }
  };

  const conversationsListQuery = useConversationsListQuery(document.id);
  const readyDocumentsQuery = useDocumentsListQuery({
    status: DOCUMENT_STATUS.READY,
    limit: 50,
  });
  const createConversationMutation = useCreateConversationMutation();

  const extraReadyDocuments = useMemo(() => {
    const items = readyDocumentsQuery.data?.items ?? [];
    return items.filter((item) => item.id !== document.id);
  }, [readyDocumentsQuery.data?.items, document.id]);

  // Reset scope cleanly when the open reader document changes.
  useEffect(() => {
    setScopedDocumentIds([document.id]);
    setIsScopePickerOpen(false);
    initializedThreadForDocRef.current = null;
  }, [document.id]);

  // Select either the URL-requested conversation or the latest existing thread once per document.
  useEffect(() => {
    if (initialConversationId) {
      initializedThreadForDocRef.current = document.id;
      setActiveConversationId(initialConversationId);
      return;
    }
    if (initializedThreadForDocRef.current === document.id) {
      return;
    }
    if (!conversationsListQuery.data) {
      return;
    }
    initializedThreadForDocRef.current = document.id;
    const items = conversationsListQuery.data.items ?? [];
    if (items.length > 0 && items[0]) {
      setActiveConversationId(items[0].id);
    } else {
      setActiveConversationId(null);
    }
  }, [document.id, initialConversationId, conversationsListQuery.data, setActiveConversationId]);

  // Populate composer when the user clicks "Explain" or "Summarise" on the floating selection toolbar.
  useEffect(() => {
    if (pendingQuickPrompt) {
      setQuestionInput(pendingQuickPrompt);
      consumePendingQuickPrompt();
    }
  }, [pendingQuickPrompt, consumePendingQuickPrompt]);

  const conversationDetailQuery = useConversationDetailQuery(activeConversationId);
  const askQuestionMutation = useAskConversationQuestionMutation(activeConversationId);

  // Sync scoped documents from a loaded multi-document conversation thread.
  useEffect(() => {
    const loaded = conversationDetailQuery.data;
    if (!loaded || loaded.id !== activeConversationId) {
      return;
    }
    const threadDocIds = loaded.document_ids.includes(document.id)
      ? loaded.document_ids
      : [document.id, ...loaded.document_ids];
    setScopedDocumentIds(threadDocIds);
  }, [conversationDetailQuery.data, activeConversationId, document.id]);

  const toggleDocumentInScope = (targetDocId: string) => {
    if (targetDocId === document.id) {
      return;
    }
    const nextDocIds = scopedDocumentIds.includes(targetDocId)
      ? scopedDocumentIds.filter((id) => id !== targetDocId)
      : [...scopedDocumentIds, targetDocId];

    setScopedDocumentIds(nextDocIds);

    if (activeConversationId) {
      const activeThreadDocs =
        conversationDetailQuery.data?.id === activeConversationId
          ? conversationDetailQuery.data.document_ids
          : conversationsListQuery.data?.items.find((c) => c.id === activeConversationId)
              ?.document_ids;
      const currentSorted = [...(activeThreadDocs ?? [document.id])].sort().join(",");
      const nextSorted = [...nextDocIds].sort().join(",");
      if (currentSorted !== nextSorted) {
        // Start a clean thread when scope changes so history stays aligned with scoped documents.
        setActiveConversationId(null);
      }
    }
  };

  const submitQuestion = async (overrideText?: string) => {
    const textToSubmit = overrideText ?? questionInput;
    const trimmed = textToSubmit.trim();
    if (!trimmed || isSending) {
      return;
    }

    const currentMode = activeSelection ? CHAT_MODE.SELECTION_QA : CHAT_MODE.DOCUMENT_QA;
    const selectionSnapshot = activeSelection
      ? {
          document_id: document.id,
          selected_text: activeSelection.selected_text,
          page_number: activeSelection.page_number,
        }
      : null;

    const optimisticUserMessage: ChatMessageResponse = {
      id: `optimistic-user-${Date.now()}`,
      conversation_id: activeConversationId ?? "pending",
      role: MESSAGE_ROLE.USER,
      mode: currentMode,
      content: trimmed,
      selected_text: selectionSnapshot?.selected_text ?? null,
      selected_page_number: selectionSnapshot?.page_number ?? null,
      insufficient_context: false,
      citations: [],
      created_at: new Date().toISOString(),
    };

    // Immediately move the message out of the input box and into the chat transcript.
    if (!overrideText) {
      setQuestionInput("");
    }
    setPendingUserMessage(optimisticUserMessage);
    setFailedUserMessage(null);
    setIsSending(true);
    setErrorMessage(null);

    try {
      let targetConvId = activeConversationId;
      let createdTitle =
        scopedDocumentIds.length > 1
          ? `${document.original_filename} + ${scopedDocumentIds.length - 1} more`
          : `Notes on ${document.original_filename}`;
      if (!targetConvId) {
        const created = await createConversationMutation.mutateAsync({
          document_ids: scopedDocumentIds,
          title: createdTitle,
        });
        targetConvId = created.id;
        createdTitle = created.title;
        setActiveConversationId(created.id);
      }

      const turn = await submitConversationQuestion(targetConvId, {
        question: trimmed,
        mode: currentMode,
        selection: selectionSnapshot,
      });

      await queryClient.cancelQueries({
        queryKey: CONVERSATION_QUERY_KEYS.detail(targetConvId),
      });
      queryClient.setQueryData<ConversationDetailResponse>(
        CONVERSATION_QUERY_KEYS.detail(targetConvId),
        (existing) => {
          const baseMessages = (existing?.messages ?? []).filter(
            (m) => m.id !== turn.user_message.id && m.id !== turn.assistant_message.id,
          );
          const nowIso = new Date().toISOString();
          return {
            id: targetConvId,
            document_id: existing?.document_id ?? document.id,
            document_ids: existing?.document_ids ?? scopedDocumentIds,
            title: existing?.title ?? createdTitle,
            created_at: existing?.created_at ?? nowIso,
            updated_at: nowIso,
            messages: [...baseMessages, turn.user_message, turn.assistant_message],
          };
        },
      );

      setPendingUserMessage(null);
      setFailedUserMessage(null);
      setIsSending(false);
      void queryClient.invalidateQueries({
        queryKey: CONVERSATION_QUERY_KEYS.detail(targetConvId),
      });
      void queryClient.invalidateQueries({
        queryKey: CONVERSATION_QUERY_KEYS.all,
      });
    } catch (error: unknown) {
      setPendingUserMessage(null);
      setFailedUserMessage(optimisticUserMessage);
      if (!overrideText) {
        setQuestionInput(trimmed);
      }
      setErrorMessage(
        getUserFriendlyErrorMessage(
          error,
          "The AI assistant is temporarily busy or rate-limited. Please try asking again in a few seconds.",
        ),
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleStartFreshThread = async () => {
    setErrorMessage(null);
    setPendingUserMessage(null);
    try {
      const created = await createConversationMutation.mutateAsync({
        document_ids: scopedDocumentIds,
        title: `Thread • ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      });
      setActiveConversationId(created.id);
    } catch {
      setErrorMessage("Could not start a new conversation thread.");
    }
  };

  const persistedMessages = conversationDetailQuery.data?.messages ?? [];
  const activeUserMsg = pendingUserMessage ?? (errorMessage ? failedUserMessage : null);
  const messages =
    activeUserMsg &&
    !persistedMessages.some(
      (m) => m.role === MESSAGE_ROLE.USER && m.content === activeUserMsg.content && m.created_at >= activeUserMsg.created_at,
    )
      ? [...persistedMessages, activeUserMsg]
      : persistedMessages;
  const isBusy = isSending || createConversationMutation.isPending || askQuestionMutation.isPending;
  const chatMessages = mapConversationMessagesToChatMessages(
    messages,
    onNavigateToCitation,
  );

  return (
    <aside
      style={{ width: `${sidebarWidth}px` }}
      aria-label="Margin AI Chat Panel"
      className="relative bg-surface border-l border-outline-variant/30 flex flex-col shrink-0 h-full min-h-0 min-w-0 shadow-xs"
    >
      {/* Draggable Left Border Resize Handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        aria-valuenow={sidebarWidth}
        aria-valuemin={320}
        aria-valuemax={820}
        tabIndex={0}
        title="Drag border to resize chat panel (double-click to reset)"
        onMouseDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        onDoubleClick={() => setSidebarWidth((prev) => (prev > 460 ? 410 : 580))}
        className={`absolute left-0 top-0 bottom-0 w-2 -ml-1 z-20 cursor-col-resize group flex items-center justify-center transition-colors ${
          isResizing ? "bg-primary/20" : "hover:bg-primary/10"
        }`}
      >
        <span
          className={`w-0.5 h-10 rounded-full transition-colors ${
            isResizing ? "bg-primary" : "bg-outline-variant/45 group-hover:bg-primary"
          }`}
        />
      </div>

      {/* Header */}
      <div className="p-3.5 border-b border-outline-variant/30 flex flex-col gap-2 shrink-0 bg-surface">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MarginBrandLogo variant="icon" className="w-6 h-6 shrink-0" />
            <span className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              Margin AI
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-code-sm bg-emerald-100 text-emerald-800 border border-emerald-300">
              {activeChatMode === CHAT_MODE.SELECTION_QA ? "Selection Mode" : "Document Mode"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void handleStartFreshThread()}
            title="Start new conversation thread"
            aria-label="Start new conversation thread"
            className="p-1.5 hover:bg-surface-container rounded-lg text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">add_comment</span>
          </button>
        </div>

        {/* Active Context Banner: either Selected Passage Chip or Whole-Document Indicator */}
        {activeSelection ? (
          <div className="p-2.5 rounded-lg bg-primary-fixed/35 border border-primary/25 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-label-sm text-[11px] font-semibold text-primary flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">format_quote</span>
                <span>Page {activeSelection.page_number} Highlighted Passage</span>
              </span>
              <button
                type="button"
                onClick={clearPassageSelection}
                className="font-code-sm text-[10px] text-on-surface-variant hover:text-on-surface underline"
              >
                Switch to full doc
              </button>
            </div>
            <p className="font-body-dense text-xs text-on-surface italic line-clamp-2">
              &ldquo;{activeSelection.selected_text}&rdquo;
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-container-low border border-outline-variant/20 text-xs text-on-surface-variant">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                <span className="shrink-0">Scope:</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface border border-outline-variant/30 text-on-surface font-medium max-w-full truncate">
                  <span className="truncate max-w-[165px]">{document.original_filename}</span>
                  <span className="font-code-sm text-[10px] text-outline shrink-0">
                    {document.page_count ?? 1}p
                  </span>
                </span>
                {scopedDocumentIds
                  .filter((id) => id !== document.id)
                  .map((extraId) => {
                    const extraDoc = extraReadyDocuments.find((d) => d.id === extraId);
                    const label = extraDoc?.original_filename ?? extraId.slice(0, 8);
                    return (
                      <span
                        key={extraId}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary-fixed/45 border border-primary/30 text-primary font-medium max-w-full"
                      >
                        <span className="truncate max-w-[140px]">{label}</span>
                        <button
                          type="button"
                          onClick={() => toggleDocumentInScope(extraId)}
                          aria-label={`Remove ${label} from scope`}
                          className="hover:text-error leading-none"
                        >
                          <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                      </span>
                    );
                  })}
              </div>

              {extraReadyDocuments.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsScopePickerOpen((prev) => !prev)}
                  aria-label="Add documents to scope"
                  aria-expanded={isScopePickerOpen}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-outline-variant/35 bg-surface hover:border-primary/40 hover:text-primary font-code-sm text-[10px] transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {isScopePickerOpen ? "expand_less" : "add"}
                  </span>
                  <span>Add doc</span>
                </button>
              )}
            </div>

            {isScopePickerOpen && extraReadyDocuments.length > 0 && (
              <div
                role="region"
                aria-label="Additional indexed documents"
                className="p-2 rounded-lg bg-surface-container-lowest border border-outline-variant/30 shadow-xs space-y-1 max-h-40 overflow-y-auto custom-scroll"
              >
                <span className="block px-1 font-code-sm text-[10px] uppercase tracking-wider text-outline">
                  Include indexed documents
                </span>
                {extraReadyDocuments.map((doc) => {
                  const isIncluded = scopedDocumentIds.includes(doc.id);
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => toggleDocumentInScope(doc.id)}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors ${
                        isIncluded
                          ? "bg-primary-fixed/40 text-primary font-medium"
                          : "hover:bg-surface-container text-on-surface"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="material-symbols-outlined text-[14px] shrink-0">
                          {isIncluded ? "check_box" : "check_box_outline_blank"}
                        </span>
                        <span className="truncate">{doc.original_filename}</span>
                      </span>
                      <span className="font-code-sm text-[10px] text-outline shrink-0">
                        {doc.page_count ?? 1}p
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Shared Reusable Chat Transcript + Composer */}
      <MarginChatPanel
        messages={chatMessages}
        isGenerating={isBusy}
        onNavigateToCitation={onNavigateToCitation}
        errorMessage={errorMessage}
        onRetry={() => {
          const retryText = failedUserMessage?.content ?? questionInput;
          setErrorMessage(null);
          setFailedUserMessage(null);
          void submitQuestion(retryText);
        }}
        onDismissError={() => {
          setErrorMessage(null);
          setFailedUserMessage(null);
        }}
        defaultEmptyTitle="Ask a Grounded Question"
        defaultEmptyDescription="Ask about the full document or highlight any passage in the reader to explain, summarise, or interrogate specific claims."
        composerValue={questionInput}
        onComposerChange={setQuestionInput}
        onSubmit={() => void submitQuestion()}
        composerPlaceholder="Ask Margin..."
        sendButtonTitle="Ask Margin"
        contentWidthClass="w-full"
        scrollContainerClassName="p-4"
      />
    </aside>
  );
}

