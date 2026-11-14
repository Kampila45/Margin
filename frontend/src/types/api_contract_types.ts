/**
 * Strict TypeScript API contracts and domain union types aligned with Margin's FastAPI `/api/v1` OpenAPI schema.
 */

export const DOCUMENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed",
} as const;

export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

export const DOCUMENT_FORMAT = {
  PDF: "pdf",
  DOCX: "docx",
  TXT: "txt",
} as const;

export type DocumentFormat = (typeof DOCUMENT_FORMAT)[keyof typeof DOCUMENT_FORMAT];

export const CHAT_MODE = {
  DOCUMENT_QA: "document_qa",
  SELECTION_QA: "selection_qa",
} as const;

export type ChatMode = (typeof CHAT_MODE)[keyof typeof CHAT_MODE];

export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

export interface ErrorResponse {
  error_code: string;
  message: string;
  request_id: string;
}

export interface HealthResponse {
  status: string;
  service: string;
}

export interface ReadinessResponse {
  status: string;
  database: string;
  ai_provider: string;
}

export interface DocumentResponse {
  id: string;
  original_filename: string;
  doc_format: DocumentFormat;
  file_size_bytes: number;
  page_count: number | null;
  chunk_count: number;
  status: DocumentStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentListResponse {
  items: DocumentResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface DocumentPageResponse {
  page_number: number;
  text_content: string;
  chunk_count: number;
}

export interface SelectionInput {
  document_id?: string | null;
  selected_text: string;
  page_number?: number | null;
  start_offset?: number | null;
  end_offset?: number | null;
}

export interface CitationResponse {
  citation_index: number;
  chunk_id: string;
  document_id: string;
  document_filename: string;
  chunk_index: number;
  page_number: number | null;
  excerpt: string;
  score: number | null;
}

export interface ChatMessageResponse {
  id: string;
  conversation_id: string;
  role: MessageRole;
  mode: ChatMode;
  content: string;
  selected_text: string | null;
  selected_page_number: number | null;
  insufficient_context: boolean;
  citations: CitationResponse[];
  created_at: string;
}

export interface ChatTurnResponse {
  user_message: ChatMessageResponse;
  assistant_message: ChatMessageResponse;
}

export interface ChatMessageCreateRequest {
  question: string;
  mode: ChatMode;
  document_ids?: string[] | null;
  selection?: SelectionInput | null;
}

export interface ConversationCreateRequest {
  document_id?: string | null;
  document_ids?: string[] | null;
  title?: string | null;
}

export interface ConversationSummaryResponse {
  id: string;
  document_id: string;
  document_ids: string[];
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationListResponse {
  items: ConversationSummaryResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface ConversationDetailResponse {
  id: string;
  document_id: string;
  document_ids: string[];
  title: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessageResponse[];
}

export type DatabaseProvider = "postgresql";

export type SqlChartType = "bar" | "horizontal_bar" | "line";

export interface DatabaseColumnSchema {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  foreign_key_target: string | null;
}

export interface DatabaseTableSchema {
  schema_name: string;
  table_name: string;
  columns: DatabaseColumnSchema[];
}

export interface DatabaseConnectionTestRequest {
  provider?: DatabaseProvider;
  connection_url: string;
}

export interface DatabaseConnectionTestResponse {
  status: string;
  provider: DatabaseProvider;
  masked_connection_url: string;
  table_count: number;
  tables: DatabaseTableSchema[];
}

export interface DatabaseConnectionCreateRequest {
  display_name: string;
  provider?: DatabaseProvider;
  connection_url: string;
}

export interface DatabaseConnectionResponse {
  id: string;
  display_name: string;
  provider: DatabaseProvider;
  masked_connection_url: string;
  table_count: number;
  tables: DatabaseTableSchema[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SqlChartSuggestion {
  chart_type: SqlChartType;
  x_column: string;
  y_column: string;
  title: string;
  vega_lite_spec?: Record<string, unknown> | null;
}

export interface SqlQueryGenerateRequest {
  question: string;
  execute_immediately?: boolean;
  focused_tables?: string[];
}

export interface SqlQueryExecuteRequest {
  sql_query?: string | null;
}

export interface SqlQueryTurnResponse {
  id: string;
  connection_id: string;
  question: string;
  generated_sql: string;
  explanation: string;
  executed: boolean;
  row_count: number;
  execution_time_ms: float_number;
  columns: string[];
  rows: Record<string, unknown>[];
  chart_suggestion: SqlChartSuggestion | null;
  vega_lite_spec?: Record<string, unknown> | null;
  answer_summary: string | null;
  created_at: string;
}

type float_number = number;

export interface SqlWorkspaceStateResponse {
  connections: DatabaseConnectionResponse[];
  active_connection_id: string | null;
  turns: SqlQueryTurnResponse[];
}


