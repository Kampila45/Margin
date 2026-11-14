"""Unit and integration tests for Margin SQL Assistant, credential encryption, and SSRF defense."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.app_settings import AppEnvironment, Settings
from app.core.dependency_container import get_embedding_provider, get_llm_provider
from app.core.domain_exceptions import MarginError
from app.database.db_engine import Base, create_engine_from_url, create_session_factory
from app.main import create_app
from app.ports.ai_provider_ports import EmbeddingProviderProtocol, LLMProviderProtocol
from app.schemas.sql_contracts import SqlChartType
from app.sql.sql_engine_service import (
    decrypt_connection_url,
    detect_chart_suggestion,
    encrypt_connection_url,
    execute_readonly_sql_query,
    mask_connection_url,
    validate_and_normalize_external_db_url,
    validate_readonly_select_sql,
)


class FakeEmbeddingProvider(EmbeddingProviderProtocol):
    """Deterministic in-memory embedding double."""

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.1] * 8 for _ in texts]

    async def embed_query(self, query: str) -> list[float]:
        return [0.1] * 8


class FakeSqlLLMProvider(LLMProviderProtocol):
    """Deterministic LLM double generating SQL queries and natural-language summaries."""

    async def generate_grounded_answer(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
    ) -> str:
        if "data analyst" in system_instruction.lower():
            if "total revenue" in user_prompt.lower() or "sales" in user_prompt.lower():
                return (
                    '{"sql": "SELECT category, SUM(amount) AS total_revenue FROM orders '
                    'GROUP BY category ORDER BY total_revenue DESC LIMIT 10", '
                    '"explanation": "Aggregates total sales revenue by category."}'
                )
            return (
                '{"sql": "SELECT id, name, price FROM products ORDER BY price DESC LIMIT 5", '
                '"explanation": "Lists the top products by price."}'
            )
        return "Top category is **Electronics** with **$45,000** in total revenue."


@pytest.fixture
def secret_key() -> str:
    return "test-secret-encryption-key-32-chars-long!"


def test_credential_encryption_and_decryption_roundtrip(secret_key: str) -> None:
    """Verify credentials are encrypted into opaque tokens and decrypted without corruption."""
    raw_url = "postgresql://sales_reader:SuperSecretPassword123!@db.neon.tech:5432/production_db"
    token = encrypt_connection_url(raw_url, secret=secret_key)
    assert token != raw_url
    assert "SuperSecretPassword123!" not in token

    decrypted = decrypt_connection_url(token, secret=secret_key)
    assert decrypted == raw_url


def test_credential_decryption_fails_on_tampering(secret_key: str) -> None:
    """Ensure tampered ciphertext fails HMAC integrity verification with MarginError."""
    raw_url = "postgresql://user:pass@host:5432/db"
    token = encrypt_connection_url(raw_url, secret=secret_key)
    tampered_bytes = bytearray(token.encode("ascii"))
    tampered_bytes[-1] ^= 0x01
    tampered = tampered_bytes.decode("ascii")

    with pytest.raises(MarginError) as exc_info:
        decrypt_connection_url(tampered, secret=secret_key)
    assert exc_info.value.status_code == 400


def test_connection_url_masking() -> None:
    """Verify password and sensitive strings are completely stripped in masked representations."""
    raw = "postgresql://admin_user:P@ssw0rd!#@pg.company.internal:5432/analytics"
    masked = mask_connection_url(raw)
    assert masked == "postgresql://***@pg.company.internal:5432/analytics"
    assert "P@ssw0rd!" not in masked
    assert "admin_user" not in masked


@pytest.mark.asyncio
async def test_ssrf_blocking_rejects_loopback_and_private_hosts() -> None:
    """Verify SSRF defense rejects loopback, RFC-1918 IPs, and cloud metadata targets."""
    disallowed_urls = [
        "postgresql://user:pass@127.0.0.1:5432/db",
        "postgresql://user:pass@localhost:5432/db",
        "postgresql://user:pass@10.0.1.50:5432/db",
        "postgresql://user:pass@192.168.1.1:5432/db",
        "postgresql://user:pass@172.16.0.1:5432/db",
        "postgresql://user:pass@169.254.169.254:5432/db",
    ]
    for url in disallowed_urls:
        with pytest.raises(MarginError) as exc_info:
            await validate_and_normalize_external_db_url(url, allow_private_hosts=False)
        assert exc_info.value.status_code == 422


def test_sql_validator_enforces_readonly_select() -> None:
    """Ensure only single SELECT queries succeed, while write/DDL/admin statements are blocked."""
    sql_example = "SELECT id, name FROM users"
    assert validate_readonly_select_sql(sql_example) == sql_example
    assert (
        validate_readonly_select_sql("WITH monthly AS (SELECT id FROM sales) SELECT * FROM monthly")
        == "WITH monthly AS (SELECT id FROM sales) SELECT * FROM monthly"
    )

    forbidden_queries = [
        "INSERT INTO users (name) VALUES ('hacked')",
        "UPDATE accounts SET balance = 1000",
        "DELETE FROM orders WHERE id = 1",
        "DROP TABLE users",
        "ALTER TABLE users DROP COLUMN email",
        "TRUNCATE TABLE logs",
        "CREATE TABLE backdoor (id int)",
        "GRANT ALL PRIVILEGES ON ALL TABLES TO public",
        "SELECT * FROM users; DROP TABLE users;",
        "SELECT pg_sleep(10)",
        "SELECT * FROM pg_read_file('etc/passwd')",
        "",
    ]
    for q in forbidden_queries:
        with pytest.raises(MarginError) as exc_info:
            validate_readonly_select_sql(q)
        assert exc_info.value.status_code == 422


def test_chart_suggestion_detection() -> None:
    """Verify automatic detection of Bar and Line charts on structured data."""
    columns = ["category", "total_sales"]
    rows = [
        {"category": "Electronics", "total_sales": 1200.5},
        {"category": "Apparel", "total_sales": 850.0},
        {"category": "Home", "total_sales": 640.2},
    ]
    suggestion = detect_chart_suggestion(columns, rows)
    assert suggestion is not None
    assert suggestion.chart_type == SqlChartType.BAR
    assert suggestion.x_column == "category"
    assert suggestion.y_column == "total_sales"

    date_columns = ["order_date", "revenue"]
    date_rows = [
        {"order_date": "2026-01-01", "revenue": 100},
        {"order_date": "2026-02-01", "revenue": 150},
        {"order_date": "2026-03-01", "revenue": 200},
    ]
    date_suggestion = detect_chart_suggestion(date_columns, date_rows)
    assert date_suggestion is not None
    assert date_suggestion.chart_type == SqlChartType.LINE


@pytest_asyncio.fixture
async def sample_external_db(tmp_path: Path) -> AsyncIterator[str]:
    """Create a sample SQLite database mimicking an external customer/orders dataset."""
    db_path = tmp_path / "sample_sales.db"
    db_url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE products ("
                "  id INTEGER PRIMARY KEY,"
                "  name TEXT NOT NULL,"
                "  category TEXT NOT NULL,"
                "  price REAL NOT NULL"
                ")"
            )
        )
        await conn.execute(
            text(
                "CREATE TABLE orders ("
                "  id INTEGER PRIMARY KEY,"
                "  category TEXT NOT NULL,"
                "  amount REAL NOT NULL"
                ")"
            )
        )
        await conn.execute(
            text(
                "INSERT INTO products (id, name, category, price) VALUES "
                "(1, 'Laptop', 'Electronics', 1299.99),"
                "(2, 'Keyboard', 'Electronics', 99.50),"
                "(3, 'Desk Chair', 'Furniture', 249.00)"
            )
        )
        await conn.execute(
            text(
                "INSERT INTO orders (id, category, amount) VALUES "
                "(1, 'Electronics', 1399.49),"
                "(2, 'Electronics', 99.50),"
                "(3, 'Furniture', 249.00)"
            )
        )
    await engine.dispose()
    yield db_url


@pytest_asyncio.fixture
async def sql_api_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    """Create a test client configured with SQL Assistant services."""
    db_file = tmp_path / "margin_app.db"
    storage_dir = tmp_path / "uploads"
    settings = Settings(
        _env_file=None,
        APP_ENV=AppEnvironment.DEVELOPMENT,
        DATABASE_URL=f"sqlite+aiosqlite:///{db_file}",
        GEMINI_API_KEY="test-gemini-key",
        STORAGE_PROVIDER="local",
        STORAGE_DIR=storage_dir,
        CREDENTIAL_ENCRYPTION_SECRET="test-secret-encryption-key-32-chars-long!",
        SQL_ALLOW_PRIVATE_HOSTS=True,
    )

    app = create_app(settings_override=settings)
    engine = create_engine_from_url(settings.database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    app.dependency_overrides[get_embedding_provider] = lambda: FakeEmbeddingProvider()
    app.dependency_overrides[get_llm_provider] = lambda: FakeSqlLLMProvider()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    await engine.dispose()


@pytest.mark.asyncio
async def test_readonly_query_execution_on_sqlite(sample_external_db: str) -> None:
    """Verify executing a valid SELECT returns columns, rows, and execution time."""
    test_sql = (
        "SELECT category, SUM(amount) AS total_revenue "
        "FROM orders GROUP BY category ORDER BY total_revenue DESC"
    )
    columns, rows, duration_ms, chart = await execute_readonly_sql_query(
        sample_external_db,
        test_sql,
    )
    assert columns == ["category", "total_revenue"]
    assert len(rows) == 2
    assert rows[0]["category"] == "Electronics"
    assert rows[0]["total_revenue"] == 1498.99
    assert duration_ms >= 0.0
    assert chart is not None
    assert chart.chart_type == SqlChartType.BAR


@pytest.mark.asyncio
async def test_sql_assistant_end_to_end_api_workflow(
    sql_api_client: AsyncClient,
    sample_external_db: str,
) -> None:
    """Test full workflow: create connection, discover schema, preview SQL, and execute."""
    headers = {"X-Session-ID": "sql-user-alice"}

    # 1. Test empty workspace
    empty_ws = await sql_api_client.get("/api/v1/sql/workspace", headers=headers)
    assert empty_ws.status_code == 200
    assert empty_ws.json()["connections"] == []
    assert empty_ws.json()["active_connection_id"] is None

    # 2. Test connection before registering (verifying session scoping)
    test_conn_resp = await sql_api_client.post(
        "/api/v1/sql/connections/test",
        json={
            "provider": "postgresql",
            "connection_url": sample_external_db,
        },
        headers=headers,
    )
    assert test_conn_resp.status_code == 200
    test_conn_data = test_conn_resp.json()
    assert test_conn_data["status"] == "connected"
    assert test_conn_data["table_count"] == 2

    # 3. Register connection
    create_payload = {
        "display_name": "Sales Analytics DB",
        "provider": "postgresql",
        "connection_url": sample_external_db,
    }
    conn_resp = await sql_api_client.post(
        "/api/v1/sql/connections",
        json=create_payload,
        headers=headers,
    )
    assert conn_resp.status_code == 201
    conn_data = conn_resp.json()
    conn_id = conn_data["id"]
    assert conn_data["display_name"] == "Sales Analytics DB"
    assert conn_data["table_count"] == 2
    table_names = [t["table_name"] for t in conn_data["tables"]]
    assert "products" in table_names
    assert "orders" in table_names
    # Credentials are encrypted and masked
    assert "sample_sales.db" not in conn_data["masked_connection_url"]

    # 3. Generate SQL query turn (Preview before execution)
    gen_payload = {
        "question": "Which product category has the most sales revenue?",
        "execute_immediately": False,
    }
    gen_resp = await sql_api_client.post(
        f"/api/v1/sql/connections/{conn_id}/generate",
        json=gen_payload,
        headers=headers,
    )
    assert gen_resp.status_code == 201
    turn_data = gen_resp.json()
    turn_id = turn_data["id"]
    assert turn_data["executed"] is False
    assert "SELECT" in turn_data["generated_sql"].upper()
    assert turn_data["row_count"] == 0

    # 4. Execute SQL turn
    exec_resp = await sql_api_client.post(
        f"/api/v1/sql/connections/{conn_id}/turns/{turn_id}/execute",
        json={"sql_query": turn_data["generated_sql"]},
        headers=headers,
    )
    assert exec_resp.status_code == 200
    exec_data = exec_resp.json()
    assert exec_data["executed"] is True
    assert exec_data["row_count"] > 0
    assert len(exec_data["columns"]) > 0
    assert exec_data["answer_summary"] is not None
    assert "Electronics" in exec_data["answer_summary"]

    # 5. Session isolation: Bob cannot view Alice's connection
    bob_headers = {"X-Session-ID": "sql-user-bob"}
    bob_ws = await sql_api_client.get("/api/v1/sql/workspace", headers=bob_headers)
    assert bob_ws.status_code == 200
    assert bob_ws.json()["connections"] == []

    bob_del = await sql_api_client.delete(
        f"/api/v1/sql/connections/{conn_id}",
        headers=bob_headers,
    )
    assert bob_del.status_code == 404

    # 6. Alice deletes connection cleanly
    alice_del = await sql_api_client.delete(
        f"/api/v1/sql/connections/{conn_id}",
        headers=headers,
    )
    assert alice_del.status_code == 204


def test_normalize_sql_identifier_casing() -> None:
    from app.schemas.sql_contracts import DatabaseColumnSchema, DatabaseTableSchema
    from app.sql.sql_assistant_service import normalize_sql_identifier_casing

    tables = [
        DatabaseTableSchema(
            schema_name="public",
            table_name="Customers",
            columns=[
                DatabaseColumnSchema(
                    name="Id",
                    data_type="int",
                    is_nullable=False,
                    is_primary_key=True,
                    foreign_key_target=None,
                ),
                DatabaseColumnSchema(
                    name="IsDeleted",
                    data_type="boolean",
                    is_nullable=False,
                    is_primary_key=False,
                    foreign_key_target=None,
                ),
                DatabaseColumnSchema(
                    name="IsActive",
                    data_type="boolean",
                    is_nullable=False,
                    is_primary_key=False,
                    foreign_key_target=None,
                ),
            ],
        ),
        DatabaseTableSchema(
            schema_name="public",
            table_name="OrderItem",
            columns=[
                DatabaseColumnSchema(
                    name="OrderId",
                    data_type="int",
                    is_nullable=False,
                    is_primary_key=True,
                    foreign_key_target=None,
                ),
            ],
        ),
    ]

    unquoted_query = (
        "SELECT COUNT(*) AS total_customers FROM public.Customers "
        'WHERE "IsDeleted" = false AND IsActive = true'
    )
    normalized = normalize_sql_identifier_casing(unquoted_query, tables)
    assert 'FROM public."Customers"' in normalized
    assert '"IsDeleted" = false' in normalized
    assert '"IsActive" = true' in normalized

    from_query = "SELECT * FROM OrderItem"
    normalized_join = normalize_sql_identifier_casing(from_query, tables)
    assert 'FROM "OrderItem"' in normalized_join

    # String literals and double-quoted strings containing identifier names remain untouched.
    literal_query = "SELECT COUNT(*) FROM public.Customers WHERE 'Customers' = 'IsActive'"
    normalized_literal = normalize_sql_identifier_casing(literal_query, tables)
    assert 'FROM public."Customers"' in normalized_literal
    assert "'Customers' = 'IsActive'" in normalized_literal


@pytest.mark.asyncio
async def test_sql_validator_and_ssrf_and_settings_edge_cases() -> None:
    """Verify nested comments, dollar-quoting, IPv6-mapped SSRF, and settings invariants."""
    from pydantic import ValidationError

    from app.core.app_settings import AppEnvironment, Settings

    # Nested comments, dollar quotes, and E'...' strings with harmless semicolons/keywords inside
    assert (
        validate_readonly_select_sql(
            "SELECT /* outer /* inner DROP TABLE users; */ still comment */ "
            "$$safe; DROP TABLE users;$$ AS note, E'escaped\\'s; INSERT' AS txt FROM items"
        )
        == "SELECT /* outer /* inner DROP TABLE users; */ still comment */ "
        "$$safe; DROP TABLE users;$$ AS note, E'escaped\\'s; INSERT' AS txt FROM items"
    )

    for invalid_sql in [
        "SELECT 1 /* unclosed nested /* comment */",
        "SELECT $$unclosed dollar quote",
        "SELECT 'unterminated string",
        "SELECT /* comment */ 1; DROP TABLE users",
    ]:
        with pytest.raises(MarginError) as exc_info:
            validate_readonly_select_sql(invalid_sql)
        assert exc_info.value.status_code == 422

    # IPv6-mapped loopback SSRF must be blocked
    with pytest.raises(MarginError) as ipv6_exc:
        await validate_and_normalize_external_db_url(
            "postgresql://user:pass@[::ffff:127.0.0.1]:5432/db",
            allow_private_hosts=False,
        )
    assert ipv6_exc.value.status_code == 422

    # Staging/Production require non-default credential secret; Postgres requires 768-dim embeddings
    for deployed_env in (AppEnvironment.STAGING, AppEnvironment.PRODUCTION):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, APP_ENV=deployed_env)
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            APP_ENV=AppEnvironment.DEVELOPMENT,
            DATABASE_URL="postgresql+asyncpg://u:p@localhost:5432/db",
            GEMINI_EMBEDDING_DIMENSION=1536,
        )
