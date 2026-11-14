/**
 * Interactive verified citation card (`[n]`) that navigates the reader to the exact document and page when clicked.
 */

import type { CitationResponse } from "../../types/api_contract_types";

interface CitationSourceCardProps {
  citation: CitationResponse;
  onNavigateToCitation: (citation: CitationResponse) => void;
}

export function CitationSourceCard({
  citation,
  onNavigateToCitation,
}: CitationSourceCardProps) {
  return (
    <button
      type="button"
      onClick={() => onNavigateToCitation(citation)}
      className="w-full text-left group p-3 rounded-lg bg-surface-container-low border border-outline-variant/40 hover:border-primary-container hover:bg-surface-container transition-all flex flex-col justify-between gap-2"
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 font-label-md text-label-md font-semibold text-primary">
            <span className="material-symbols-outlined text-sm">description</span>
            <span>[{citation.citation_index}]</span>
            <span className="truncate max-w-[160px]">{citation.document_filename}</span>
          </span>
          <span className="font-code-sm text-code-sm text-secondary px-1.5 py-0.5 rounded bg-surface-container shrink-0">
            {citation.page_number !== null ? `Page ${citation.page_number}` : `Section ${citation.chunk_index + 1}`}
          </span>
        </div>

        <blockquote className="text-body-dense text-on-surface-variant italic pl-2.5 border-l-2 border-primary-container/60 line-clamp-3">
          &ldquo;{citation.excerpt}&rdquo;
        </blockquote>
      </div>

      <div className="pt-1.5 border-t border-outline-variant/20 flex items-center justify-between text-on-surface-variant">
        <span className="font-code-sm text-[11px] text-outline">Verified passage</span>
        <span className="font-label-sm text-[11px] text-primary flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
          <span>Jump to page</span>
          <span className="material-symbols-outlined text-xs">arrow_forward</span>
        </span>
      </div>
    </button>
  );
}

