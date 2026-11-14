/**
 * Three-Panel Document Reader View matching `three-panel-document-reader.html`:
 * Left Panel: Document outline, page jumper, and library switcher
 * Center Panel: Interactive Document Stage with floating selection toolbar
 * Right Panel: Grounded Margin AI Assistant with verifiable citations
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { HttpErrorStateView } from "../../components/shared/http_error_state_view";
import { LoadingSpinner } from "../../components/ui/loading_spinner";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";
import type { CitationResponse } from "../../types/api_contract_types";
import { ReaderAssistantSidebar } from "../chat/reader_assistant_sidebar";
import {
  useDocumentDetailQuery,
  useDocumentsListQuery,
} from "../documents/use_document_queries";
import { PdfDocumentStage } from "./pdf_document_stage";
import { ReaderViewportToolbar } from "./reader_viewport_toolbar";

export function ThreePanelReaderView() {
  const { documentId } = useParams<{ documentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const currentPageNumber = useReaderSelectionStore((s) => s.currentPageNumber);
  const zoomPercentage = useReaderSelectionStore((s) => s.zoomPercentage);
  const setActiveDocument = useReaderSelectionStore((s) => s.setActiveDocument);
  const setCurrentPageNumber = useReaderSelectionStore((s) => s.setCurrentPageNumber);
  const setZoomPercentage = useReaderSelectionStore((s) => s.setZoomPercentage);
  const highlightCitation = useReaderSelectionStore((s) => s.highlightCitation);

  const [isOutlineOpen, setIsOutlineOpen] = useState(true);

  const initialPageParam = Number(searchParams.get("page") ?? "1");
  const initialConversationParam = searchParams.get("conversation");

  useEffect(() => {
    if (documentId) {
      setActiveDocument(
        documentId,
        Number.isFinite(initialPageParam) && initialPageParam >= 1 ? initialPageParam : 1,
      );
    }
  }, [documentId, initialPageParam, setActiveDocument]);

  const documentQuery = useDocumentDetailQuery(documentId);
  const libraryListQuery = useDocumentsListQuery({ limit: 15 });

  useEffect(() => {
    if (documentQuery.data?.original_filename) {
      document.title = `Margin — ${documentQuery.data.original_filename} (Page ${currentPageNumber})`;
    }
  }, [documentQuery.data?.original_filename, currentPageNumber]);

  if (documentQuery.isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-3 p-6 bg-background">
        <LoadingSpinner size="md" ariaLabel="Opening document" />
        <p className="font-body-default text-xs text-on-surface-variant">
          Opening document in Margin Reader…
        </p>
      </div>
    );
  }

  if (documentQuery.isError || !documentQuery.data) {
    return (
      <HttpErrorStateView
        statusCode={404}
        title="Document Not Found"
        message="This document does not exist or belongs to another session."
      />
    );
  }

  const activeDoc = documentQuery.data;
  const totalPages = Math.max(1, activeDoc.page_count ?? 1);
  const pageNumbers = Array.from({ length: totalPages }, (_, idx) => idx + 1);
  const recentDocs = libraryListQuery.data?.items ?? [];

  const handleCitationNavigation = (citation: CitationResponse) => {
    const targetPage = citation.page_number ?? 1;
    highlightCitation(citation);
    if (citation.document_id !== activeDoc.id) {
      navigate(`/reader/${citation.document_id}?page=${targetPage}`);
    }
  };

  return (
    <div className="flex-1 flex h-screen overflow-hidden bg-background">
      {/* Left Panel: Document Outline & Page Navigator */}
      {isOutlineOpen && (
        <aside className="w-64 bg-surface-container-low border-r border-outline-variant/30 flex flex-col justify-between shrink-0 p-3.5">
          <div className="space-y-5 overflow-y-auto">
            <div className="flex items-center justify-between pb-2.5 border-b border-outline-variant/20">
              <Link
                to="/library"
                className="flex items-center gap-1.5 font-label-md text-label-md text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-base">arrow_back</span>
                <span>Back to Library</span>
              </Link>
              <button
                type="button"
                onClick={() => setIsOutlineOpen(false)}
                aria-label="Collapse outline panel"
                className="p-1 rounded hover:bg-surface-container text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-base">left_panel_close</span>
              </button>
            </div>

            {/* Page Index */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-2">
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-outline">
                  Pages ({totalPages})
                </span>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
                {pageNumbers.map((pageNum) => {
                  const isCurrent = pageNum === currentPageNumber;
                  return (
                    <button
                      key={pageNum}
                      type="button"
                      onClick={() => setCurrentPageNumber(pageNum)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-body-dense text-body-dense transition-colors ${
                        isCurrent
                          ? "bg-surface text-primary font-medium border border-outline-variant/25 shadow-2xs"
                          : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                      }`}
                    >
                      <span>Page {pageNum}</span>
                      {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Document Switcher */}
            {recentDocs.length > 1 && (
              <div className="space-y-1.5 pt-3 border-t border-outline-variant/20">
                <span className="block font-label-sm text-label-sm uppercase tracking-wider text-outline px-2">
                  Session Documents
                </span>
                <div className="space-y-1">
                  {recentDocs.slice(0, 8).map((doc) => (
                    <Link
                      key={doc.id}
                      to={`/reader/${doc.id}`}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs truncate transition-colors ${
                        doc.id === activeDoc.id
                          ? "bg-surface text-on-surface font-medium border border-outline-variant/20"
                          : "text-on-surface-variant hover:bg-surface-container"
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm text-primary shrink-0">
                        description
                      </span>
                      <span className="truncate">{doc.original_filename}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Center Panel: Document Reader Stage */}
      <section className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <ReaderViewportToolbar
          currentPage={currentPageNumber}
          totalPages={totalPages}
          zoomPercentage={zoomPercentage}
          isOutlineOpen={isOutlineOpen}
          onExpandOutline={() => setIsOutlineOpen(true)}
          onPageChange={setCurrentPageNumber}
          onZoomChange={setZoomPercentage}
        />

        <PdfDocumentStage
          document={activeDoc}
          pageNumber={currentPageNumber}
          zoomPercentage={zoomPercentage}
        />
      </section>

      {/* Right Panel: Contextual Margin AI Assistant */}
      <ReaderAssistantSidebar
        document={activeDoc}
        initialConversationId={initialConversationParam}
        onNavigateToCitation={handleCitationNavigation}
      />
    </div>
  );
}

