/**
 * Application router defining the Workspace Dashboard, Document Library, Three-Panel Reader, and SQL Assistant routes.
 */

import { Route, Routes } from "react-router-dom";
import { HttpErrorStateView } from "../components/shared/http_error_state_view";
import { DocumentLibraryView } from "../features/documents/document_library_view";
import { ThreePanelReaderView } from "../features/reader/three_panel_reader_view";
import { SqlAssistantView } from "../features/sql/sql_assistant_view";
import { WorkspaceDashboardView } from "../features/workspace/workspace_dashboard_view";
import { MarginAppShell } from "./margin_app_shell";

export function WorkspaceRouter() {
  return (
    <Routes>
      <Route element={<MarginAppShell />}>
        <Route path="/" element={<WorkspaceDashboardView />} />
        <Route path="/library" element={<DocumentLibraryView />} />
        <Route path="/reader/:documentId" element={<ThreePanelReaderView />} />
        <Route path="/sql" element={<SqlAssistantView />} />
        <Route path="*" element={<HttpErrorStateView statusCode={404} />} />
      </Route>
    </Routes>
  );
}

