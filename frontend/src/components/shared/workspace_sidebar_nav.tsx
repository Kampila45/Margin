/**
 * Shared left navigation sidebar ("Margin Lab") matching `workspace-dashboard.html` and `doc-lib-and-upload-center.html`.
 */

import { Link, NavLink, useLocation } from "react-router-dom";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";
import { MarginBrandLogo } from "../ui/margin_brand_logo";
import { formatFileSize } from "../ui/status_pill_badge";

interface WorkspaceSidebarNavProps {
  documentCount: number;
  conversationCount?: number;
  databaseCount?: number;
  sqlTableCount?: number;
  totalBytesUsed: number;
  firstReadyDocumentId: string | null;
  isDocumentsLoading?: boolean;
  isSqlLoading?: boolean;
}

const MAX_DOCUMENTS_PER_SESSION = 25;
const MAX_SESSION_BYTES = 20 * 1024 * 1024 * MAX_DOCUMENTS_PER_SESSION; // 500 MB (25 docs × 20 MB)

export function WorkspaceSidebarNav({
  documentCount,
  databaseCount = 0,
  sqlTableCount = 0,
  totalBytesUsed,
  firstReadyDocumentId,
  isDocumentsLoading = false,
  isSqlLoading = false,
}: WorkspaceSidebarNavProps) {
  const location = useLocation();
  const activeDocumentId = useReaderSelectionStore((s) => s.activeDocumentId);
  const startTour = useReaderSelectionStore((s) => s.startTour);

  const readerTargetId = activeDocumentId ?? firstReadyDocumentId;
  const readerPath = readerTargetId ? `/reader/${readerTargetId}` : "/library";
  // Active Reader should only be highlighted when the user is on a `/reader/:documentId` route,
  // never when `/library` is active simply because `readerTargetId` is null.
  const isReaderRouteActive = location.pathname.startsWith("/reader/");
  const usagePercent = Math.min(100, Math.round((totalBytesUsed / MAX_SESSION_BYTES) * 100));

  return (
    <aside className="w-64 md:w-72 shrink-0 h-screen bg-surface-container-low border-r border-outline-variant/30 flex flex-col justify-between p-4 select-none">
      <div className="flex flex-col gap-5 overflow-y-auto custom-scroll pr-1">
        {/* Brand Header */}
        <div className="flex items-center justify-between pb-3 border-b border-outline-variant/20">
          <Link to="/" className="flex items-center gap-3 group">
            <MarginBrandLogo variant="icon" className="w-9 h-9 shrink-0" />
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface tracking-tight">
                  Margin
                </span>
                <span className="text-[10px] uppercase font-code-sm tracking-wider px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-medium">
                  Studio
                </span>
              </div>
              <span className="font-body-dense text-[11px] text-on-surface-variant leading-tight">
                Read deeper. Understand more.
              </span>
            </div>
          </Link>
        </div>

        {/* Grouped Navigation Links */}
        <nav
          data-tour="sidebar-nav"
          className="flex flex-col gap-4 text-xs"
          aria-label="Main Workspace Navigation"
        >
          {/* Section: Workspace */}
          <div className="space-y-1">
            <span className="px-3 text-[10px] uppercase font-code-sm font-semibold tracking-wider text-outline block">
              Workspace
            </span>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg font-label-md transition-colors ${
                  isActive
                    ? "bg-surface text-primary border border-outline-variant/20 shadow-2xs font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`
              }
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px]">home</span>
                <span>Overview</span>
              </div>
            </NavLink>
          </div>

          {/* Section: Document Intelligence */}
          <div className="space-y-1">
            <span className="px-3 text-[10px] uppercase font-code-sm font-semibold tracking-wider text-outline block">
              Document Intelligence
            </span>
            <NavLink
              to="/library"
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg font-label-md transition-colors ${
                  isActive
                    ? "bg-surface text-primary border border-outline-variant/20 shadow-2xs font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`
              }
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px]">folder_open</span>
                <span>Document Library</span>
              </div>
              {isDocumentsLoading ? (
                <span
                  className="inline-block w-5 h-4 rounded bg-surface-container-high animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <span className="font-code-sm text-[11px] px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-medium">
                  {documentCount}
                </span>
              )}
            </NavLink>

            <Link
              to={readerPath}
              data-tour="active-reader-nav"
              aria-current={isReaderRouteActive ? "page" : undefined}
              className={`flex items-center justify-between px-3 py-2 rounded-lg font-label-md transition-colors ${
                isReaderRouteActive
                  ? "bg-surface text-primary border border-outline-variant/20 shadow-2xs font-semibold"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px]">menu_book</span>
                <span>Active Reader</span>
              </div>
            </Link>
          </div>

          {/* Section: Structured SQL Assistant */}
          <div className="space-y-1">
            <span className="px-3 text-[10px] uppercase font-code-sm font-semibold tracking-wider text-outline block">
              Structured SQL Assistant
            </span>
            <NavLink
              to="/sql"
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg font-label-md transition-colors ${
                  isActive
                    ? "bg-surface text-primary border border-outline-variant/20 shadow-2xs font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`
              }
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px]">database</span>
                <span>SQL Assistant</span>
              </div>
              {databaseCount > 0 && (
                <span className="font-code-sm text-[11px] px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-medium">
                  {databaseCount}
                </span>
              )}
            </NavLink>
          </div>
        </nav>
      </div>

      {/* Footer Storage Status & Tour Trigger */}
      <div className="flex flex-col gap-2 pt-3 border-t border-outline-variant/20">
        <button
          type="button"
          onClick={startTour}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-label-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors w-full"
        >
          <span className="material-symbols-outlined text-[16px] text-primary">explore</span>
          <span>Interactive App Tour</span>
        </button>

        <div className="p-3 bg-surface rounded-lg border border-outline-variant/20 space-y-2.5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-label-sm text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                Document Storage
              </span>
              {isDocumentsLoading ? (
                <span
                  className="inline-block w-14 h-3.5 rounded bg-surface-container-high animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <span className="font-code-sm text-[11px] text-on-surface font-medium whitespace-nowrap">
                  {documentCount} / {MAX_DOCUMENTS_PER_SESSION} docs
                </span>
              )}
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{
                  width: `${isDocumentsLoading || documentCount === 0 ? 0 : Math.max(4, usagePercent)}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 font-code-sm text-[11px] text-on-surface-variant">
              {isDocumentsLoading ? (
                <span
                  className="inline-block w-12 h-3 rounded bg-surface-container-high animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <span className="whitespace-nowrap">{formatFileSize(totalBytesUsed)} used</span>
              )}
              <span className="whitespace-nowrap">500 MB max</span>
            </div>
          </div>

          <div className="pt-2.5 border-t border-outline-variant/20 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-label-sm text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                SQL Session
              </span>
              {isSqlLoading ? (
                <span
                  className="inline-block w-9 h-3.5 rounded bg-surface-container-high animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <span className="font-code-sm text-[11px] text-on-surface font-medium whitespace-nowrap">
                  {databaseCount} {databaseCount === 1 ? "db" : "dbs"}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 font-code-sm text-[11px] text-on-surface-variant">
              {isSqlLoading ? (
                <span
                  className="inline-block w-14 h-3 rounded bg-surface-container-high animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <span className="whitespace-nowrap">
                  {databaseCount > 0
                    ? `${sqlTableCount} ${sqlTableCount === 1 ? "table" : "tables"}`
                    : "Live read-only"}
                </span>
              )}
              <span className="whitespace-nowrap">100 rows · 5s max</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
