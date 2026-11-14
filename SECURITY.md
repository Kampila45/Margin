# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x / 1.0.x | ✅ Yes |

Only the latest release receives security updates.

---

## Security & Privacy Model

Margin is a hosted web application powered by **Groq / xAI Grok** or **Google Gemini** (`gemini-embedding-001` for 768d embeddings) and backed by **PostgreSQL + `pgvector`**:

- Documents and queries are processed by the Margin backend and sent to the configured AI provider API using strictly server-side credentials.
- Session isolation via an `HttpOnly` `margin_session_id` cookie (with `X-Session-ID` header support for API/test clients) scopes all documents, extracted chunks, embeddings, database connections, and conversations so one session can never view, query, or delete another session's data.
- Configurable file-size limits (`MAX_UPLOAD_SIZE_BYTES`, default 20 MB), page limits (`MAX_PAGES_PER_DOCUMENT`, default 150), and per-session document quotas (`MAX_DOCUMENTS_PER_SESSION`, default 25) protect the service.
- Users can delete their uploaded documents at any time, which removes the stored file, extracted chunks, and vector embeddings together.

---

## Known Attack Surface & Built-in Mitigations

Margin processes user-uploaded files and renders model-generated responses in the browser. Its security controls focus on the following areas:

- **Untrusted Document Uploads:**
  - Only explicitly supported formats (`PDF`, `DOCX`, and `TXT`) are accepted; executable and macro-enabled formats are rejected.
  - The backend validates file extensions, declared MIME types, and file signatures (magic bytes), and enforces strict file-size and page-count limits.
  - Uploaded files are stored under server-generated opaque filenames; user-supplied filenames are stored strictly as metadata to prevent path traversal and arbitrary file writes.
- **Prompt Injection via Document Content:**
  - Extracted document passages and user-selected text are delimited with `<document_source>`, `<retrieved_sources>`, and `<selected_passage>` tags and treated strictly as untrusted data, never executable instructions.
  - System prompts, citation rules, provider settings, and session access controls cannot be overridden by instructions embedded inside uploaded documents.
- **Session & Resource Isolation:**
  - Every database and vector query is scoped to the current session/owner context on the backend. Client-supplied `document_id` or `conversation_id` parameters are never trusted without backend ownership verification.
  - Deleting a document removes the stored file, extracted text chunks, and vector embeddings together.
- **Secret & Log Hygiene:**
  - AI provider credentials, database URLs, and session secrets live exclusively in server-side environment variables and are never exposed via `VITE_` frontend variables or API responses.
  - Application logs record operational metadata and correlation IDs only — never raw document contents, prompts, selected passages, or API keys.
  - Centralised exception handlers ensure stack traces, raw database errors, and internal filesystem paths are never returned to clients.
- **Safe Output Rendering & Browser Security:**
  - Assistant responses are rendered via structured React JSX components in `FormattedAssistantAnswer` (no `dangerouslySetInnerHTML` or trusted raw HTML injection).
  - CORS is restricted to explicitly configured frontend origins.
- **External Database Credentials & Cryptography Architecture:**
  - External PostgreSQL connection URLs are encrypted symmetrically before persistence in `database_connections` using an authenticated encrypt-then-MAC construction (`PBKDF2-HMAC-SHA256` with 100,000 iterations, a 16-byte cryptographically secure random salt, a 16-byte nonce, counter-mode keystream, and constant-time `hmac.compare_digest` MAC verification).
  - Credentials are never exposed to AI models or client API responses; endpoints only return `masked_connection_url` with redacted user and password components.
- **SSRF Protection & Read-Only SQL Guardrails:**
  - Target database hosts are validated via offloaded async DNS resolution (`asyncio.to_thread`) and post-connect peer IP verification (`_verify_connected_peer_is_public`), unwrapping IPv6-mapped IPv4 addresses and strictly blocking loopback (`127.0.0.0/8`), private RFC-1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local / cloud metadata (`169.254.169.254`), multicast, and reserved ranges unless `SQL_ALLOW_PRIVATE_HOSTS=true` is explicitly enabled.
  - User and generated SQL queries are validated via lexical keyword and statement boundary analysis enforcing single `SELECT` / `WITH ... SELECT` queries; modifying statements (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `EXEC`) and multi-statement batches are blocked.
  - Target database sessions enforce transactional read-only mode (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`), a 5-second statement timeout (`SET LOCAL statement_timeout`), and a hard 100-row limit (`result.fetchmany`).
- **Supply-Chain & Dependency Security (npm Policy):**
  - Project-level `.npmrc` enforces `min-release-age=30` (requiring npm 11.10.0+ so only package versions published at least 30 days ago are resolved) and `save-exact=true` (strict exact version pinning with no `^` or `~` ranges).
  - Both `package.json` and `package-lock.json` are committed to Git and audited via `npm audit` and `npm audit signatures`.
  - Automated CI installations use `npm ci --ignore-scripts` where possible to prevent arbitrary lifecycle script execution.

---

## Reporting a Vulnerability

If you discover a security vulnerability in Margin, please report it responsibly:

1. **Do not open a public GitHub issue** for security vulnerabilities.
2. Open a [GitHub Security Advisory](https://github.com/Kampila45/Margin/security/advisories/new) using the private reporting feature.
3. Include a clear description of the vulnerability, steps to reproduce it, affected components (`frontend`, `backend`, `rag`, `storage`), and the potential impact.

Reported vulnerabilities will be reviewed and acknowledged within **7 days**. A fix will be targeted within **30 days** for confirmed issues, or a remediation timeline will be communicated if a fix requires additional time.
