# Margin

> **Read deeper. Understand more.**

An AI intelligence workspace combining **Document Intelligence** (deep reading, margin annotations, multi-hop grounded citations) and a **Natural Language SQL Assistant** (external PostgreSQL querying, schema indexing, self-correcting SQL generation, and automated charts) — built as a monorepo with a **React + TypeScript** frontend, a **Python + FastAPI** backend orchestrated with **PydanticAI**, and **PostgreSQL + pgvector** for grounded retrieval.

Margin provides two primary ways to explore and understand information:

1. **Document Intelligence:** Ingest PDF, DOCX, and TXT files. Read in the resizable **Active Reader**, highlight passages in the margins to ask contextual questions, or add multiple indexed documents to the reader's chat scope for cross-document Q&A with verified page citations.
2. **SQL Data Assistant:** Connect external PostgreSQL database replicas via encrypted connections. Ask questions in natural language—the PydanticAI SQL agent inspects table relationships, normalizes identifier casing, runs read-only queries, self-corrects syntax/casing errors, and presents plain-English answers alongside automated Vega-Lite charts.

---

## Demo

> Walkthrough covering PDF upload & indexing, grounded Q&A with page-level citation jumps & text highlighting, live read-only PostgreSQL connection, natural-language SQL querying with Vega-Lite chart generation, and connection disconnect.

https://github.com/user-attachments/assets/ec623d22-9a86-42ca-bfd4-cf0bcd0b4db8

---

## Features

### Document Intelligence & Agentic RAG
- **Multi-format document ingestion** — Upload, view, manage, and delete **PDF**, **DOCX**, and **TXT** documents with page and location boundary preservation.
- **Interactive PDF.js reader** — Read documents with native text selection, CSS-scaled zoom with an 8-page LRU rendered-page cache and idle adjacent-page prefetch, fast citation jumps, and a floating contextual toolbar (**Ask AI**, **Explain**, **Summarise**, **Simplify**) positioned directly at highlighted text.
- **Multi-hop PydanticAI Document Agent** — Uses `RunContext` tools (`search_document_passages`, `read_document_page`, `list_workspace_documents`, `get_document_metadata`) to run follow-up searches and inspect full pages/tables when initial vector retrieval isn't enough.
- **Selection-aware RAG** — Prioritises highlighted passages while retrieving surrounding chunks to resolve ambiguous references like *"this clause"* or *"the previous section"*.
- **Grounded answers & navigable citations** — Answers are grounded strictly in `<document_source>` passages, with provider-specific citation markers normalized via `normalize_citation_markers` and verified by `extract_verified_citations` for clickable page navigation and text highlighting, plus `strip_followup_label_prefixes` for clean follow-up prompts.
- **Honest insufficient-context detection** — Explicitly alerts when documents lack evidence rather than hallucinating answers.

### Natural Language SQL Assistant
- **External PostgreSQL connection studio** — Connect external PostgreSQL database replicas via Connection URL (URI, with client-assisted host/credential builder) with authenticated symmetric encryption (PBKDF2-HMAC-SHA256, 100,000 iterations).
- **Autonomous PydanticAI SQL Agent** — Uses `inspect_table_schema` (columns, types, PKs, and FKs) and `execute_sql_query` with automatic PostgreSQL identifier casing normalization (e.g. `public."Customers"`) and bounded self-correction on recoverable database errors.
- **Conversational chatbot UX** — Uses the shared `MarginChatPanel` component (`Ask Margin...` composer) across Active Reader and SQL Assistant, responding in plain English alongside inline **Vega-Lite v5** charts without exposing raw SQL or extra table toggles.
- **Strict read-only enforcement** — Validates generated queries with strict lexical keyword and statement boundary inspection enforcing single `SELECT` / `WITH ... SELECT` queries inside read-only transactions (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`); DDL and DML (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `EXEC`) are rejected.
- **SSRF protection** — Validates destination hosts via offloaded async DNS (`asyncio.to_thread`) and post-connect peer verification (`_verify_connected_peer_is_public`), strictly blocking loopback, RFC-1918 private subnets, and cloud metadata endpoints (`169.254.169.254`).
- **Minimal typing bubble** — Displays a clean bouncing-dots typing indicator (`ChatThinkingBubble`) while responses are generating.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS (Margin Indigo `#4143d5` theme) |
| Server State | TanStack Query |
| Client UI State | Zustand |
| PDF Rendering | PDF.js |
| Data Visualisation | Vega-Lite v5 (code-split, Margin Indigo palette) |
| Backend API | Python 3.11+ + FastAPI (`/api/v1`) |
| Agent Orchestration | PydanticAI (`pydantic-ai-slim[groq,google]`, `RunContext` dependency injection) |
| ORM & Migrations | SQLAlchemy (async) + Alembic |
| Database & Vector Store | PostgreSQL + `pgvector` |
| AI Generation | Groq (`openai/gpt-oss-120b` via LPU) / Google Gemini / xAI Grok |
| Vector Embeddings | Google Gemini (`gemini-embedding-001`, 768d) |
| File Storage | Local Disk (`LocalFileStorage`) or S3-compatible (`S3FileStorage`: AWS S3, Cloudflare R2, MinIO via `boto3`) |
| Architecture | Modular Monolith (Monorepo) |

---

## Repository Structure

```text
Margin/
├── frontend/
│   ├── src/
│   │   ├── app/                # Root shell, router, query client
│   │   ├── components/         # Shared UI primitives (MarginChatPanel, ChatThinkingBubble, FormattedAssistantAnswer, etc.)
│   │   ├── features/
│   │   │   ├── documents/      # Upload, polling, library management
│   │   │   ├── reader/         # PDF.js viewer, page cache, zoom, selection toolbar
│   │   │   ├── chat/           # Document chat, selection context, citation links
│   │   │   ├── sql/            # Connect modal, schema explorer, SQL chatbot & Vega-Lite charts
│   │   │   ├── onboarding/     # Interactive product tour, guide modal, checklist
│   │   │   └── workspace/      # Dual-mode intelligence dashboard
│   │   ├── services/           # Typed API clients (documents, conversations, SQL, HTTP)
│   │   ├── stores/             # Zustand stores for client UI state
│   │   ├── styles/             # Tailwind theme tokens & PDF selection styles
│   │   ├── types/              # TypeScript API contract definitions
│   │   ├── __tests__/          # Vitest + React Testing Library integration tests
│   │   └── main.tsx
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── agents/             # PydanticAI model factory (Groq/xAI/Gemini/FunctionModel) & budgets
│   │   ├── api/routes/         # Thin FastAPI route handlers (/api/v1)
│   │   ├── core/               # Settings, DI container, answer formatting, logging, exception handlers
│   │   ├── documents/          # Upload validation, extraction, document service
│   │   ├── chat/               # Conversation and message orchestration
│   │   ├── ports/              # Abstract domain Protocols (AI, extractors, storage)
│   │   ├── rag/                # DocumentAgentService, RunContext RAG tools, chunker, citations
│   │   ├── schemas/            # Pydantic request/response contracts & envelopes
│   │   ├── sql/                # SqlAgentService, RunContext SQL tools, security, ChartSpecificationService
│   │   ├── ai/                 # GrokLLMProvider, GeminiLLMProvider, GeminiEmbeddingProvider
│   │   ├── storage/            # File storage abstraction (LocalFileStorage & S3FileStorage for S3/R2/MinIO)
│   │   ├── database/           # SQLAlchemy models, repositories, sessions, Alembic migrations
│   │   └── main.py
│   ├── tests/                  # Pytest suite (agents, model factory, formatting, documents, RAG, citations, SQL)
│   └── pyproject.toml
├── docs/                       # Architecture & REST API reference
├── .env.example
├── docker-compose.yml
└── README.md
```

---

## Local Development

### Prerequisites

- [Node.js 20+](https://nodejs.org)
- [Python 3.11+](https://www.python.org) and virtual environment
- [PostgreSQL 16+](https://www.postgresql.org) with [`pgvector`](https://github.com/pgvector/pgvector)
- A **Google Gemini API key** (`GEMINI_API_KEY`, required for embeddings and optional generation) and/or a **Groq / xAI Grok API key** (`XAI_API_KEY`, with `GROK_API_KEY` / `GROQ_API_KEY` aliases also accepted; auto-detects `gsk_...` Groq keys when `LLM_PROVIDER=grok`)

### 1. Environment Configuration

Copy `.env.example` to `.env` in the repository root and configure your database and API keys:

```bash
cp .env.example .env
```

### 2. Start PostgreSQL + pgvector (via Docker Compose)

```bash
docker compose up -d db
```

### 3. Run the Backend

```bash
cd backend

# Install dependencies into virtual environment
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Run database migrations
alembic upgrade head

# Start development server
uvicorn app.main:app --reload --port 8000
```

Interactive OpenAPI documentation is available at `http://localhost:8000/docs`.

### 4. Run the Frontend

```bash
cd frontend
npm install
npm run dev
```

### Quality & Tests

**Backend:**
```bash
cd backend
.venv/bin/ruff check .
.venv/bin/mypy app
.venv/bin/pytest
```

**Frontend:**
```bash
cd frontend
npm run typecheck
npm test
npm run build
```

---

## API Overview

All API routes are prefixed with `/api/v1`:

### Document Intelligence & RAG
```text
POST   /api/v1/documents
GET    /api/v1/documents
GET    /api/v1/documents/{document_id}
GET    /api/v1/documents/{document_id}/file
GET    /api/v1/documents/{document_id}/pages/{page_number}
DELETE /api/v1/documents/{document_id}

POST   /api/v1/conversations
GET    /api/v1/conversations
GET    /api/v1/conversations/{conversation_id}
POST   /api/v1/conversations/{conversation_id}/messages
DELETE /api/v1/conversations/{conversation_id}
```

### Natural Language SQL Assistant
```text
POST   /api/v1/sql/connections/test
POST   /api/v1/sql/connections
GET    /api/v1/sql/workspace
POST   /api/v1/sql/connections/{connection_id}/activate
DELETE /api/v1/sql/connections/{connection_id}
POST   /api/v1/sql/connections/{connection_id}/generate
POST   /api/v1/sql/connections/{connection_id}/turns/{turn_id}/execute
```

### System Health
```text
GET    /api/v1/health
GET    /api/v1/ready
GET    /api/v1/health/ready
```

---

## Security Model

1. **Zero Credential Exposure:** External database passwords are encrypted symmetrically with authenticated PBKDF2-HMAC-SHA256 (100,000 iterations + constant-time HMAC verification) and are never sent to AI models or tool outputs.
2. **SSRF Hardening:** Arbitrary host targets are resolved off the event loop (`asyncio.to_thread`), blocked against loopback (`127.0.0.0/8`), private RFC-1918 networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local / cloud metadata (`169.254.169.254`), multicast, and reserved ranges (including IPv6-mapped IPv4 unwrapping), and re-checked against the connected socket peer IP (`_verify_connected_peer_is_public`).
3. **Strict Read-Only Enforcement:** Queries are validated via lexical keyword and statement boundary inspection enforcing single read-only `SELECT` / `WITH ... SELECT` statements (`validate_readonly_select_sql`). All mutation statements (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `EXEC`) and multi-statement batches are rejected before execution. In addition, external connections enforce transactional read-only mode (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`).
4. **Session & Document Isolation:** Every document search, page inspection, and SQL connection query enforces strict `owner_session_id` boundaries inside `RunContext` dependencies.
5. **Statement Guardrails:** External queries execute with a configurable statement timeout (default 5s) and hard row limit (default 100 rows).

---

## License

MIT
