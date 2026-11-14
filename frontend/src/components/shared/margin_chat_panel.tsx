/**
 * Unified, reusable conversational chat panel shared across Margin chat workspaces:
 * - Active Reader Assistant Sidebar (single & multi-document scope)
 * - SQL Assistant Workspace
 */

import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import type { CitationResponse } from "../../types/api_contract_types";
import { ChatErrorBubble } from "../ui/chat_error_bubble";
import { ChatSendButton } from "../ui/chat_send_button";
import { ChatThinkingBubble } from "../ui/chat_thinking_bubble";
import { FormattedAssistantAnswer } from "../ui/formatted_assistant_answer";
import { MarginBrandLogo } from "../ui/margin_brand_logo";

export interface MarginChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  quotedPassage?: {
    text: string;
    pageNumber?: number | null;
  } | null;
  citations?: CitationResponse[];
  extraContent?: ReactNode;
}

export interface MarginChatStreamProps {
  messages: MarginChatMessage[];
  isGenerating: boolean;
  onNavigateToCitation?: (citation: CitationResponse) => void;
  errorMessage?: string | null;
  errorTitle?: string;
  onRetry?: () => void;
  onDismissError?: () => void;
  emptyState?: ReactNode;
  defaultEmptyTitle?: string;
  defaultEmptyDescription?: string;
}

export function MarginChatStream({
  messages,
  isGenerating,
  onNavigateToCitation,
  errorMessage,
  errorTitle,
  onRetry,
  onDismissError,
  emptyState,
  defaultEmptyTitle = "Ask a Grounded Question",
  defaultEmptyDescription = "Ask a question below to get started.",
}: MarginChatStreamProps) {
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messages.length > 0 || isGenerating || errorMessage) {
      transcriptEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
    }
  }, [messages.length, isGenerating, errorMessage]);

  if (messages.length === 0 && !isGenerating && !errorMessage) {
    if (emptyState) {
      return <>{emptyState}</>;
    }
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-on-surface-variant">
        <MarginBrandLogo variant="icon" className="w-10 h-10" />
        <div className="space-y-1 max-w-xs">
          <p className="font-label-md text-label-md font-semibold text-on-surface">
            {defaultEmptyTitle}
          </p>
          <p className="font-body-dense text-xs text-on-surface-variant">
            {defaultEmptyDescription}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 min-w-0">
      {messages.map((msg) => {
        if (msg.role === "user") {
          return (
            <div key={msg.id} className="flex flex-col items-end space-y-1">
              <span className="font-label-sm text-[11px] text-on-surface-variant px-1">
                You
              </span>
              <div className="max-w-[90%] rounded-xl rounded-tr-xs bg-primary text-on-primary p-3.5 shadow-xs space-y-2">
                {msg.quotedPassage && (
                  <div className="text-xs font-code-sm text-on-primary/90 border-l-2 border-on-primary/60 pl-2.5 py-1 italic bg-black/15 rounded-r line-clamp-3">
                    &ldquo;{msg.quotedPassage.text}&rdquo;
                    {msg.quotedPassage.pageNumber !== null &&
                      msg.quotedPassage.pageNumber !== undefined && (
                        <span className="block not-italic text-[10px] text-on-primary/80 mt-0.5">
                          Page {msg.quotedPassage.pageNumber} selection
                        </span>
                      )}
                  </div>
                )}
                <p className="font-body-default text-body-default whitespace-pre-wrap break-words">
                  {msg.content}
                </p>
              </div>
            </div>
          );
        }

        return (
          <div key={msg.id} className="flex items-start gap-2.5 min-w-0">
            <MarginBrandLogo variant="icon" className="w-7 h-7 shrink-0 mt-0.5" />

            <div className="flex-1 min-w-0 rounded-xl rounded-tl-xs bg-surface-container-lowest border border-outline-variant/35 p-4 shadow-xs space-y-3.5">
              <FormattedAssistantAnswer
                content={msg.content}
                citations={msg.citations}
                onNavigateToCitation={onNavigateToCitation}
              />

              {msg.extraContent}
            </div>
          </div>
        );
      })}

      {isGenerating ? (
        <ChatThinkingBubble />
      ) : errorMessage ? (
        <ChatErrorBubble
          error={errorMessage}
          title={errorTitle}
          onRetry={onRetry}
          onDismiss={onDismissError}
        />
      ) : null}

      <div ref={transcriptEndRef} />
    </div>
  );
}

export interface MarginChatPanelProps extends MarginChatStreamProps {
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  composerPlaceholder: string;
  composerDisabled?: boolean;
  composerHeader?: ReactNode;
  composerRef?: RefObject<HTMLTextAreaElement | null>;
  sendButtonTitle?: string;
  contentWidthClass?: string;
  scrollContainerClassName?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  isDragActive?: boolean;
  dropOverlayLabel?: string;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}

export function MarginChatPanel({
  messages,
  isGenerating,
  onNavigateToCitation,
  errorMessage,
  errorTitle,
  onRetry,
  onDismissError,
  emptyState,
  defaultEmptyTitle,
  defaultEmptyDescription,
  composerValue,
  onComposerChange,
  onSubmit,
  composerPlaceholder = "Ask Margin...",
  composerDisabled = false,
  composerHeader,
  composerRef,
  sendButtonTitle = "Ask Margin",
  contentWidthClass = "max-w-3xl mx-auto",
  scrollContainerClassName = "p-4 md:p-6",
  scrollRef,
  isDragActive = false,
  dropOverlayLabel = "Drop item here to add context",
  onDragOver,
  onDragLeave,
  onDrop,
}: MarginChatPanelProps) {
  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!composerValue.trim() || composerDisabled || isGenerating) {
      return;
    }
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!composerValue.trim() || composerDisabled || isGenerating) {
        return;
      }
      onSubmit();
    }
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden"
    >
      {isDragActive && (
        <div className="pointer-events-none absolute inset-3 z-30 rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px] flex items-center justify-center">
          <div className="px-4 py-2.5 rounded-xl bg-surface border border-primary/30 shadow-sm flex items-center gap-2 text-primary font-label-md text-xs font-semibold">
            <span className="material-symbols-outlined text-base">add_circle</span>
            <span>{dropOverlayLabel}</span>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-y-auto custom-scroll ${scrollContainerClassName}`}
      >
        <div className={`${contentWidthClass} min-h-full flex flex-col min-w-0`}>
          <MarginChatStream
            messages={messages}
            isGenerating={isGenerating}
            onNavigateToCitation={onNavigateToCitation}
            errorMessage={errorMessage}
            errorTitle={errorTitle}
            onRetry={onRetry}
            onDismissError={onDismissError}
            emptyState={emptyState}
            defaultEmptyTitle={defaultEmptyTitle}
            defaultEmptyDescription={defaultEmptyDescription}
          />
        </div>
      </div>

      <footer className="p-3 md:p-4 border-t border-outline-variant/30 bg-surface-container-lowest shrink-0">
        <form onSubmit={handleFormSubmit} className={`${contentWidthClass} flex flex-col gap-1.5`}>
          {composerHeader}
          <div className="relative flex items-center">
            <textarea
              ref={composerRef}
              rows={2}
              value={composerValue}
              onChange={(e) => onComposerChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={composerPlaceholder}
              disabled={composerDisabled || isGenerating}
              className={`w-full resize-none rounded-2xl bg-surface border px-4 py-3 pr-12 font-body-default text-sm text-on-surface focus:outline-none transition-all ${
                isGenerating
                  ? "opacity-70 border-outline-variant/30 bg-surface-container-low cursor-wait"
                  : "border-outline-variant/40 placeholder:text-outline focus:border-primary focus:ring-1 focus:ring-primary"
              }`}
            />
            <ChatSendButton
              isSubmitting={isGenerating}
              disabled={!composerValue.trim() || composerDisabled}
              title={sendButtonTitle}
              className="absolute right-2.5 bottom-2.5"
            />
          </div>
          <div className="text-[11px] text-on-surface-variant px-2 font-body-dense text-center">
            <span>Enter to send · Shift+Enter for new line</span>
          </div>
        </form>
      </footer>
    </div>
  );
}
