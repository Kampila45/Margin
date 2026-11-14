/**
 * Root Margin workspace shell combining the left navigation sidebar, routed main canvas, and global upload modal.
 */

import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { WorkspaceSidebarNav } from "../components/shared/workspace_sidebar_nav";
import { DocumentUploadModal } from "../features/documents/document_upload_modal";
import { useDocumentsListQuery } from "../features/documents/use_document_queries";
import { ConnectDatabaseModal } from "../features/sql/connect_database_modal";
import { useSqlWorkspaceQuery } from "../features/sql/use_sql_queries";
import { InteractiveProductTour } from "../features/onboarding/interactive_product_tour";
import { OnboardingGuideModal } from "../features/onboarding/onboarding_guide_modal";
import { useReaderSelectionStore } from "../stores/reader_selection_store";
import { DOCUMENT_STATUS } from "../types/api_contract_types";

export function MarginAppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const documentsQuery = useDocumentsListQuery({ limit: 50 });
  const sqlWorkspaceQuery = useSqlWorkspaceQuery();

  const isConnectDbModalOpen = useReaderSelectionStore((s) => s.isConnectDbModalOpen);
  const setConnectDbModalOpen = useReaderSelectionStore((s) => s.setConnectDbModalOpen);

  const documents = documentsQuery.data?.items ?? [];
  const totalBytesUsed = documents.reduce((acc, doc) => acc + doc.file_size_bytes, 0);
  const firstReadyDoc =
    documents.find((doc) => doc.status === DOCUMENT_STATUS.READY) ?? null;
  const sqlConnections = sqlWorkspaceQuery.data?.connections ?? [];
  const databaseCount = sqlConnections.length;
  const sqlTableCount = sqlConnections.reduce((acc, conn) => acc + conn.table_count, 0);

  useEffect(() => {
    const path = location.pathname;
    if (path === "/") {
      document.title = "Margin — Overview";
    } else if (path === "/library") {
      document.title = "Margin — Document Library";
    } else if (path === "/sql") {
      document.title = "Margin — SQL Assistant";
    } else if (path.startsWith("/reader/")) {
      const docId = path.slice("/reader/".length);
      const matchedDoc = documents.find((d) => d.id === docId);
      document.title = matchedDoc
        ? `Margin — ${matchedDoc.original_filename}`
        : "Margin — Active Reader";
    } else {
      document.title = "Margin — Page Not Found";
    }
  }, [location.pathname, documents]);

  return (
    <div className="min-h-screen h-screen flex overflow-hidden bg-background text-on-surface">
      <WorkspaceSidebarNav
        documentCount={documentsQuery.data?.total ?? 0}
        databaseCount={databaseCount}
        sqlTableCount={sqlTableCount}
        totalBytesUsed={totalBytesUsed}
        firstReadyDocumentId={firstReadyDoc?.id ?? null}
        isDocumentsLoading={documentsQuery.isPending}
        isSqlLoading={sqlWorkspaceQuery.isPending}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <Outlet />
      </div>

      <DocumentUploadModal />
      <ConnectDatabaseModal
        isOpen={isConnectDbModalOpen}
        onClose={() => setConnectDbModalOpen(false)}
        onConnected={() => {
          setConnectDbModalOpen(false);
          navigate("/sql");
        }}
      />
      <OnboardingGuideModal />
      <InteractiveProductTour />
    </div>
  );
}

