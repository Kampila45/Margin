/**
 * Main Margin SQL Assistant workspace: external PostgreSQL data sources, schema explorer,
 * and unified conversational chat displaying natural-language answers alongside charts.
 */

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { MarginChatPanel, type MarginChatMessage } from "../../components/shared/margin_chat_panel";
import { ConfirmActionDialog } from "../../components/ui/confirm_action_dialog";
import { LoadingSpinner } from "../../components/ui/loading_spinner";
import { getUserFriendlyErrorMessage } from "../../services/margin_http_client";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";
import type {
  DatabaseConnectionResponse,
  DatabaseTableSchema,
} from "../../types/api_contract_types";
import { SqlResultChart } from "./sql_result_chart";
import {
  useActivateDatabaseConnectionMutation,
  useDeleteDatabaseConnectionMutation,
  useGenerateSqlQueryTurnMutation,
  useSqlWorkspaceQuery,
} from "./use_sql_queries";

export function SqlAssistantView() {
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const setConnectDbModalOpen = useReaderSelectionStore((s) => s.setConnectDbModalOpen);
  const [connectionToDelete, setConnectionToDelete] = useState<DatabaseConnectionResponse | null>(null);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [userQuestion, setUserQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const [isSchemaSidebarOpen, setIsSchemaSidebarOpen] = useState(true);
  const [focusedTables, setFocusedTables] = useState<string[]>([]);
  const [isChatDragActive, setIsChatDragActive] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);

  const { data: workspace, isLoading, isError, refetch } = useSqlWorkspaceQuery(activeConnectionId);
  const activateMutation = useActivateDatabaseConnectionMutation();
  const deleteMutation = useDeleteDatabaseConnectionMutation();
  const generateMutation = useGenerateSqlQueryTurnMutation();

  const connections = workspace?.connections ?? [];
  const activeConn =
    connections.find((c) => c.id === (activeConnectionId ?? workspace?.active_connection_id)) ??
    connections.find((c) => c.is_active) ??
    connections[0] ??
    null;

  const turns = workspace?.turns ?? [];

  useEffect(() => {
    setFocusedTables([]);
  }, [activeConn?.id]);

  const attachTableToChat = (tableName: string) => {
    if (!activeConn) return;
    const matched = activeConn.tables.find(
      (t) => t.table_name.toLowerCase() === tableName.trim().toLowerCase(),
    );
    if (!matched) return;
    setFocusedTables((prev) =>
      prev.includes(matched.table_name) ? prev : [...prev, matched.table_name],
    );
  };

  const removeFocusedTable = (tableName: string) => {
    setFocusedTables((prev) => prev.filter((name) => name !== tableName));
  };

  const handleChatDragOver = (event: DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (types.includes("application/x-margin-sql-table") || types.includes("text/plain")) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      if (!isChatDragActive) {
        setIsChatDragActive(true);
      }
    }
  };

  const handleChatDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsChatDragActive(false);
    }
  };

  const handleChatDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsChatDragActive(false);
    const droppedTable =
      event.dataTransfer?.getData("application/x-margin-sql-table") ||
      event.dataTransfer?.getData("text/plain") ||
      "";
    if (droppedTable.trim()) {
      attachTableToChat(droppedTable);
      composerInputRef.current?.focus();
    }
  };

  const toggleTableExpand = (tableName: string) => {
    setExpandedTables((prev) => ({
      ...prev,
      [tableName]: !prev[tableName],
    }));
  };

  const handleSelectConnection = async (connId: string) => {
    setActiveConnectionId(connId);
    try {
      await activateMutation.mutateAsync(connId);
    } catch {
      // non-blocking
    }
  };

  const handleDeleteConnection = () => {
    if (!connectionToDelete) return;
    const targetId = connectionToDelete.id;
    setConnectionToDelete(null);
    if (activeConnectionId === targetId) {
      setActiveConnectionId(null);
    }
    deleteMutation.mutate(targetId);
  };

  const handleSendQuestion = async (e?: React.FormEvent, questionOverride?: string) => {
    if (e) e.preventDefault();
    const q = (questionOverride ?? userQuestion).trim();
    if (!q || !activeConn || generateMutation.isPending) return;

    setUserQuestion("");
    setPendingQuestion(q);
    setFailedQuestion(null);
    setGenerateError(null);

    setTimeout(() => {
      chatScrollRef.current?.scrollTo?.({
        top: chatScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 40);

    try {
      const turn = await generateMutation.mutateAsync({
        connectionId: activeConn.id,
        payload: {
          question: q,
          execute_immediately: true,
          focused_tables: focusedTables.length > 0 ? focusedTables : undefined,
        },
      });
      setPendingQuestion(null);
      setFailedQuestion(null);
      setTimeout(() => {
        chatScrollRef.current?.scrollTo?.({
          top: chatScrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 100);
      return turn;
    } catch (err) {
      setPendingQuestion(null);
      setFailedQuestion(q);
      if (!questionOverride) {
        setUserQuestion(q);
      }
      const msg = getUserFriendlyErrorMessage(
        err,
        "The AI assistant is temporarily busy or rate-limited. Please try asking again shortly.",
      );
      setGenerateError(msg);
    }
  };

  const filteredTables = useMemo(() => {
    if (!activeConn) return [];
    const q = schemaSearch.toLowerCase().trim();
    if (!q) return activeConn.tables;
    return activeConn.tables.filter(
      (t) =>
        t.table_name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q)),
    );
  }, [activeConn, schemaSearch]);

  const examplePrompts = [
    "How many records are in each table?",
    "Which items generate the highest total revenue?",
    "Show me the top 10 most recent records.",
    "Summarize total metrics grouped by category.",
  ];

  const sqlChatMessages: MarginChatMessage[] = useMemo(() => {
    const mapped: MarginChatMessage[] = [];
    for (const turn of turns) {
      mapped.push({
        id: `${turn.id}-user`,
        role: "user",
        content: turn.question,
      });

      mapped.push({
        id: `${turn.id}-assistant`,
        role: "assistant",
        content: turn.answer_summary || turn.explanation || "No summary available.",
        extraContent:
          turn.executed && turn.chart_suggestion && turn.rows.length > 0 ? (
            <SqlResultChart suggestion={turn.chart_suggestion} rows={turn.rows} />
          ) : undefined,
      });
    }

    const pendingOrFailed = pendingQuestion ?? (generateError ? failedQuestion : null);
    if (pendingOrFailed) {
      mapped.push({
        id: "sql-active-question",
        role: "user",
        content: pendingOrFailed,
      });
    }
    return mapped;
  }, [turns, pendingQuestion, generateError, failedQuestion]);

  return (
    <div className="flex-1 flex overflow-hidden bg-background h-screen">
      {/* LEFT RAIL: Collapsible Data Sources & Schema Explorer */}
      {isSchemaSidebarOpen && (
      <aside className="w-72 lg:w-80 shrink-0 h-screen border-r border-surface-container-high bg-surface-container-lowest flex flex-col justify-between select-none">
        <div className="flex flex-col h-full overflow-hidden">
          {/* Rail Header / Active Connection Card */}
          <div className="p-3.5 border-b border-surface-container-high bg-surface-container-low/50">
            {activeConn ? (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-primary-fixed/60 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-2xs">
                      <span className="material-symbols-outlined text-[20px]">database</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-label-md font-semibold text-on-surface truncate">
                          {activeConn.display_name}
                        </p>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" title="Active" />
                      </div>
                      <p className="font-code-sm text-[11px] text-on-surface-variant truncate">
                        {activeConn.masked_connection_url}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSchemaSidebarOpen(false)}
                    aria-label="Collapse schema panel"
                    title="Collapse schema panel"
                    className="p-1 text-on-surface-variant hover:text-primary rounded-lg hover:bg-surface-container transition-colors shrink-0"
                  >
                    <span className="material-symbols-outlined text-[18px]">left_panel_close</span>
                  </button>
                </div>
                <div className="flex items-center justify-between pt-1 text-[10px] font-code-sm text-on-surface-variant">
                  <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface uppercase font-medium">
                    {activeConn.provider}
                  </span>
                  <span>{activeConn.table_count} public tables</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-xl">database</span>
                  <span className="font-headline-sm text-sm font-bold text-on-surface">Data Sources</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSchemaSidebarOpen(false)}
                  aria-label="Collapse schema panel"
                  title="Collapse schema panel"
                  className="p-1 text-on-surface-variant hover:text-primary rounded-lg hover:bg-surface-container transition-colors shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">left_panel_close</span>
                </button>
              </div>
            )}
          </div>

          {/* Connected Data Sources List */}
          {connections.length > 0 && (
            <div className="p-2 border-b border-surface-container-high max-h-32 overflow-y-auto custom-scroll space-y-1">
              <span className="font-label-sm text-[10px] text-on-surface-variant font-medium uppercase px-2 block">
                Saved Databases
              </span>
              {connections.map((c) => {
                const isSelected = activeConn?.id === c.id;
                return (
                    <div
                      key={c.id}
                      onClick={() => handleSelectConnection(c.id)}
                      className={`group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-surface-container text-primary font-semibold"
                          : "text-on-surface-variant hover:bg-surface-container-low"
                      }`}
                    >
                      <span className="truncate flex-1 min-w-0">{c.display_name}</span>
                      <button
                        type="button"
                        aria-label={`Disconnect ${c.display_name}`}
                        title="Disconnect database"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConnectionToDelete(c);
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-on-surface-variant hover:text-error hover:bg-error-container/30 rounded transition-colors shrink-0"
                      >
                        <span className="material-symbols-outlined text-[14px]">link_off</span>
                        <span>Disconnect</span>
                      </button>
                    </div>
                );
              })}
            </div>
          )}

          {/* Schema Explorer Navigation Heading */}
          <div className="px-3 pt-3 pb-1 border-b border-surface-container-high">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-label-md text-primary font-semibold">
                <span className="material-symbols-outlined text-sm">account_tree</span>
                <span>Schema Explorer</span>
              </div>
            </div>
          </div>

          {/* Search Filter for Tables */}
          {activeConn && (
            <div className="p-3 border-b border-surface-container-high">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-2.5 top-2 text-sm text-outline">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Filter tables & columns..."
                  value={schemaSearch}
                  onChange={(e) => setSchemaSearch(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface placeholder:text-outline focus:outline-none focus:border-primary font-body-default"
                />
              </div>
            </div>
          )}

          {/* Discovered Schema Tree List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 custom-scroll">
            {!activeConn ? (
              <div className="p-6 text-center text-xs text-on-surface-variant font-body-dense space-y-2.5 my-auto flex flex-col items-center justify-center">
                <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center text-outline">
                  <span className="material-symbols-outlined text-xl">schema</span>
                </div>
                <p className="font-medium text-on-surface">No tables loaded</p>
                <p className="text-[11px] text-on-surface-variant leading-relaxed max-w-[200px]">
                  Connect a database to explore tables, columns, and relations.
                </p>
              </div>
            ) : filteredTables.length === 0 ? (
              <div className="p-4 text-center text-xs text-on-surface-variant font-body-dense">
                No matching tables found.
              </div>
            ) : (
              filteredTables.map((table: DatabaseTableSchema) => {
                const isExpanded = !!expandedTables[table.table_name];
                const isFocused = focusedTables.includes(table.table_name);
                return (
                  <div
                    key={table.table_name}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-margin-sql-table", table.table_name);
                      e.dataTransfer.setData("text/plain", table.table_name);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => setIsChatDragActive(false)}
                    title="Drag table into chat to ask questions directly about it"
                    className={`group rounded-xl border overflow-hidden text-xs shadow-2xs transition-colors ${
                      isFocused
                        ? "border-primary/45 bg-primary/5"
                        : "border-outline-variant/30 bg-surface-container-lowest"
                    }`}
                  >
                    <div className="flex items-center hover:bg-surface-container-low transition-colors">
                      <button
                        type="button"
                        onClick={() => toggleTableExpand(table.table_name)}
                        className="flex-1 min-w-0 p-2.5 flex items-center justify-between text-left cursor-grab active:cursor-grabbing"
                      >
                        <div className="flex items-center gap-1.5 min-w-0 truncate">
                          <span className="material-symbols-outlined text-outline/60 text-[14px] shrink-0">
                            drag_indicator
                          </span>
                          <span className="material-symbols-outlined text-primary text-base shrink-0">
                            table_chart
                          </span>
                          <span className="font-mono font-medium text-on-surface truncate">
                            {table.table_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 text-on-surface-variant font-code-sm text-[10px]">
                          <span>{table.columns.length} cols</span>
                          <span className="material-symbols-outlined text-sm">
                            {isExpanded ? "expand_less" : "expand_more"}
                          </span>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isFocused) {
                            removeFocusedTable(table.table_name);
                          } else {
                            attachTableToChat(table.table_name);
                            composerInputRef.current?.focus();
                          }
                        }}
                        aria-label={isFocused ? "Remove table from chat focus" : "Add table to chat focus"}
                        title={
                          isFocused
                            ? `Remove ${table.table_name} from chat focus`
                            : `Add ${table.table_name} to chat focus`
                        }
                        className={`mr-2 p-1 rounded-md transition-all shrink-0 ${
                          isFocused
                            ? "text-primary bg-primary/10 hover:bg-primary/20 opacity-100"
                            : "text-on-surface-variant hover:text-primary hover:bg-surface-container opacity-0 group-hover:opacity-100 focus:opacity-100"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {isFocused ? "check" : "add"}
                        </span>
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="px-2.5 pb-2.5 pt-1 space-y-1 border-t border-surface-container-high bg-surface-container-low/30 font-mono text-[11px]">
                        {table.columns.map((col) => (
                          <div
                            key={col.name}
                            className="flex items-center justify-between py-0.5 hover:bg-surface-container-high/40 rounded px-1"
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="truncate text-on-surface">{col.name}</span>
                              {col.is_primary_key && (
                                <span className="px-1 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-[9px]">
                                  PK
                                </span>
                              )}
                              {col.foreign_key_target && (
                                <span
                                  className="px-1 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-medium text-[9px] truncate max-w-[110px]"
                                  title={`References ${col.foreign_key_target}`}
                                >
                                  FK -&gt; {col.foreign_key_target}
                                </span>
                              )}
                            </div>
                            <span className="text-on-surface-variant text-[10px] shrink-0">
                              {col.data_type}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
      )}

      {/* MAIN CANVAS: Unified Chat Panel (Natural Language Answers + Graphs Only) */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background">
        {/* Studio Sub-header */}
        <header className="px-6 py-3 border-b border-surface-container-high bg-surface-container-lowest flex items-center justify-between gap-4 shrink-0 select-none">
          <div className="flex items-center gap-2 min-w-0">
            {!isSchemaSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsSchemaSidebarOpen(true)}
                aria-label="Expand schema panel"
                title="Expand schema panel"
                className="p-1 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-base">left_panel_open</span>
              </button>
            )}
            <span className="material-symbols-outlined text-primary text-base">terminal</span>
            <h1 className="font-headline-sm font-semibold text-sm text-on-surface truncate">
              SQL Studio
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConnectDbModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant/40 hover:bg-surface-container text-on-surface font-label-md text-xs font-medium transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              <span>Add Connection</span>
            </button>
          </div>
        </header>

        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center space-y-3 p-6">
            <LoadingSpinner size="md" ariaLabel="Loading SQL workspace" />
            <p className="font-body-default text-xs text-on-surface-variant">Loading SQL workspace…</p>
          </div>
        ) : isError ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-md p-6 rounded-2xl bg-surface-container-lowest border border-rose-500/30 text-center space-y-3">
              <span className="material-symbols-outlined text-rose-500 text-3xl">cloud_off</span>
              <h3 className="font-headline-sm text-sm font-semibold text-on-surface">Unable to load SQL workspace</h3>
              <p className="font-body-dense text-xs text-on-surface-variant">
                We couldn&apos;t connect to the database service right now. Please check your network or try again.
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="px-4 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        ) : !activeConn ? (
          <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scroll">
            <div className="max-w-2xl mx-auto py-10 space-y-8 animate-in fade-in duration-300">
              <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/35 p-8 shadow-xs text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mx-auto shadow-xs">
                  <span className="material-symbols-outlined text-3xl">database</span>
                </div>
                <div className="space-y-1.5">
                  <h2 className="font-headline-sm text-xl font-bold text-on-surface">
                    Connect an External PostgreSQL Database
                  </h2>
                  <p className="font-body-default text-sm text-on-surface-variant max-w-lg mx-auto">
                    Ask questions about your structured tables in plain English and get clear answers
                    paired with visual charts.
                  </p>
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setConnectDbModalOpen(true)}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary hover:bg-primary/95 text-on-primary font-label-md text-sm font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-all active:scale-[0.98]"
                  >
                    <span
                      className="material-symbols-outlined text-[18px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      bolt
                    </span>
                    <span>Connect PostgreSQL Database</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/30 space-y-1.5 shadow-2xs">
                  <span className="material-symbols-outlined text-primary text-xl">lock</span>
                  <h3 className="font-headline-sm text-xs font-bold text-on-surface">
                    Encrypted Credentials
                  </h3>
                  <p className="font-body-dense text-xs text-on-surface-variant">
                    Credentials are encrypted with authenticated symmetric encryption and never shared
                    with the AI model.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/30 space-y-1.5 shadow-2xs">
                  <span className="material-symbols-outlined text-primary text-xl">
                    verified_user
                  </span>
                  <h3 className="font-headline-sm text-xs font-bold text-on-surface">
                    Read-Only Guarantees
                  </h3>
                  <p className="font-body-dense text-xs text-on-surface-variant">
                    Only single read-only SELECT queries are allowed. Modifying statements are
                    rejected before execution.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/30 space-y-1.5 shadow-2xs">
                  <span className="material-symbols-outlined text-primary text-xl">
                    bar_chart
                  </span>
                  <h3 className="font-headline-sm text-xs font-bold text-on-surface">
                    Answers &amp; Charts
                  </h3>
                  <p className="font-body-dense text-xs text-on-surface-variant">
                    Results are summarized in plain language alongside automatic bar and trend line
                    visualizations.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <MarginChatPanel
            scrollRef={chatScrollRef}
            composerRef={composerInputRef}
            messages={sqlChatMessages}
            isGenerating={generateMutation.isPending}
            errorMessage={generateError}
            errorTitle="AI Generation Failed"
            isDragActive={isChatDragActive}
            dropOverlayLabel="Drop table here to ask questions directly about it"
            onDragOver={handleChatDragOver}
            onDragLeave={handleChatDragLeave}
            onDrop={handleChatDrop}
            onRetry={() => {
              const retryQ = failedQuestion ?? userQuestion;
              setGenerateError(null);
              setFailedQuestion(null);
              void handleSendQuestion(undefined, retryQ);
            }}
            onDismissError={() => {
              setGenerateError(null);
              setFailedQuestion(null);
            }}
            emptyState={
              <div className="max-w-2xl mx-auto py-12 space-y-6 text-center animate-in fade-in duration-300">
                <div className="space-y-2">
                  <h2 className="font-headline-sm text-lg font-bold text-on-surface">
                    Connected to {activeConn.display_name}
                  </h2>
                  <p className="font-body-default text-xs text-on-surface-variant max-w-md mx-auto">
                    Discovered {activeConn.table_count} public tables. Ask a question below, drag any
                    table here to focus on it, or click a sample prompt:
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left pt-2">
                  {examplePrompts.map((promptText) => {
                    const isThisPromptPending = pendingQuestion === promptText;
                    return (
                      <button
                        key={promptText}
                        type="button"
                        disabled={generateMutation.isPending}
                        onClick={() => handleSendQuestion(undefined, promptText)}
                        className={`p-3.5 rounded-xl border border-outline-variant/30 bg-surface-container-lowest text-on-surface text-xs font-body-dense transition-all shadow-2xs text-left group ${
                          generateMutation.isPending
                            ? isThisPromptPending
                              ? "border-primary bg-primary/5 cursor-wait"
                              : "opacity-40 cursor-not-allowed"
                            : "hover:bg-surface-container-low hover:border-primary/40 cursor-pointer"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`font-medium transition-colors ${
                              isThisPromptPending ? "text-primary font-semibold" : "group-hover:text-primary"
                            }`}
                          >
                            {promptText}
                          </span>
                          {isThisPromptPending ? (
                            <LoadingSpinner size="xs" ariaLabel="Running sample query" />
                          ) : (
                            <span className="material-symbols-outlined text-outline group-hover:text-primary text-sm">
                              arrow_forward
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            }
            composerHeader={
              focusedTables.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 pb-1">
                  <span className="font-label-sm text-[11px] text-on-surface-variant mr-0.5">
                    Focused tables:
                  </span>
                  {focusedTables.map((tableName) => (
                    <span
                      key={tableName}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-primary font-mono text-[11px] font-medium"
                    >
                      <span className="material-symbols-outlined text-[13px]">table_chart</span>
                      <span>{tableName}</span>
                      <button
                        type="button"
                        onClick={() => removeFocusedTable(tableName)}
                        aria-label={`Remove ${tableName}`}
                        className="hover:text-on-surface transition-colors ml-0.5"
                      >
                        <span className="material-symbols-outlined text-[13px]">close</span>
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setFocusedTables([])}
                    className="font-code-sm text-[10px] text-on-surface-variant hover:text-on-surface underline ml-1"
                  >
                    Clear
                  </button>
                </div>
              ) : undefined
            }
            composerValue={userQuestion}
            onComposerChange={setUserQuestion}
            onSubmit={() => void handleSendQuestion()}
            composerPlaceholder="Ask Margin..."
            sendButtonTitle="Ask Margin"
            contentWidthClass="max-w-3xl mx-auto"
            scrollContainerClassName="p-6 md:p-8"
          />
        )}
      </main>

      {/* Disconnect Confirmation Dialog */}
      <ConfirmActionDialog
        isOpen={!!connectionToDelete}
        title="Disconnect Database"
        description={`Are you sure you want to disconnect "${connectionToDelete?.display_name}"? Stored schema snapshots and query history will be removed.`}
        confirmLabel="Disconnect"
        onConfirm={handleDeleteConnection}
        onCancel={() => setConnectionToDelete(null)}
      />
    </div>
  );
}
