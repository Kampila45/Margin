/**
 * Reader viewport header bar with page stepper and typography zoom controls.
 */

interface ReaderViewportToolbarProps {
  currentPage: number;
  totalPages: number;
  zoomPercentage: number;
  isOutlineOpen?: boolean;
  onExpandOutline?: () => void;
  onPageChange: (nextPage: number) => void;
  onZoomChange: (nextZoom: number) => void;
}

export function ReaderViewportToolbar({
  currentPage,
  totalPages,
  zoomPercentage,
  isOutlineOpen = true,
  onExpandOutline,
  onPageChange,
  onZoomChange,
}: ReaderViewportToolbarProps) {
  return (
    <div className="reader-viewport-toolbar h-12 px-4 border-b border-outline-variant/30 bg-surface/90 backdrop-blur-xs flex items-center justify-between gap-2 shrink-0 z-10">
      {/* Outline Expand Toggle + Page Stepper */}
      <div className="flex items-center gap-1.5 text-xs text-on-surface shrink-0">
        {!isOutlineOpen && onExpandOutline && (
          <>
            <button
              type="button"
              onClick={onExpandOutline}
              title="Expand outline panel"
              aria-label="Expand outline panel"
              className="w-7 h-7 flex items-center justify-center rounded-md bg-surface-container-low border border-outline-variant/30 hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">left_panel_open</span>
            </button>
            <div className="h-4 w-px bg-outline-variant/30 mx-1" />
          </>
        )}

        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container text-on-surface-variant hover:text-on-surface disabled:opacity-40 transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">chevron_left</span>
        </button>

        <div className="h-7 flex items-center gap-1 px-2.5 rounded-md bg-surface-container-low border border-outline-variant/30 font-code-sm text-[12px]">
          <span className="font-semibold text-on-surface">{currentPage}</span>
          <span className="text-outline">/</span>
          <span className="text-on-surface-variant">{Math.max(1, totalPages)}</span>
        </div>

        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container text-on-surface-variant hover:text-on-surface disabled:opacity-40 transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
        </button>
      </div>

      {/* Prominent Selection Hint Centered Above the Document */}
      <div
        title="Highlight any text on the page to ask Margin AI"
        className="reader-selection-hint hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-fixed/45 border border-primary/25 text-xs font-label-sm font-medium text-primary shadow-2xs min-w-0 whitespace-nowrap"
      >
        <span className="material-symbols-outlined text-[15px] shrink-0">ink_highlighter</span>
        <span className="reader-selection-hint-full truncate">
          Highlight any text on the page to ask Margin AI
        </span>
        <span className="reader-selection-hint-short truncate hidden">
          Highlight text to ask AI
        </span>
      </div>

      {/* Zoom Controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => onZoomChange(zoomPercentage - 10)}
          aria-label="Zoom out"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">zoom_out</span>
        </button>

        <span className="font-code-sm text-[12px] text-on-surface px-1.5">
          {zoomPercentage}%
        </span>

        <button
          type="button"
          onClick={() => onZoomChange(zoomPercentage + 10)}
          aria-label="Zoom in"
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">zoom_in</span>
        </button>
      </div>
    </div>
  );
}

