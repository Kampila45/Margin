# Margin — REST API Reference (`/api/v1`)

All endpoints are prefixed with `/api/v1`. FastAPI automatically serves interactive OpenAPI documentation at `/docs` and `/openapi.json`, which acts as the single source of truth for frontend TypeScript contracts.

## Session Scoping

Every request to `/api/v1/documents`, `/api/v1/conversations`, and `/api/v1/sql` is scoped to the current session via the `HttpOnly` `margin_session_id` cookie (used by browser clients) or the optional `X-Session-ID` header (used by API and automated test clients). One session cannot list, read, query, or delete another session's resources.

---

## Health & Readiness

### `GET /api/v1/health`
Returns basic liveness status of the API process.

```json
{
  "status": "ok",
  "service": "margin-api"
}
```

### `GET /api/v1/ready` (also `GET /api/v1/health/ready`)
Checks database connectivity and configured AI provider (Groq / xAI Grok / Google Gemini) readiness.

```json
{
  "status": "ready",
  "database": "ok",
  "ai_provider": "configured"
}
```

---

## Documents

### `POST /api/v1/documents`
Uploads a supported document (`PDF`, `DOCX`, or `TXT`) as `multipart/form-data` (`file` field). Validates file extension, MIME type, magic-byte file signature, and size limits, then extracts, chunks, and indexes the document.

- **Status:** `201 Created`

```json
{
  "id": "8f14e45f-ceea-467f-a8f1-4e45fceea67f",
  "original_filename": "service-agreement.pdf",
  "doc_format": "pdf",
  "file_size_bytes": 184320,
  "page_count": 12,
  "chunk_count": 28,
  "status": "ready",
  "error_message": null,
  "created_at": "2026-11-10T12:00:00Z",
  "updated_at": "2026-11-10T12:00:02Z"
}
```

### `GET /api/v1/documents`
Lists documents belonging to the current session. Supports optional query parameters:
- `format` (`pdf` | `docx` | `txt`)
- `status` (`pending` | `processing` | `ready` | `failed`)
- `search` (case-insensitive filename substring)
- `limit` (default `50`, max `100`) and `offset` (default `0`)

### `GET /api/v1/documents/{document_id}`
Returns metadata and current processing status (`pending`, `processing`, `ready`, `failed`) for a single document.

### `GET /api/v1/documents/{document_id}/file`
Streams the raw uploaded document file (`Content-Disposition: inline`) for rendering in the PDF.js / document reader.

### `GET /api/v1/documents/{document_id}/pages/{page_number}`
Returns the extracted text and chunk count for a specific 1-based page/section of a document.

### `DELETE /api/v1/documents/{document_id}`
Deletes a document along with its stored file, extracted chunks, conversations, and `pgvector` embeddings.

- **Status:** `204 No Content`

---

## Conversations & Contextual QA

### `POST /api/v1/conversations`
Creates a new conversation scoped to a single `document_id` and/or a multi-document list (`document_ids`) in the current session. Uses strict schema validation (`extra="forbid"`).

```json
{
  "document_id": "8f14e45f-ceea-467f-a8f1-4e45fceea67f",
  "document_ids": [
    "8f14e45f-ceea-467f-a8f1-4e45fceea67f"
  ],
  "title": "Contract termination review"
}
```

### `GET /api/v1/conversations`
Lists conversations in the current session (supports optional `document_id`, `limit`, and `offset` query parameters).

### `GET /api/v1/conversations/{conversation_id}`
Returns conversation metadata and ordered message history (including verified citations and `insufficient_context` flags).

### `POST /api/v1/conversations/{conversation_id}/messages`
Submits a question in either **whole-document mode** (`mode: "document_qa"`, optionally scoped via `document_ids`) or **reader selection mode** (`mode: "selection_qa"`). Supports optional `document_id`, `start_offset`, and `end_offset` fields inside `selection`.

#### Request Body (Selection Mode)

```json
{
  "question": "What does this clause mean?",
  "mode": "selection_qa",
  "document_ids": [
    "8f14e45f-ceea-467f-a8f1-4e45fceea67f"
  ],
  "selection": {
    "document_id": "8f14e45f-ceea-467f-a8f1-4e45fceea67f",
    "selected_text": "Either party may terminate this agreement upon 30 days written notice.",
    "page_number": 4,
    "start_offset": 0,
    "end_offset": 72
  }
}
```

#### Response Body (`201 Created`)

```json
{
  "user_message": {
    "id": "b19f7044-8a1e-4b3b-99d1-019f70448a1e",
    "conversation_id": "a08e6033-790d-4a2a-88c0-908e6033790d",
    "role": "user",
    "mode": "selection_qa",
    "content": "What does this clause mean?",
    "selected_text": "Either party may terminate this agreement upon 30 days written notice.",
    "selected_page_number": 4,
    "insufficient_context": false,
    "citations": [],
    "created_at": "2026-11-10T12:05:00Z"
  },
  "assistant_message": {
    "id": "c28e8155-9b2f-4c4c-88e2-128e81559b2f",
    "conversation_id": "a08e6033-790d-4a2a-88c0-908e6033790d",
    "role": "assistant",
    "mode": "selection_qa",
    "content": "This clause allows either party to end the contract early provided they give the other party written notice at least 30 days in advance [1].",
    "selected_text": "Either party may terminate this agreement upon 30 days written notice.",
    "selected_page_number": 4,
    "insufficient_context": false,
    "citations": [
      {
        "citation_index": 1,
        "chunk_id": "d37f9266-ac30-4d5d-77f3-237f9266ac30",
        "document_id": "8f14e45f-ceea-467f-a8f1-4e45fceea67f",
        "document_filename": "service-agreement.pdf",
        "chunk_index": 7,
        "page_number": 4,
        "excerpt": "Either party may terminate this agreement upon 30 days written notice...",
        "score": 1.0
      }
    ],
    "created_at": "2026-11-10T12:05:01Z"
  }
}
```

### `DELETE /api/v1/conversations/{conversation_id}`
Deletes a conversation and its message history.

- **Status:** `204 No Content`

---

## Natural Language SQL Assistant

### `POST /api/v1/sql/connections/test`
Validates external database connectivity in read-only mode and discovers public schema tables and columns. Scoped to the session.

- **Status:** `200 OK`

### `POST /api/v1/sql/connections`
Saves an encrypted external database connection for the current session.

- **Status:** `201 Created`

### `GET /api/v1/sql/workspace`
Returns all saved database connections, active connection schema, and recent query turns for the session.

- **Status:** `200 OK`

### `POST /api/v1/sql/connections/{connection_id}/activate`
Switches the active database connection for the session.

- **Status:** `200 OK`

### `DELETE /api/v1/sql/connections/{connection_id}`
Removes a saved external database connection and its encrypted credentials.

- **Status:** `204 No Content`

### `POST /api/v1/sql/connections/{connection_id}/generate`
Translates a natural language question into a safe read-only SQL `SELECT` query grounded in discovered schema. Accepts `question`, `execute_immediately` (default `false`), and optional `focused_tables` (up to 20 table names). Uses strict schema validation (`extra="forbid"`).

- **Status:** `201 Created`

### `POST /api/v1/sql/connections/{connection_id}/turns/{turn_id}/execute`
Validates and executes a generated or user-edited read-only SQL query with a 5-second statement timeout and 100-row limit, returning tabular rows and `chart_suggestion` containing a **Vega-Lite v5** `vega_lite_spec` (in a strict `SqlQueryTurnResponse` envelope with `extra="forbid"`).

- **Status:** `200 OK`

---

## Error Response Contract

All expected and unexpected errors return a consistent JSON structure and never expose stack traces or database internals:

```json
{
  "error_code": "INVALID_SELECTION_CONTEXT",
  "message": "Selection Q&A mode requires a non-empty highlighted passage.",
  "request_id": "7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c"
}
```
