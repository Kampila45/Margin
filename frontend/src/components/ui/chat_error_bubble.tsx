/**
 * Reusable conversational error bubble that replaces the assistant's thinking bubble on failure.
 * Displayed consistently across all chat interfaces:
 * - SQL Assistant View
 * - Multi-Document Synthesis Chat
 * - Active Reader Assistant Sidebar
 */

import { MarginBrandLogo } from "./margin_brand_logo";

export interface ChatErrorBubbleProps {
  error: string;
  title?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function ChatErrorBubble({
  error,
  title = "AI Generation Failed",
  onRetry,
  onDismiss,
  className = "",
}: ChatErrorBubbleProps) {
  return (
    <div
      role="alert"
      aria-label={title}
      className={`flex items-start gap-2.5 animate-in fade-in duration-150 ${className}`}
    >
      <MarginBrandLogo variant="icon" className="w-7 h-7 shrink-0 mt-0.5" />

      <div className="rounded-2xl rounded-tl-xs bg-surface-container-low border border-outline-variant/30 px-3.5 py-2.5 shadow-2xs max-w-lg text-left text-xs space-y-1.5">
        <p className="font-body-dense text-on-surface leading-relaxed">
          {error}
        </p>

        {(onRetry || onDismiss) && (
          <div className="flex items-center gap-3 pt-0.5">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 font-label-md font-semibold text-primary hover:text-primary-container transition-colors cursor-pointer"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                  refresh
                </span>
                <span>Retry</span>
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss error"
                className="inline-flex items-center gap-1 font-label-md text-outline hover:text-on-surface transition-colors cursor-pointer"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                  close
                </span>
                <span>Dismiss</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
