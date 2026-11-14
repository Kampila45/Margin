# Contributing to Margin

Thank you for your interest in contributing to **Margin**. Please read this guide thoroughly before opening a pull request.

---

## Development Setup

### Prerequisites

- [Node.js 20+](https://nodejs.org)
- [Python 3.11+](https://www.python.org)
- [PostgreSQL 16+](https://www.postgresql.org) with [`pgvector`](https://github.com/pgvector/pgvector) (or Docker & Docker Compose)
- A Google Gemini API key (required for 768d embeddings, and optionally for generation) and optionally a Groq (`gsk_...`) or xAI Grok API key for `LLM_PROVIDER=grok`

### Running Locally

```bash
# 1. Start PostgreSQL + pgvector
docker compose up -d db

# 2. Backend (in one terminal)
cd backend
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000

# 3. Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
```

*(If you use [`uv`](https://docs.astral.sh/uv/), you can also run `uv pip install -e ".[dev]"` inside `.venv`; no `uv.lock` file is used.)*

---

## Architecture

Margin is a **modular monolith** with strict boundaries between HTTP presentation, application workflows, domain contracts, and infrastructure adapters.

```text
backend/app/
├── api/routes/   # Thin FastAPI endpoints (/api/v1) — validate input, call service, return schema
├── core/         # Typed settings (pydantic-settings), DI wiring, structured logging, error handlers, formatting
├── agents/       # PydanticAI model factory, execution budgets, and in-process agent runner
├── ports/        # Domain Protocol interfaces decoupling services from AI/storage adapters
├── documents/    # Upload validation, text extraction, document lifecycle service
├── chat/         # Conversation and message workflows (document_qa & selection_qa modes)
├── rag/          # Normalisation, chunking, scoped vector retrieval, DocumentAgentService, citations
├── sql/          # External DB encryption, SSRF/DNS protection, read-only SQL validator, SqlAgentService
├── ai/           # Pluggable LLM & embedding adapters (Groq, xAI Grok, Google Gemini) behind Protocols
├── storage/      # File storage abstraction (LocalFileStorage & S3FileStorage for S3/R2/MinIO)
├── database/     # SQLAlchemy models, pgvector indexes, Alembic migrations
└── schemas/      # Pydantic request/response contracts
```

The frontend is organised by feature:

```text
frontend/src/
├── features/
│   ├── documents/   # Document upload, status polling, library list & deletion
│   ├── onboarding/  # Interactive app tour & first-run workspace guidance
│   ├── reader/      # PDF.js document viewer (8-page LRU cache), page navigation, floating selection toolbar
│   ├── chat/        # Shared MarginChatPanel & selection chat UI, citation badges, mode switching
│   ├── sql/         # Database connect modal, schema explorer, SQL assistant & Vega-Lite v5 charts
│   └── workspace/   # Dual-mode intelligence home dashboard
├── components/      # Shared accessible UI primitives (ui/ and shared/)
├── services/        # Single configured API client
├── stores/          # Zustand stores for shared client UI state
├── styles/          # Global stylesheet and design tokens
├── types/           # Shared TypeScript API and domain types
├── __tests__/       # Vitest & React Testing Library component/feature test suites
└── app/             # Root application shell and providers
```

---

## Coding Principles

### General
- **Comments explain *why*, not *what*:** Document intent, invariants, and trade-offs. Use clear names for the *what*.
- **Keep code simple and readable:** Prefer explicit, linear code over clever abstractions, magic base classes, or premature generalisation.
- **Domain-descriptive filenames (no generic module names):** Never name files `service.py`, `models.py`, `utils.py`, `helpers.py`, `common.py`, `base.py`, `protocol.py`, or `config.py`. Every file must have a self-describing domain name (e.g., `document_ingestion_service.py`, `contextual_qa_service.py`, `passage_chunker.py`, `orm_entities.py`).
- **Enums over magic strings:** Use Python `StrEnum`/`Enum` and TypeScript union types / `as const` objects for closed sets (`pending`/`processing`/`ready`/`failed`, `document_qa`/`selection_qa`, `pdf`/`docx`/`txt`), colocated with the owning model or schema.

### Backend (Python / FastAPI)
- Add type hints to all public functions, service methods, and data structures.
- Keep route handlers thin; put business logic in application/service modules (`documents`, `chat`, `rag`, `sql`).
- Domain logic must not import FastAPI, SQLAlchemy, or AI provider SDKs directly; program to `app/ports/` Protocols, keep provider SDK/API code inside `backend/app/ai/`, and keep PydanticAI model wiring inside `backend/app/agents/`.
- Use `async def` only for genuine async I/O; do not block the event loop with CPU-bound extraction or parsing.
- Enforce session/owner scoping on every document and conversation query.
- Use structured logging with correlation IDs — never use `print()`, and **never** log document text, user prompts, selected passages, API keys, or secrets.
- Create or update Alembic migrations whenever database models change.

### Frontend (TypeScript / React)
- Enable TypeScript strict mode; avoid `any` (use `unknown` and narrow at untrusted boundaries).
- Manage server state (fetching, polling, mutations, cache invalidation) with **TanStack Query**.
- Use **Zustand** only for genuine shared client UI state (active document, reader page, active selection). Do not duplicate server data in Zustand.
- Keep **PDF.js** rendering inside `src/features/reader/` and preserve native text selection and copying.
- Handle loading, empty, success, and error states for every asynchronous flow, and maintain keyboard navigation and accessible focus states.
- **npm Supply-Chain Policy:** Keep `min-release-age=30` and `save-exact=true` in `.npmrc` (requires npm 11.10.0+). Pin exact dependency versions in `frontend/package.json` (never use `^` or `~`), commit `frontend/package-lock.json`, and run `npm audit` and `npm audit signatures` whenever dependencies change. Prefer `npm ci --ignore-scripts` in CI environments.

---

## Testing Requirements

Every feature or bug fix must include appropriate automated tests using small, synthetic sample documents (never commit private or copyrighted documents):

- **Backend (`pytest`):** Unit tests for chunking, text normalisation, citation marker normalisation and mapping, bounded prompt construction, SSRF/SQL guardrails, and mocked provider adapters (`FunctionModel` / Protocol doubles); integration tests for upload validation, processing states, session isolation, cascade deletion, `document_qa` vs `selection_qa` chat modes, and `insufficient_context` handling.
- **Frontend (`vitest` + React Testing Library):** Tests for upload/processing states, document list/delete flows, reader page navigation, text selection toolbar actions, selection context payloads, citation navigation, and keyboard accessibility.

---

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-description>` | `feat/selection-toolbar` |
| Bug fix | `fix/<short-description>` | `fix/pdf-page-citation-offset` |
| Chore / CI | `chore/<short-description>` | `chore/alembic-initial-migration` |
| Documentation | `docs/<short-description>` | `docs/api-reference` |

---

## Pull Request Expectations

- Keep pull requests focused on a single concern. Avoid mixing unrelated refactoring with feature work.
- All backend checks must pass: `.venv/bin/ruff check .`, `.venv/bin/mypy app`, and `.venv/bin/pytest`.
- All frontend checks must pass: `npm run typecheck`, `npm test`, and `npm run build`.
- Keep frontend and backend API schemas aligned, and update `.env.example` whenever configuration settings change.
- Never commit `.env` files, API keys, local databases, uploaded documents, model weights, build artifacts, or virtual environments.

---

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org) format:

```text
feat(reader): add floating toolbar for highlighted PDF text
feat(rag): prioritise selected passage and retrieve surrounding chunks
fix(documents): remove stored embeddings when document is deleted
docs(readme): document environment configuration and API setup
```
