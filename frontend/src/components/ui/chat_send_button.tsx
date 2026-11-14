import { LoadingSpinner } from "./loading_spinner";

export interface ChatSendButtonProps {
  isSubmitting?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Universal modern chatbot send button used across Margin's conversation surfaces:
 * Active Reader Assistant and SQL Studio.
 *
 * Adopts modern AI chatbot UX (circular action button with upward arrow and
 * integrated loading indicator).
 */
export function ChatSendButton({
  isSubmitting = false,
  disabled = false,
  title = "Send message",
  onClick,
  className = "",
}: ChatSendButtonProps) {
  return (
    <button
      type="submit"
      onClick={onClick}
      disabled={disabled || isSubmitting}
      title={title}
      aria-label={title}
      className={`w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shrink-0 transition-all shadow-xs hover:bg-primary-container hover:shadow-sm disabled:opacity-30 disabled:hover:bg-primary disabled:cursor-not-allowed active:scale-95 ${className}`}
    >
      {isSubmitting ? (
        <LoadingSpinner size="xs" variant="onPrimary" ariaLabel="Sending" />
      ) : (
        <span
          className="material-symbols-outlined text-[18px] leading-none select-none"
          style={{ fontVariationSettings: "'wght' 600" }}
        >
          arrow_upward
        </span>
      )}
    </button>
  );
}
