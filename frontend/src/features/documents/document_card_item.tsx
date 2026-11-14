/**
 * Document card item displaying format badge, indexing status, page/chunk metrics, and reader/delete actions.
 */

import { Link } from "react-router-dom";
import {
  DocumentFormatBadge,
  DocumentStatusBadge,
  formatFileSize,
} from "../../components/ui/status_pill_badge";
import { DOCUMENT_STATUS, type DocumentResponse } from "../../types/api_contract_types";

interface DocumentCardItemProps {
  document: DocumentResponse;
  onRequestDelete: (document: DocumentResponse) => void;
}

export function DocumentCardItem({ document, onRequestDelete }: DocumentCardItemProps) {
  const isReady = document.status === DOCUMENT_STATUS.READY;
  const isFailed = document.status === DOCUMENT_STATUS.FAILED;
  const formattedDate = new Date(document.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Never expose internal model/HTTP/provider jargon from historical failed records.
  const friendlyDocumentError =
    document.error_message &&
    !/gemini|http\s+\d{3}|vector|embedding|exception|traceback/i.test(document.error_message)
      ? document.error_message
      : "We couldn't finish preparing this document. Please remove it and try uploading again.";

  return (
    <div className="group rounded-xl bg-surface-container-lowest border border-outline-variant/35 hover:border-primary/40 p-5 shadow-xs transition-all flex flex-col justify-between gap-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DocumentFormatBadge format={document.doc_format} />
            <DocumentStatusBadge status={document.status} />
          </div>
          <button
            type="button"
            onClick={() => onRequestDelete(document)}
            aria-label={`Delete ${document.original_filename}`}
            className="p-1.5 rounded-lg text-outline hover:text-error hover:bg-error-container/30 transition-colors"
          >
            <span className="material-symbols-outlined text-base">delete</span>
          </button>
        </div>

        <div>
          <h3
            className="font-headline-sm text-headline-sm font-semibold text-on-surface truncate"
            title={document.original_filename}
          >
            {document.original_filename}
          </h3>
          <p className="font-code-sm text-code-sm text-on-surface-variant mt-1">
            {formatFileSize(document.file_size_bytes)} •{" "}
            {document.page_count !== null
              ? `${document.page_count} ${document.page_count === 1 ? "page" : "pages"}`
              : isFailed
                ? "Processing interrupted"
                : "Preparing pages…"}
          </p>
        </div>

        {isFailed && (
          <p className="p-2.5 rounded-lg bg-error-container/50 text-on-error-container font-body-dense text-xs">
            {friendlyDocumentError}
          </p>
        )}
      </div>

      <div className="pt-3 border-t border-outline-variant/20 flex items-center justify-between">
        <span className="font-code-sm text-code-sm text-outline">{formattedDate}</span>
        {isReady ? (
          <Link
            to={`/reader/${document.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-fixed/50 text-primary font-label-md text-label-md hover:bg-primary hover:text-on-primary transition-colors"
          >
            <span>Open in Reader</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        ) : (
          <span className="font-label-sm text-label-sm text-on-surface-variant">
            {document.status === DOCUMENT_STATUS.FAILED ? "Unavailable" : "Processing…"}
          </span>
        )}
      </div>
    </div>
  );
}

