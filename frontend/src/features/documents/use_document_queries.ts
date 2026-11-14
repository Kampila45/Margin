/**
 * TanStack Query hooks for document listing, status polling, page fetching, uploads, and deletion.
 */

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  deleteDocumentById,
  type DocumentListFilters,
  fetchDocumentById,
  fetchDocumentPageContent,
  fetchDocumentsList,
  uploadDocumentFile,
} from "../../services/document_api_client";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";
import {
  DOCUMENT_STATUS,
  type ConversationListResponse,
  type DocumentListResponse,
} from "../../types/api_contract_types";

export const DOCUMENT_QUERY_KEYS = {
  all: ["documents"] as const,
  list: (filters: DocumentListFilters) => ["documents", "list", filters] as const,
  detail: (documentId: string) => ["documents", "detail", documentId] as const,
  page: (documentId: string, pageNumber: number) =>
    ["documents", "page", documentId, pageNumber] as const,
};

export function useDocumentsListQuery(filters: DocumentListFilters = {}) {
  return useQuery({
    queryKey: DOCUMENT_QUERY_KEYS.list(filters),
    queryFn: () => fetchDocumentsList(filters),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasProcessing = items.some(
        (doc) =>
          doc.status === DOCUMENT_STATUS.PENDING ||
          doc.status === DOCUMENT_STATUS.PROCESSING,
      );
      return hasProcessing ? 2_500 : false;
    },
  });
}

export function useDocumentDetailQuery(documentId: string | undefined) {
  return useQuery({
    queryKey: DOCUMENT_QUERY_KEYS.detail(documentId ?? ""),
    queryFn: () => fetchDocumentById(documentId!),
    enabled: Boolean(documentId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === DOCUMENT_STATUS.PENDING || status === DOCUMENT_STATUS.PROCESSING
        ? 2_000
        : false;
    },
  });
}

export function useDocumentPageQuery(
  documentId: string | undefined,
  pageNumber: number,
  enabled = true,
) {
  return useQuery({
    queryKey: DOCUMENT_QUERY_KEYS.page(documentId ?? "", pageNumber),
    queryFn: () => fetchDocumentPageContent(documentId!, pageNumber),
    enabled: Boolean(documentId) && pageNumber >= 1 && enabled,
  });
}

export function useUploadDocumentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadDocumentFile(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DOCUMENT_QUERY_KEYS.all });
    },
  });
}

interface DeleteDocumentRollbackContext {
  previousDocumentLists: Array<[QueryKey, DocumentListResponse | undefined]>;
  previousConversationLists: Array<[QueryKey, ConversationListResponse | undefined]>;
}

export function useDeleteDocumentMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string, DeleteDocumentRollbackContext>({
    mutationFn: (documentId: string) => deleteDocumentById(documentId),
    onMutate: async (documentId) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: DOCUMENT_QUERY_KEYS.all }),
        queryClient.cancelQueries({ queryKey: ["conversations"] }),
      ]);

      const previousDocumentLists = queryClient.getQueriesData<DocumentListResponse>({
        queryKey: ["documents", "list"],
      });
      const previousConversationLists = queryClient.getQueriesData<ConversationListResponse>({
        queryKey: ["conversations", "list"],
      });

      queryClient.setQueriesData<DocumentListResponse>(
        { queryKey: ["documents", "list"] },
        (existing) => {
          if (!existing) return existing;
          const nextItems = existing.items.filter((doc) => doc.id !== documentId);
          const removedCount = existing.items.length - nextItems.length;
          if (removedCount === 0) return existing;
          return {
            ...existing,
            items: nextItems,
            total: Math.max(0, existing.total - removedCount),
          };
        },
      );

      queryClient.setQueriesData<ConversationListResponse>(
        { queryKey: ["conversations", "list"] },
        (existing) => {
          if (!existing) return existing;
          const nextItems = existing.items.filter((conv) => conv.document_id !== documentId);
          const removedCount = existing.items.length - nextItems.length;
          if (removedCount === 0) return existing;
          return {
            ...existing,
            items: nextItems,
            total: Math.max(0, existing.total - removedCount),
          };
        },
      );

      queryClient.removeQueries({ queryKey: DOCUMENT_QUERY_KEYS.detail(documentId) });
      queryClient.removeQueries({ queryKey: ["documents", "page", documentId] });

      const readerStore = useReaderSelectionStore.getState();
      if (readerStore.activeDocumentId === documentId) {
        readerStore.setActiveDocument(null);
      }

      return { previousDocumentLists, previousConversationLists };
    },
    onError: (_error, _documentId, context) => {
      if (!context) return;
      for (const [queryKey, snapshot] of context.previousDocumentLists) {
        queryClient.setQueryData(queryKey, snapshot);
      }
      for (const [queryKey, snapshot] of context.previousConversationLists) {
        queryClient.setQueryData(queryKey, snapshot);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: DOCUMENT_QUERY_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

