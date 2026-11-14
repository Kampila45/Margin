/**
 * Configured HTTP client for Margin `/api/v1` endpoints with structured error parsing and session preservation.
 */

import type { ErrorResponse } from "../types/api_contract_types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api/v1";
const SESSION_STORAGE_KEY = "margin_client_session_id";

/**
 * Maintain a stable fallback `X-Session-ID` in localStorage in addition to the server's `HttpOnly` cookie
 * so cross-origin local development (`localhost:5173` -> `localhost:8000`) always preserves session scope.
 */
export function getOrCreateClientSessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && existing.length >= 8) {
      return existing;
    }
    const generated = `session_${crypto.randomUUID().replace(/-/g, "")}`;
    window.localStorage.setItem(SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return "default-session";
  }
}

export class MarginApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly requestId: string;

  constructor(params: {
    message: string;
    statusCode: number;
    errorCode: string;
    requestId: string;
  }) {
    super(params.message);
    this.name = "MarginApiError";
    this.statusCode = params.statusCode;
    this.errorCode = params.errorCode;
    this.requestId = params.requestId;
  }
}

const FRIENDLY_ERROR_BY_CODE: Record<string, string> = {
  UNSUPPORTED_DOCUMENT_FORMAT:
    "This file format isn't supported. Please choose a PDF, DOCX, or TXT document.",
  FILE_SIZE_LIMIT_EXCEEDED:
    "This file is larger than the 20 MB limit. Please choose a smaller document.",
  PAGE_LIMIT_EXCEEDED:
    "This document has too many pages. Please upload a document with 150 pages or fewer.",
  SESSION_QUOTA_EXCEEDED:
    "Your library has reached the 25-document limit. Delete an older document to upload a new one.",
  DOCUMENT_NOT_FOUND:
    "We couldn't find that document. It may have been removed from your library.",
  DOCUMENT_NOT_READY:
    "This document is still being prepared for reading. Please try again in a moment.",
  CONVERSATION_NOT_FOUND:
    "We couldn't find that conversation thread. You can start a new one below.",
  INVALID_SELECTION_CONTEXT:
    "Please highlight a passage in the document before asking about a selection.",
  PROVIDER_UNAVAILABLE:
    "The AI assistant is temporarily busy or rate-limited. Please try again in a few seconds.",
  REQUEST_TIMEOUT:
    "That took longer than expected. Please check your connection and try again.",
  NETWORK_UNAVAILABLE:
    "We're having trouble connecting right now. Please try again in a moment.",
  INTERNAL_SERVER_ERROR:
    "Something went wrong on our end. Please try again in a moment.",
};

/**
 * Translate any API or network error into a clear, non-technical message suitable for end users.
 */
export function getUserFriendlyErrorMessage(
  error: unknown,
  fallbackMessage = "Something went wrong. Please try again in a moment.",
): string {
  if (error instanceof MarginApiError) {
    const mapped = FRIENDLY_ERROR_BY_CODE[error.errorCode];
    if (mapped) {
      return mapped;
    }
    if (error.statusCode === 503 || error.statusCode === 429) {
      return "The AI assistant is temporarily busy or rate-limited. Please try again in a few seconds.";
    }
    if (error.statusCode >= 500) {
      return "We're having trouble completing that request right now. Please try again shortly.";
    }
    return error.message || fallbackMessage;
  }
  return fallbackMessage;
}

function isErrorResponsePayload(value: unknown): value is ErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.error_code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.request_id === "string"
  );
}

export function buildApiUrl(path: string, query?: Record<string, string | number | undefined | null>): string {
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  const fullPath = `${API_BASE_URL}${normalisedPath}`;

  if (!query) {
    return fullPath;
  }

  const searchParams = new URLSearchParams();
  for (const [key, val] of Object.entries(query)) {
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      searchParams.set(key, String(val));
    }
  }
  const queryString = searchParams.toString();
  return queryString ? `${fullPath}?${queryString}` : fullPath;
}

export async function requestMarginApi<TResponse>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE" | "PATCH";
    query?: Record<string, string | number | undefined | null>;
    jsonBody?: unknown;
    formData?: FormData;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<TResponse> {
  const {
    method = "GET",
    query,
    jsonBody,
    formData,
    timeoutMs = 45_000,
    signal,
  } = options;

  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const headers = new Headers({
    Accept: "application/json",
    "X-Session-ID": getOrCreateClientSessionId(),
  });

  let body: BodyInit | undefined;
  if (formData) {
    // Do not set Content-Type manually on FormData so the browser attaches the multipart boundary.
    body = formData;
  } else if (jsonBody !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(jsonBody);
  }

  try {
    const response = await fetch(buildApiUrl(path, query), {
      method,
      headers,
      body,
      credentials: "include",
      signal: controller.signal,
    });

    if (response.status === 204) {
      return undefined as TResponse;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const parsedJson: unknown = contentType.includes("application/json")
      ? await response.json()
      : null;

    if (!response.ok) {
      if (isErrorResponsePayload(parsedJson)) {
        throw new MarginApiError({
          message: parsedJson.message,
          statusCode: response.status,
          errorCode: parsedJson.error_code,
          requestId: parsedJson.request_id,
        });
      }
      throw new MarginApiError({
        message: "We couldn't complete that request right now. Please try again.",
        statusCode: response.status,
        errorCode: "HTTP_REQUEST_FAILED",
        requestId: response.headers.get("X-Request-ID") ?? "unknown",
      });
    }

    return parsedJson as TResponse;
  } catch (error: unknown) {
    if (error instanceof MarginApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new MarginApiError({
        message: "That took longer than expected. Please try again.",
        statusCode: 504,
        errorCode: "REQUEST_TIMEOUT",
        requestId: "client-timeout",
      });
    }
    throw new MarginApiError({
      message: "We're having trouble connecting right now. Please try again in a moment.",
      statusCode: 503,
      errorCode: "NETWORK_UNAVAILABLE",
      requestId: "network-error",
    });
  } finally {
    window.clearTimeout(timeoutHandle);
  }
}

