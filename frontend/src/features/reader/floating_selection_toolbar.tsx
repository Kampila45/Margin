/**
 * Floating contextual toolbar (`Ask AI`, `Explain`, `Summarise`, `Simplify`) displayed
 * directly above highlighted text inside the document reader, matching `three-panel-document-reader.html`.
 */

interface FloatingSelectionToolbarProps {
  selectedText: string;
  position: { top: number; left: number } | null;
  onAction: (action: "ask" | "explain" | "summarise" | "simplify") => void;
  onDismiss: () => void;
}

export function FloatingSelectionToolbar({
  selectedText,
  position,
  onAction,
  onDismiss,
}: FloatingSelectionToolbarProps) {
  if (!selectedText.trim() || !position) {
    return null;
  }

  return (
    <div
      style={{
        top: `${Math.max(12, position.top)}px`,
        left: `${position.left}px`,
      }}
      role="toolbar"
      aria-label="Highlighted passage AI actions"
      className="fixed -translate-x-1/2 z-40 flex items-center gap-1 bg-[#18181B] text-white px-2.5 py-1.5 rounded-lg shadow-xl border border-white/10 whitespace-nowrap"
    >
      <button
        type="button"
        onClick={() => onAction("ask")}
        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/15 text-xs font-medium text-primary-fixed transition-colors"
      >
        <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
        <span>Ask AI</span>
      </button>

      <div className="w-px h-3.5 bg-white/20" />

      <button
        type="button"
        onClick={() => onAction("explain")}
        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/15 text-xs text-white/90 transition-colors"
      >
        <span className="material-symbols-outlined text-[15px]">lightbulb</span>
        <span>Explain</span>
      </button>

      <button
        type="button"
        onClick={() => onAction("summarise")}
        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/15 text-xs text-white/90 transition-colors"
      >
        <span className="material-symbols-outlined text-[15px]">article</span>
        <span>Summarise</span>
      </button>

      <button
        type="button"
        onClick={() => onAction("simplify")}
        className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/15 text-xs text-white/90 transition-colors"
      >
        <span className="material-symbols-outlined text-[15px]">psychology</span>
        <span>Simplify</span>
      </button>

      <div className="w-px h-3.5 bg-white/20" />

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Clear text selection"
        className="p-1 rounded hover:bg-white/15 text-white/70 hover:text-white"
      >
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  );
}

