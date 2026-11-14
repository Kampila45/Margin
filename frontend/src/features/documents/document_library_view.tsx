/**
 * Document Library & Upload Center view matching `doc-lib-and-upload-center.html`.
 */

import { useState } from "react";
import { ConfirmActionDialog } from "../../components/ui/confirm_action_dialog";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";
import {
  DOCUMENT_FORMAT,
  type DocumentFormat,
  type DocumentResponse,
} from "../../types/api_contract_types";
import { DocumentCardItem } from "./document_card_item";
import { useDeleteDocumentMutation, useDocumentsListQuery } from "./use_document_queries";

export function DocumentLibraryView() {
  const [selectedFormat, setSelectedFormat] = useState<DocumentFormat | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [documentPendingDelete, setDocumentPendingDelete] = useState<DocumentResponse | null>(
    null,
  );

  const setUploadModalOpen = useReaderSelectionStore((s) => s.setUploadModalOpen);
  const documentsQuery = useDocumentsListQuery({
    format: selectedFormat,
    search: searchQuery.trim() || null,
  });
  const deleteMutation = useDeleteDocumentMutation();

  const documents = documentsQuery.data?.items ?? [];

  const handleConfirmDelete = () => {
    if (!documentPendingDelete) {
      return;
    }
    const targetId = documentPendingDelete.id;
    setDocumentPendingDelete(null);
    deleteMutation.mutate(targetId);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8 bg-background">
      {/* Header & Primary Upload CTA */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-outline-variant/25 pb-6">
        <div>
          <span className="font-code-sm text-code-sm uppercase tracking-wider text-primary font-semibold">
            Document Repository
          </span>
          <h1 className="font-headline-lg text-headline-lg font-semibold text-on-surface mt-1">
            Document Library &amp; Upload Center
          </h1>
          <p className="font-body-default text-body-default text-on-surface-variant mt-1">
            Manage indexed PDF, DOCX, and TXT sources for interactive reading and grounded citations.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setUploadModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98] shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">upload_file</span>
          <span>Upload Document</span>
        </button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 bg-surface-container-low p-1 rounded-lg border border-outline-variant/30">
          <button
            type="button"
            onClick={() => setSelectedFormat(null)}
            className={`px-3 py-1.5 rounded-md font-label-md text-label-md transition-colors ${
              selectedFormat === null
                ? "bg-surface-container-lowest text-primary shadow-xs"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            All Formats
          </button>
          <button
            type="button"
            onClick={() => setSelectedFormat(DOCUMENT_FORMAT.PDF)}
            className={`px-3 py-1.5 rounded-md font-label-md text-label-md transition-colors ${
              selectedFormat === DOCUMENT_FORMAT.PDF
                ? "bg-surface-container-lowest text-primary shadow-xs"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            PDF
          </button>
          <button
            type="button"
            onClick={() => setSelectedFormat(DOCUMENT_FORMAT.DOCX)}
            className={`px-3 py-1.5 rounded-md font-label-md text-label-md transition-colors ${
              selectedFormat === DOCUMENT_FORMAT.DOCX
                ? "bg-surface-container-lowest text-primary shadow-xs"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            DOCX
          </button>
          <button
            type="button"
            onClick={() => setSelectedFormat(DOCUMENT_FORMAT.TXT)}
            className={`px-3 py-1.5 rounded-md font-label-md text-label-md transition-colors ${
              selectedFormat === DOCUMENT_FORMAT.TXT
                ? "bg-surface-container-lowest text-primary shadow-xs"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            TXT
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-base">
            search
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by filename…"
            aria-label="Filter documents by filename"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant/40 font-body-dense text-body-dense text-on-surface focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Document Grid / States */}
      {documentsQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((skeleton) => (
            <div
              key={skeleton}
              className="h-44 rounded-xl bg-surface-container animate-pulse border border-outline-variant/20"
            />
          ))}
        </div>
      ) : documentsQuery.isError ? (
        <div className="p-6 rounded-xl bg-surface-container-lowest border border-outline-variant/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-error-container/60 text-on-error-container flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined">cloud_off</span>
            </div>
            <div className="space-y-1">
              <p className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                We couldn&apos;t load your library right now
              </p>
              <p className="font-body-default text-body-default text-on-surface-variant">
                Please check your connection or try refreshing in a moment.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void documentsQuery.refetch()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            <span>Try Again</span>
          </button>
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-12 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary-fixed/50 text-primary flex items-center justify-center">
            <span className="material-symbols-outlined">menu_book</span>
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              Your Margin library is empty
            </h2>
            <p className="font-body-default text-body-default text-on-surface-variant">
              Upload a PDF research paper, DOCX contract, or TXT study notes to start highlighting passages and asking grounded questions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98] shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Upload Document</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {documents.map((doc) => (
            <DocumentCardItem
              key={doc.id}
              document={doc}
              onRequestDelete={setDocumentPendingDelete}
            />
          ))}
        </div>
      )}

      {deleteMutation.isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-error/30 bg-error-container/50 px-4 py-3 text-sm text-on-error-container"
        >
          <span>Could not delete the document. Your library has been restored.</span>
          <button
            type="button"
            onClick={() => deleteMutation.reset()}
            className="font-label-md text-xs font-semibold underline hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmActionDialog
        isOpen={Boolean(documentPendingDelete)}
        title="Delete Document?"
        description={
          documentPendingDelete
            ? `Deleting "${documentPendingDelete.original_filename}" permanently removes this document and its associated conversations from your library.`
            : ""
        }
        confirmLabel="Delete Document"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDocumentPendingDelete(null)}
      />
    </div>
  );
}

