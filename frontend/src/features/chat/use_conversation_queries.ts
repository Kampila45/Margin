/**
 * TanStack Query hooks for conversations, transcripts, and grounded question answering (`document_qa` & `selection_qa`).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConversationThread,
  deleteConversationById,
  fetchConversationDetail,
  fetchConversationsList,
  submitConversationQuestion,
} from "../../services/conversation_api_client";
import type {
  ChatMessageCreateRequest,
  ConversationCreateRequest,
} from "../../types/api_contract_types";

export const CONVERSATION_QUERY_KEYS = {
  all: ["conversations"] as const,
  list: (documentId?: string | null) =>
    ["conversations", "list", documentId ?? "all"] as const,
  detail: (conversationId: string) =>
    ["conversations", "detail", conversationId] as const,
};

export function useConversationsListQuery(documentId?: string | null) {
  return useQuery({
    queryKey: CONVERSATION_QUERY_KEYS.list(documentId),
    queryFn: () => fetchConversationsList({ documentId }),
  });
}

export function useConversationDetailQuery(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: CONVERSATION_QUERY_KEYS.detail(conversationId ?? ""),
    queryFn: () => fetchConversationDetail(conversationId!),
    enabled: Boolean(conversationId),
  });
}

export function useCreateConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConversationCreateRequest) => createConversationThread(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONVERSATION_QUERY_KEYS.all });
    },
  });
}

export function useAskConversationQuestionMutation(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ChatMessageCreateRequest) => {
      if (!conversationId) {
        throw new Error("No active conversation selected.");
      }
      return submitConversationQuestion(conversationId, payload);
    },
    onSuccess: () => {
      if (conversationId) {
        void queryClient.invalidateQueries({
          queryKey: CONVERSATION_QUERY_KEYS.detail(conversationId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: CONVERSATION_QUERY_KEYS.all });
    },
  });
}

export function useDeleteConversationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => deleteConversationById(conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONVERSATION_QUERY_KEYS.all });
    },
  });
}

