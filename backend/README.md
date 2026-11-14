# Margin Backend

FastAPI modular monolith for **Margin** (*Read deeper. Understand more.*), built with **PydanticAI** (`pydantic-ai-slim[groq,google]`), async **SQLAlchemy**, and **PostgreSQL + pgvector**.

### 1. Agent Orchestration (`app/agents/`) & Ports (`app/ports/`)
- **PydanticAI runtime (`pydantic_model_factory.py`):** Resolves `GrokLLMProvider` (supporting both Groq `gsk_...` via `GroqModel` `openai/gpt-oss-120b` and xAI `grok-2-latest`) and `GeminiLLMProvider` (`GoogleModel`), and wraps `LLMProviderProtocol` test doubles via `FunctionModel`.
- **In-process `RunContext` dependency injection & domain boundaries (`app/ports/`, `app/schemas/`):** Keeps mutable per-turn state (`SqlAgentDeps.execution_state`, `DocumentAgentDeps.retrieved_chunks_store`) and session isolation inside Python memory with bounded `UsageLimits` and timeouts (`AgentExecutionBudget`), separated cleanly behind Protocol interfaces and strict Pydantic v2 contracts.

### 2. Document Intelligence & Agentic RAG (`app/rag/`)
- Document upload validation (`PDF`, `DOCX`, `TXT`), extraction, and idempotent SHA-256 ingestion
- Overlapping text chunking with preserved page/section boundaries
- Vector embedding storage (`gemini-embedding-001`, 768d) and semantic vector search via PostgreSQL + `pgvector` HNSW cosine distance
- **Multi-hop PydanticAI Document Agent (`DocumentAgentService`):** Uses `RunContext[DocumentAgentDeps]` tools (`search_document_passages`, `read_document_page`, `list_workspace_documents`, `get_document_metadata`) for multi-step retrieval and page-level table inspection
- Grounded RAG question answering for **Document Chat** (single and multi-document scope in Active Reader, `document_qa`) and **Reader Selection Mode** (`selection_qa`)
- Provider citation normalization (`normalize_citation_markers` in `app/rag/citation_verifier.py`), verifiable citation mapping (`extract_verified_citations`) to exact page coordinates, follow-up prefix hygiene (`strip_followup_label_prefixes` in `app/core/answer_formatting.py`), explicit `insufficient_context` detection, and prompt-injection isolation (`<document_source>`, `<retrieved_sources>`, `<selected_passage>`)

### 3. Natural Language SQL Assistant (`app/sql/`)
- External PostgreSQL database connections with authenticated symmetric encryption (`PBKDF2-HMAC-SHA256`, 100,000 iterations)
- SSRF destination protection with offloaded async DNS (`asyncio.to_thread`) and post-connect peer verification (`_verify_connected_peer_is_public`), blocking loopback, private RFC-1918 networks, link-local / cloud metadata endpoints, and IPv6-mapped private targets
- Strict read-only SQL validation (`validate_readonly_select_sql`) enforcing single `SELECT` / `WITH ... SELECT` statements (blocking DDL/DML)
- External schema discovery for public tables, columns, data types, primary keys, and foreign keys
- **Autonomous PydanticAI SQL Agent (`SqlAgentService`):** Uses `RunContext[SqlAgentDeps]` tools (`inspect_table_schema`, `execute_sql_query`) with case-insensitive PostgreSQL identifier normalization (`normalize_sql_identifier_casing`), recoverable SQL self-correction, and verified **Vega-Lite v5** chart suggestions (`ChartSpecificationService`)
- Safe query execution enforcing `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, statement timeout (`SET LOCAL statement_timeout`), and row caps (`result.fetchmany`)

### 4. Pluggable Document Storage (`app/storage/`)
- `LocalFileStorage` (path-traversal-safe local disk) or `S3FileStorage` (AWS S3, Cloudflare R2, MinIO via `boto3` + `s3v4` signing) selected by `STORAGE_PROVIDER=local|s3`

## Local Commands

```bash
# Run linter and type-checker checks
.venv/bin/ruff check .
.venv/bin/mypy app

# Run automated unit and integration tests
.venv/bin/pytest

# Run database migrations
.venv/bin/alembic upgrade head

# Start development server
.venv/bin/uvicorn app.main:app --reload --port 8000
```
