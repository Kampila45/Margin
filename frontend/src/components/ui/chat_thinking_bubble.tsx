/**
 * Modern conversational typing indicator with animated bouncing dots and Margin brand mark.
 * Used consistently across Document Intelligence chat, Synthesis chat, and SQL Assistant chat.
 */

import { MarginBrandLogo } from "./margin_brand_logo";

interface ChatThinkingBubbleProps {
  className?: string;
  ariaLabel?: string;
}

export function ChatThinkingBubble({
  className = "",
  ariaLabel = "Thinking…",
}: ChatThinkingBubbleProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={`flex items-start gap-2.5 animate-in fade-in duration-150 ${className}`}
    >
      <MarginBrandLogo variant="icon" className="w-7 h-7 shrink-0 mt-0.5" />
      <div className="rounded-2xl rounded-tl-xs bg-surface-container-low border border-outline-variant/30 px-3.5 py-2.5 flex items-center shadow-2xs">
        <div className="flex items-center gap-1.5 py-0.5 shrink-0">
          <span
            className="w-2 h-2 rounded-full bg-primary animate-bounce"
            style={{ animationDelay: "-0.32s" }}
          />
          <span
            className="w-2 h-2 rounded-full bg-primary animate-bounce"
            style={{ animationDelay: "-0.16s" }}
          />
          <span
            className="w-2 h-2 rounded-full bg-primary animate-bounce"
            style={{ animationDelay: "0s" }}
          />
        </div>
      </div>
    </div>
  );
}
