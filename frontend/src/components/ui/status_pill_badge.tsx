/**
 * Reusable status and format badges matching the Margin Lab design system.
 */

import {
  DOCUMENT_FORMAT,
  DOCUMENT_STATUS,
  type DocumentFormat,
  type DocumentStatus,
} from "../../types/api_contract_types";

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  switch (status) {
    case DOCUMENT_STATUS.READY:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-code-sm text-[11px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Indexed
        </span>
      );
    case DOCUMENT_STATUS.PROCESSING:
    case DOCUMENT_STATUS.PENDING:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-code-sm text-[11px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          Indexing
        </span>
      );
    case DOCUMENT_STATUS.FAILED:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container border border-error/20 font-code-sm text-[11px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-error" />
          Failed
        </span>
      );
  }
}

export function DocumentFormatBadge({ format }: { format: DocumentFormat }) {
  switch (format) {
    case DOCUMENT_FORMAT.PDF:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-error-container/50 text-on-error-container font-code-sm text-[11px] font-medium uppercase">
          PDF
        </span>
      );
    case DOCUMENT_FORMAT.DOCX:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary-fixed text-primary font-code-sm text-[11px] font-medium uppercase">
          DOCX
        </span>
      );
    case DOCUMENT_FORMAT.TXT:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-code-sm text-[11px] font-medium uppercase">
          TXT
        </span>
      );
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

