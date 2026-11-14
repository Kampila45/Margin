/**
 * Workspace Home Dashboard providing a clean, tabbed segmented switcher between
 * Document Intelligence and SQL Data Assistant, unified under Margin's brand styling.
 */

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ConfirmActionDialog } from "../../components/ui/confirm_action_dialog";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";
import type { DatabaseConnectionResponse, DocumentResponse } from "../../types/api_contract_types";
import { useConversationsListQuery } from "../chat/use_conversation_queries";
import { DocumentCardItem } from "../documents/document_card_item";
import { GettingStartedChecklistCard } from "../onboarding/getting_started_checklist_card";
import {
  useDeleteDocumentMutation,
  useDocumentsListQuery,
} from "../documents/use_document_queries";
import {
  useDeleteDatabaseConnectionMutation,
  useSqlWorkspaceQuery,
} from "../sql/use_sql_queries";

export function WorkspaceDashboardView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") === "sql" ? "sql" : "documents";

  const setUploadModalOpen = useReaderSelectionStore((s) => s.setUploadModalOpen);
  const setConnectDbModalOpen = useReaderSelectionStore((s) => s.setConnectDbModalOpen);

  const documentsQuery = useDocumentsListQuery({ limit: 50 });
  const conversationsQuery = useConversationsListQuery();
  const sqlWorkspaceQuery = useSqlWorkspaceQuery();
  const deleteDocMutation = useDeleteDocumentMutation();
  const [docToDelete, setDocToDelete] = useState<DocumentResponse | null>(null);
  const deleteConnMutation = useDeleteDatabaseConnectionMutation();
  const [connToDelete, setConnToDelete] = useState<DatabaseConnectionResponse | null>(null);

  const isDocsLoading = documentsQuery.isPending;
  const isConversationsLoading = conversationsQuery.isPending;
  const isSqlLoading = sqlWorkspaceQuery.isPending;
  const isChecklistLoading = isDocsLoading || isConversationsLoading || isSqlLoading;

  const documents = documentsQuery.data?.items ?? [];
  const conversations = conversationsQuery.data?.items ?? [];
  const totalPages = documents.reduce((acc, doc) => acc + (doc.page_count ?? 1), 0);

  const connections = sqlWorkspaceQuery.data?.connections ?? [];
  const activeConn =
    connections.find((c) => c.is_active) ?? connections[0] ?? null;
  const turns = sqlWorkspaceQuery.data?.turns ?? [];
  const totalTables = connections.reduce((acc, c) => acc + c.table_count, 0);

  const handleTabChange = (tab: "documents" | "sql") => {
    if (tab === "documents") {
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next);
    } else {
      const next = new URLSearchParams(searchParams);
      next.set("tab", "sql");
      setSearchParams(next);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-6 bg-background custom-scroll">
      {/* Vercel / GitHub Style Underline Tab Header (Option 4) */}
      <header className="space-y-4 border-b border-outline-variant/25">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <h1 className="font-headline-lg text-2xl font-bold text-on-surface tracking-tight">
              Overview
            </h1>
            {(currentTab === "documents" && isDocsLoading) ||
            (currentTab === "sql" && isSqlLoading) ? (
              <span
                className="inline-block w-20 h-5 rounded-full bg-surface-container-high animate-pulse"
                aria-label="Loading workspace summary"
              />
            ) : (
              <span className="font-code-sm text-[11px] px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-medium">
                {currentTab === "documents"
                  ? `${documentsQuery.data?.total ?? 0} indexed`
                  : `${connections.length} database${connections.length === 1 ? "" : "s"}`}
              </span>
            )}
          </div>

          {/* Primary View Action Controls */}
          <div data-tour="action-button">
            {currentTab === "documents" ? (
              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98] shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                <span>Upload Document</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-tour="sql-add-connection-btn"
                  onClick={() => setConnectDbModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/40 hover:bg-surface-container text-on-surface font-label-md text-xs font-semibold transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>Add Connection</span>
                </button>
                {connections.length > 0 ? (
                  <Link
                    to="/sql"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98] shrink-0"
                  >
                    <span className="material-symbols-outlined text-[18px]">terminal</span>
                    <span>Open Studio</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    data-tour="sql-add-connection-btn"
                    onClick={() => setConnectDbModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary font-label-md text-xs font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98] shrink-0"
                  >
                    <span className="material-symbols-outlined text-[18px]">database</span>
                    <span>Connect Database</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Clean Underline Navigation Tabs */}
        <nav
          data-tour="mode-switcher"
          className="flex items-center gap-6 text-xs font-label-md -mb-[1px]"
        >
          <button
            type="button"
            onClick={() => handleTabChange("documents")}
            className={`flex items-center gap-2 pb-3 transition-colors border-b-2 ${
              currentTab === "documents"
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline-variant/50"
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">menu_book</span>
            <span>Documents</span>
            {!isDocsLoading && (
              <span
                className={`font-code-sm text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                  currentTab === "documents"
                    ? "bg-primary/10 text-primary"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {documentsQuery.data?.total ?? 0}
              </span>
            )}
          </button>

          <button
            type="button"
            data-tour="sql-tab-btn"
            onClick={() => handleTabChange("sql")}
            className={`flex items-center gap-2 pb-3 transition-colors border-b-2 ${
              currentTab === "sql"
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline-variant/50"
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">database</span>
            <span>SQL Studio</span>
            {connections.length > 0 && (
              <span
                className={`font-code-sm text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                  currentTab === "sql"
                    ? "bg-primary/10 text-primary"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {connections.length}
              </span>
            )}
          </button>
        </nav>
      </header>

      {/* Getting Started Checklist (wait for initial workspace data so it doesn't flash 0/3) */}
      {!isChecklistLoading && (
        <GettingStartedChecklistCard
          documentCount={documentsQuery.data?.total ?? 0}
          conversationCount={conversations.length}
          databaseCount={connections.length}
          firstReadyDocumentId={documents[0]?.id ?? null}
        />
      )}

      {/* ========================================================= */}
      {/* TAB 1: DOCUMENT INTELLIGENCE                              */}
      {/* ========================================================= */}
      {currentTab === "documents" ? (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Document Metrics (3 Clean Domain Metrics) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-4">
              <span className="font-label-sm text-[10px] uppercase tracking-wider text-outline block">
                Total Documents
              </span>
              {isDocsLoading ? (
                <div
                  className="h-7 w-12 mt-1.5 mb-0.5 rounded bg-surface-container animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <p className="font-headline-lg text-2xl font-bold text-on-surface mt-1">
                  {documentsQuery.data?.total ?? 0}
                </p>
              )}
              <span className="font-code-sm text-[11px] text-on-surface-variant">
                Uploaded &amp; indexed
              </span>
            </div>

            <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-4">
              <span className="font-label-sm text-[10px] uppercase tracking-wider text-outline block">
                Pages in Library
              </span>
              {isDocsLoading ? (
                <div
                  className="h-7 w-12 mt-1.5 mb-0.5 rounded bg-surface-container animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <p className="font-headline-lg text-2xl font-bold text-primary mt-1">
                  {totalPages}
                </p>
              )}
              <span className="font-code-sm text-[11px] text-on-surface-variant">
                Annotated &amp; cited
              </span>
            </div>

            <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-4">
              <span className="font-label-sm text-[10px] uppercase tracking-wider text-outline block">
                Document Threads
              </span>
              {isConversationsLoading ? (
                <div
                  className="h-7 w-12 mt-1.5 mb-0.5 rounded bg-surface-container animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <p className="font-headline-lg text-2xl font-bold text-on-surface mt-1">
                  {conversations.length}
                </p>
              )}
              <span className="font-code-sm text-[11px] text-on-surface-variant">
                Active research threads
              </span>
            </div>
          </div>

          {/* Recent Documents */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="font-headline-sm text-sm font-semibold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-base">folder_open</span>
                <span>Recent Documents</span>
              </h3>
              <Link
                to="/library"
                className="font-label-sm text-xs text-primary hover:underline flex items-center gap-0.5 font-medium"
              >
                <span>View Full Library</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </Link>
            </div>

            {isDocsLoading ? (
              <div
                aria-busy="true"
                aria-label="Loading recent documents"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
              >
                {[1, 2, 3, 4].map((skeleton) => (
                  <div
                    key={skeleton}
                    className="h-36 rounded-xl bg-surface-container animate-pulse border border-outline-variant/20"
                  />
                ))}
              </div>
            ) : documentsQuery.isError ? (
              <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-8 text-center space-y-3">
                <span className="material-symbols-outlined text-3xl text-outline">cloud_off</span>
                <p className="font-body-dense text-xs text-on-surface-variant max-w-sm mx-auto">
                  Could not load your documents right now.
                </p>
                <button
                  type="button"
                  onClick={() => void documentsQuery.refetch()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant/40 hover:bg-surface-container text-on-surface font-label-md text-xs font-semibold transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">refresh</span>
                  <span>Retry</span>
                </button>
              </div>
            ) : documents.length === 0 ? (
              <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-8 text-center space-y-3">
                <span className="material-symbols-outlined text-3xl text-outline">upload_file</span>
                <p className="font-body-dense text-xs text-on-surface-variant max-w-sm mx-auto">
                  No documents uploaded yet. Upload a PDF, DOCX, or TXT file to start reading with grounded AI.
                </p>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {documents.slice(0, 4).map((doc) => (
                  <DocumentCardItem
                    key={doc.id}
                    document={doc}
                    onRequestDelete={setDocToDelete}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Recent Document Threads */}
          {isConversationsLoading ? (
            <div
              aria-busy="true"
              aria-label="Loading recent document threads"
              className="space-y-3 pt-4 border-t border-outline-variant/20"
            >
              <div className="h-4 w-44 rounded bg-surface-container animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {[1, 2, 3].map((skeleton) => (
                  <div
                    key={skeleton}
                    className="h-16 rounded-xl bg-surface-container animate-pulse border border-outline-variant/20"
                  />
                ))}
              </div>
            </div>
          ) : (
            conversations.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-outline-variant/20">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline-sm text-sm font-semibold text-on-surface flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-primary text-base">auto_awesome</span>
                    <span>Recent Document Threads</span>
                  </h3>
                  <Link
                    to={documents[0] ? `/reader/${documents[0].id}` : "/library"}
                    className="font-label-sm text-xs text-primary hover:underline flex items-center gap-0.5 font-medium"
                  >
                    <span>Active Reader</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {conversations.slice(0, 3).map((conv) => (
                    <Link
                      key={conv.id}
                      to={`/reader/${conv.document_id}?conversation=${conv.id}`}
                      className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/30 hover:border-primary/40 flex items-center justify-between gap-3 transition-colors group shadow-2xs"
                    >
                      <div className="min-w-0">
                        <p className="font-label-md text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                          {conv.title}
                        </p>
                        <p className="font-code-sm text-[10px] text-on-surface-variant mt-0.5">
                          {conv.document_ids.length} document(s) in scope
                        </p>
                      </div>
                      <span className="material-symbols-outlined text-outline group-hover:text-primary text-sm">
                        chevron_right
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      ) : (
        /* ========================================================= */
        /* TAB 2: SQL DATA ASSISTANT                                 */
        /* ========================================================= */
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* SQL Metrics (3 Clean Domain Metrics) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-4">
              <span className="font-label-sm text-[10px] uppercase tracking-wider text-outline block">
                Connected Databases
              </span>
              {isSqlLoading ? (
                <div
                  className="h-7 w-12 mt-1.5 mb-0.5 rounded bg-surface-container animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <p className="font-headline-lg text-2xl font-bold text-on-surface mt-1">
                  {connections.length}
                </p>
              )}
              <span className="font-code-sm text-[11px] text-on-surface-variant">
                PostgreSQL replicas
              </span>
            </div>

            <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-4">
              <span className="font-label-sm text-[10px] uppercase tracking-wider text-outline block">
                Discovered Tables
              </span>
              {isSqlLoading ? (
                <div
                  className="h-7 w-12 mt-1.5 mb-0.5 rounded bg-surface-container animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <p className="font-headline-lg text-2xl font-bold text-primary mt-1">
                  {totalTables}
                </p>
              )}
              <span className="font-code-sm text-[11px] text-on-surface-variant">
                Schema &amp; foreign keys
              </span>
            </div>

            <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-4">
              <span className="font-label-sm text-[10px] uppercase tracking-wider text-outline block">
                Recent Queries
              </span>
              {isSqlLoading ? (
                <div
                  className="h-7 w-12 mt-1.5 mb-0.5 rounded bg-surface-container animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <p className="font-headline-lg text-2xl font-bold text-on-surface mt-1">
                  {turns.length}
                </p>
              )}
              <span className="font-code-sm text-[11px] text-on-surface-variant">
                Query history turns
              </span>
            </div>
          </div>

          {/* SQL Activity & Connections */}
          <div className="space-y-4 pt-2">
            {isSqlLoading ? (
              <div
                aria-busy="true"
                aria-label="Loading SQL Studio summary"
                className="space-y-3"
              >
                <div className="h-20 rounded-xl bg-surface-container animate-pulse border border-outline-variant/20" />
                <div className="h-16 rounded-xl bg-surface-container animate-pulse border border-outline-variant/20" />
                <div className="h-16 rounded-xl bg-surface-container animate-pulse border border-outline-variant/20" />
              </div>
            ) : sqlWorkspaceQuery.isError ? (
              <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/30 p-10 text-center space-y-3">
                <span className="material-symbols-outlined text-3xl text-outline">cloud_off</span>
                <p className="font-body-dense text-xs text-on-surface-variant max-w-sm mx-auto">
                  Could not load SQL Studio connections right now.
                </p>
                <button
                  type="button"
                  onClick={() => void sqlWorkspaceQuery.refetch()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant/40 hover:bg-surface-container text-on-surface font-label-md text-xs font-semibold transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">refresh</span>
                  <span>Retry</span>
                </button>
              </div>
            ) : !activeConn ? (
              <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/30 p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-2xs">
                  <span className="material-symbols-outlined text-2xl">database</span>
                </div>
                <h3 className="font-headline-sm text-base font-semibold text-on-surface">
                  No Database Connected
                </h3>
                <p className="font-body-dense text-xs text-on-surface-variant max-w-sm mx-auto">
                  Connect your PostgreSQL database to ask questions about your data in plain English.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setConnectDbModalOpen(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary font-label-md text-xs font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98]"
                  >
                    <span className="material-symbols-outlined text-base">database</span>
                    <span>Connect Database</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Active Connection Summary Card */}
                <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/30 flex items-center justify-between gap-4 shadow-2xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-xl">database</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-label-md text-xs font-bold text-on-surface truncate">
                          {activeConn.display_name}
                        </p>
                        <span className="font-code-sm text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                          {activeConn.provider}
                        </span>
                      </div>
                      <p className="font-code-sm text-[10px] text-on-surface-variant truncate">
                        {activeConn.masked_connection_url}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-code-sm text-xs font-semibold text-primary">
                      {activeConn.table_count} tables
                    </span>
                    <button
                      type="button"
                      aria-label={`Disconnect ${activeConn.display_name}`}
                      title="Disconnect database"
                      onClick={() => setConnToDelete(activeConn)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant/40 text-xs font-medium text-on-surface-variant hover:text-error hover:border-error/40 hover:bg-error-container/20 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[15px]">link_off</span>
                      <span>Disconnect</span>
                    </button>
                  </div>
                </div>

                {/* Recent Questions Asked List */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-headline-sm text-sm font-semibold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-base">forum</span>
                      <span>Recent Questions Asked</span>
                    </h3>
                    {turns.length > 5 && (
                      <Link
                        to="/sql"
                        className="font-label-sm text-xs text-primary hover:underline flex items-center gap-0.5 font-medium"
                      >
                        <span>View All History</span>
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                      </Link>
                    )}
                  </div>

                  {turns.length > 0 ? (
                    <div className="space-y-2.5">
                      {turns.slice(0, 5).map((turn) => (
                        <Link
                          key={turn.id}
                          to="/sql"
                          className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/30 hover:border-primary/40 flex items-center justify-between gap-4 transition-colors group shadow-2xs"
                        >
                          <div className="min-w-0 space-y-1">
                            <p className="font-medium text-xs text-on-surface truncate group-hover:text-primary transition-colors">
                              {turn.question}
                            </p>
                            <div className="flex items-center gap-2 font-code-sm text-[10px] text-on-surface-variant">
                              <span>{turn.executed ? `${turn.row_count} rows` : "Preview"}</span>
                              {turn.execution_time_ms > 0 && (
                                <>
                                  <span>•</span>
                                  <span>{turn.execution_time_ms} ms</span>
                                </>
                              )}
                              {turn.chart_suggestion && (
                                <>
                                  <span>•</span>
                                  <span className="text-primary font-semibold">Chart Included</span>
                                </>
                              )}
                            </div>
                          </div>
                          <span className="material-symbols-outlined text-outline group-hover:text-primary text-sm">
                            arrow_forward
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="p-6 rounded-xl bg-surface-container-lowest border border-outline-variant/25 text-xs text-on-surface-variant flex items-center gap-3">
                      <span className="material-symbols-outlined text-lg text-outline">help_outline</span>
                      <span>No questions asked yet. Ask questions in plain English in SQL Studio to see query turns and automated charts.</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteDocMutation.isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-error/30 bg-error-container/50 px-4 py-3 text-sm text-on-error-container"
        >
          <span>Could not delete the document. Your library has been restored.</span>
          <button
            type="button"
            onClick={() => deleteDocMutation.reset()}
            className="font-label-md text-xs font-semibold underline hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {deleteConnMutation.isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-error/30 bg-error-container/50 px-4 py-3 text-sm text-on-error-container"
        >
          <span>Could not disconnect the database. It has been restored.</span>
          <button
            type="button"
            onClick={() => deleteConnMutation.reset()}
            className="font-label-md text-xs font-semibold underline hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Disconnect Database Dialog */}
      <ConfirmActionDialog
        isOpen={Boolean(connToDelete)}
        title="Disconnect Database"
        description={
          connToDelete
            ? `Are you sure you want to disconnect "${connToDelete.display_name}"? Stored schema snapshots and query history will be removed.`
            : ""
        }
        confirmLabel="Disconnect"
        onConfirm={() => {
          if (!connToDelete) return;
          const targetId = connToDelete.id;
          setConnToDelete(null);
          deleteConnMutation.mutate(targetId);
        }}
        onCancel={() => setConnToDelete(null)}
      />

      {/* Delete Document Dialog */}
      <ConfirmActionDialog
        isOpen={Boolean(docToDelete)}
        title="Delete Document?"
        description={
          docToDelete
            ? `Delete "${docToDelete.original_filename}" and all of its indexed passages?`
            : ""
        }
        confirmLabel="Delete Document"
        onConfirm={() => {
          if (!docToDelete) return;
          const targetId = docToDelete.id;
          setDocToDelete(null);
          deleteDocMutation.mutate(targetId);
        }}
        onCancel={() => setDocToDelete(null)}
      />
    </div>
  );
}
