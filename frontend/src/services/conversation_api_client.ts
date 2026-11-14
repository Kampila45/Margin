/**
 * Typed API service methods for conversations, transcripts, and grounded question answering (`document_qa` & `selection_qa`).
 */

import type {
  ChatMessageCreateRequest,
  ChatTurnResponse,
  ConversationCreateRequest,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummaryResponse,
} from "../types/api_contract_types";
import { requestMarginApi } from "./margin_http_client";

export async function fetchConversationsList(params: {
  documentId?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<ConversationListResponse> {
  return requestMarginApi<ConversationListResponse>("/conversations", {
    method: "GET",
    query: {
      document_id: params.documentId ?? undefined,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    },
  });
}

export async function fetchConversationDetail(
  conversationId: string,
): Promise<ConversationDetailResponse> {
  return requestMarginApi<ConversationDetailResponse>(
    `/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "GET",
    },
  );
}

export async function createConversationThread(
  payload: ConversationCreateRequest,
): Promise<ConversationSummaryResponse> {
  return requestMarginApi<ConversationSummaryResponse>("/conversations", {
    method: "POST",
    jsonBody: payload,
  });
}

export async function submitConversationQuestion(
  conversationId: string,
  payload: ChatMessageCreateRequest,
): Promise<ChatTurnResponse> {
  return requestMarginApi<ChatTurnResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      jsonBody: payload,
      timeoutMs: 60_000,
    },
  );
}

export async function deleteConversationById(conversationId: string): Promise<void> {
  return requestMarginApi<void>(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  });
}

