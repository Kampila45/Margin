/**
 * Margin frontend entry point mounting React, React Router, and TanStack Query.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MarginQueryClientProvider } from "./app/query_client_provider";
import { WorkspaceRouter } from "./app/workspace_router";
import "./styles/margin_theme.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root DOM element '#root' was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <MarginQueryClientProvider>
      <BrowserRouter>
        <WorkspaceRouter />
      </BrowserRouter>
    </MarginQueryClientProvider>
  </StrictMode>,
);

