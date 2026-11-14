/**
 * Typed API service methods for document upload, filtered listing, page text, raw file streaming, and deletion.
 */

import type {
  DocumentFormat,
  DocumentListResponse,
  DocumentPageResponse,
  DocumentResponse,
  DocumentStatus,
} from "../types/api_contract_types";
import { buildApiUrl, requestMarginApi } from "./margin_http_client";

export interface DocumentListFilters {
  format?: DocumentFormat | null;
  status?: DocumentStatus | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function fetchDocumentsList(
  filters: DocumentListFilters = {},
): Promise<DocumentListResponse> {
  return requestMarginApi<DocumentListResponse>("/documents", {
    method: "GET",
    query: {
      format: filters.format ?? undefined,
      status: filters.status ?? undefined,
      search: filters.search ?? undefined,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    },
  });
}

export async function fetchDocumentById(documentId: string): Promise<DocumentResponse> {
  return requestMarginApi<DocumentResponse>(`/documents/${encodeURIComponent(documentId)}`, {
    method: "GET",
  });
}

export async function fetchDocumentPageContent(
  documentId: string,
  pageNumber: number,
): Promise<DocumentPageResponse> {
  return requestMarginApi<DocumentPageResponse>(
    `/documents/${encodeURIComponent(documentId)}/pages/${pageNumber}`,
    {
      method: "GET",
    },
  );
}

export async function uploadDocumentFile(file: File): Promise<DocumentResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return requestMarginApi<DocumentResponse>("/documents", {
    method: "POST",
    formData,
    timeoutMs: 90_000,
  });
}

export async function deleteDocumentById(documentId: string): Promise<void> {
  return requestMarginApi<void>(`/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}

export function getDocumentRawFileStreamUrl(documentId: string): string {
  return buildApiUrl(`/documents/${encodeURIComponent(documentId)}/file`);
}

