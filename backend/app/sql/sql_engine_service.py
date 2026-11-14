"""Credential encryption, SSRF host validation, schema discovery, and read-only SQL execution."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import ipaddress
import re
import secrets
import socket
import time
import uuid
from datetime import date, datetime
from decimal import Decimal
from http import HTTPStatus
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.domain_exceptions import ErrorCode, MarginError
from app.schemas.sql_contracts import (
    DatabaseColumnSchema,
    DatabaseTableSchema,
    SqlChartSuggestion,
    SqlChartType,
)

_FORBIDDEN_SQL_PATTERN = re.compile(
    r"\b("
    r"insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|"
    r"execute|prepare|deallocate|vacuum|analyze|lock|comment|security|reassign|"
    r"discard|listen|notify|unlisten|load|import|cluster|reindex|refresh|"
    r"pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|"
    r"lo_import|lo_export|dblink|set\s+role|set\s+session"
    r")\b",
    re.IGNORECASE,
)

_DOLLAR_TAG_RE = re.compile(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")


def _mask_sql_lexical_tokens(
    sql_query: str,
    *,
    mask_double_quoted: bool = False,
) -> tuple[str, list[str]]:
    """Scan SQL once to strip comments (supporting nesting) and mask string literals.

    Returns `(masked_sql, preserved_tokens)` where masked string literals become
    `__MARGIN_LIT_N__` placeholders when `mask_double_quoted=True` or `''` for
    validation, while unclosed strings/comments raise `MarginError`.
    """
    n = len(sql_query)
    idx = 0
    out: list[str] = []
    preserved: list[str] = []

    def _emit_literal(token_text: str) -> None:
        if mask_double_quoted:
            placeholder = f"__MARGIN_TOK_{len(preserved)}__"
            preserved.append(token_text)
            out.append(placeholder)
        else:
            out.append("''")

    while idx < n:
        ch = sql_query[idx]

        # Line comment: `-- ... \n`
        if ch == "-" and idx + 1 < n and sql_query[idx + 1] == "-":
            start = idx
            newline_pos = sql_query.find("\n", idx + 2)
            idx = n if newline_pos == -1 else newline_pos + 1
            if mask_double_quoted:
                placeholder = f"__MARGIN_TOK_{len(preserved)}__"
                preserved.append(sql_query[start:idx])
                out.append(placeholder)
            else:
                out.append(" ")
            continue

        # Nested block comment: `/* ... */`
        if ch == "/" and idx + 1 < n and sql_query[idx + 1] == "*":
            start = idx
            depth = 1
            idx += 2
            while idx < n and depth > 0:
                if sql_query[idx] == "/" and idx + 1 < n and sql_query[idx + 1] == "*":
                    depth += 1
                    idx += 2
                elif sql_query[idx] == "*" and idx + 1 < n and sql_query[idx + 1] == "/":
                    depth -= 1
                    idx += 2
                else:
                    idx += 1
            if depth > 0:
                raise MarginError(
                    "Unterminated SQL block comment.",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
                )
            if mask_double_quoted:
                placeholder = f"__MARGIN_TOK_{len(preserved)}__"
                preserved.append(sql_query[start:idx])
                out.append(placeholder)
            else:
                out.append(" ")
            continue

        # Dollar-quoted string literal: `$$...$$` or `$tag$...$tag$`
        if ch == "$":
            tag_match = _DOLLAR_TAG_RE.match(sql_query, idx)
            if tag_match:
                tag = tag_match.group(0)
                end_pos = sql_query.find(tag, tag_match.end())
                if end_pos == -1:
                    raise MarginError(
                        "Unterminated dollar-quoted SQL string literal.",
                        error_code=ErrorCode.VALIDATION_ERROR,
                        status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
                    )
                end_idx = end_pos + len(tag)
                _emit_literal(sql_query[idx:end_idx])
                idx = end_idx
                continue

        # PostgreSQL escape string `E'...'` / `e'...'` (not part of an identifier)
        prev_ch = sql_query[idx - 1] if idx > 0 else " "
        is_escape_prefix = (
            ch in ("e", "E")
            and not (prev_ch.isalnum() or prev_ch == "_")
            and idx + 1 < n
            and sql_query[idx + 1] == "'"
        )
        if ch == "'" or is_escape_prefix:
            start = idx
            if is_escape_prefix:
                idx += 1
            idx += 1  # consume opening quote
            closed = False
            while idx < n:
                cur = sql_query[idx]
                if is_escape_prefix and cur == "\\":
                    if idx + 1 >= n:
                        break
                    idx += 2
                    continue
                if cur == "'":
                    if idx + 1 < n and sql_query[idx + 1] == "'":
                        idx += 2
                        continue
                    idx += 1
                    closed = True
                    break
                idx += 1
            if not closed:
                raise MarginError(
                    "Unterminated SQL string literal.",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
                )
            _emit_literal(sql_query[start:idx])
            continue

        # Double-quoted identifier `"..."`
        if ch == '"':
            start = idx
            idx += 1
            closed = False
            while idx < n:
                if sql_query[idx] == '"':
                    if idx + 1 < n and sql_query[idx + 1] == '"':
                        idx += 2
                        continue
                    idx += 1
                    closed = True
                    break
                idx += 1
            if not closed:
                raise MarginError(
                    "Unterminated SQL quoted identifier.",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
                )
            token_text = sql_query[start:idx]
            if mask_double_quoted:
                placeholder = f"__MARGIN_TOK_{len(preserved)}__"
                preserved.append(token_text)
                out.append(placeholder)
            else:
                out.append(token_text)
            continue

        out.append(ch)
        idx += 1

    return "".join(out), preserved


def _derive_keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    """Generate a deterministic HMAC-SHA256 counter-mode keystream."""
    out = bytearray()
    counter = 0
    while len(out) < length:
        block = hmac.new(
            key,
            nonce + counter.to_bytes(4, "big"),
            hashlib.sha256,
        ).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def encrypt_connection_url(raw_url: str, secret: str) -> str:
    """Encrypt a database connection URL using authenticated PBKDF2 + HMAC-SHA256 cipher."""
    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, 100_000, dklen=64)
    enc_key, mac_key = derived[:32], derived[32:]

    plaintext = raw_url.encode("utf-8")
    stream = _derive_keystream(enc_key, nonce, len(plaintext))
    ciphertext = bytes(a ^ b for a, b in zip(plaintext, stream, strict=True))
    tag = hmac.new(mac_key, salt + nonce + ciphertext, hashlib.sha256).digest()
    payload = salt + nonce + tag + ciphertext
    return base64.urlsafe_b64encode(payload).decode("ascii")


def decrypt_connection_url(token: str, secret: str) -> str:
    """Verify authentication tag and decrypt a stored database connection URL."""
    try:
        raw = base64.urlsafe_b64decode(token.encode("ascii"))
    except Exception as exc:
        raise MarginError(
            "Stored database credentials could not be decoded.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.BAD_REQUEST,
        ) from exc

    if len(raw) < 64:
        raise MarginError(
            "Stored database credentials are invalid.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.BAD_REQUEST,
        )

    salt = raw[:16]
    nonce = raw[16:32]
    tag = raw[32:64]
    ciphertext = raw[64:]

    derived = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, 100_000, dklen=64)
    enc_key, mac_key = derived[:32], derived[32:]
    expected_tag = hmac.new(mac_key, salt + nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected_tag):
        raise MarginError(
            "Stored database credentials failed integrity verification.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.BAD_REQUEST,
        )

    stream = _derive_keystream(enc_key, nonce, len(ciphertext))
    plaintext = bytes(a ^ b for a, b in zip(ciphertext, stream, strict=True))
    return plaintext.decode("utf-8")


def mask_connection_url(raw_url: str) -> str:
    """Mask username/password in a connection URL so secrets never leave the backend."""
    cleaned = raw_url.strip()
    if cleaned.startswith("sqlite"):
        return "postgresql://***@connected-host:5432/database"

    if "://" in cleaned:
        _, remainder = cleaned.split("://", 1)
        if "@" in remainder:
            _, host_and_path = remainder.rsplit("@", 1)
            return f"postgresql://***@{host_and_path}"
        return f"postgresql://***@{remainder}"

    return "postgresql://***@connected-host:5432/database"


async def validate_and_normalize_external_db_url(
    raw_url: str,
    *,
    allow_private_hosts: bool = False,
    allow_sqlite_for_tests: bool = False,
) -> str:
    """Validate PostgreSQL connection URL, block SSRF targets, and normalize for asyncpg."""
    cleaned = raw_url.strip().strip("'").strip('"')
    if allow_sqlite_for_tests and cleaned.startswith("sqlite+aiosqlite://"):
        return cleaned

    if cleaned.startswith("postgres://"):
        cleaned = "postgresql://" + cleaned[len("postgres://") :]

    if not cleaned.startswith("postgresql://") and not cleaned.startswith("postgresql+asyncpg://"):
        raise MarginError(
            "Please provide a valid PostgreSQL connection URL starting with postgresql://",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    parsed = urlparse(cleaned)
    hostname = parsed.hostname
    if not hostname:
        raise MarginError(
            "The connection URL is missing a database hostname.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    if not parsed.path or parsed.path == "/":
        raise MarginError(
            "The connection URL is missing a database name (e.g. /dbname).",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    if not allow_private_hosts:
        await asyncio.to_thread(_verify_host_is_public, hostname)

    # Convert to SQLAlchemy asyncpg driver URL and normalize SSL query params.
    asyncpg_url = cleaned
    if asyncpg_url.startswith("postgresql://"):
        asyncpg_url = "postgresql+asyncpg://" + asyncpg_url[len("postgresql://") :]

    if "?" in asyncpg_url:
        base, query = asyncpg_url.split("?", 1)
        params: list[str] = []
        for part in query.split("&"):
            if part.startswith("sslmode="):
                params.append("ssl=" + part.split("=", 1)[1])
            elif part.startswith("channel_binding="):
                continue
            elif part:
                params.append(part)
        asyncpg_url = f"{base}?{'&'.join(params)}" if params else base

    return asyncpg_url


def _verify_ip_is_public(ip_str: str) -> None:
    """Validate that a resolved IP (unwrapping IPv6-mapped IPv4) is publicly routable."""
    try:
        raw_ip = ipaddress.ip_address(ip_str.split("%", 1)[0])
    except ValueError:
        raise MarginError(
            "Database host resolved to an invalid IP address.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        ) from None

    ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address = raw_ip
    if isinstance(raw_ip, ipaddress.IPv6Address) and raw_ip.ipv4_mapped is not None:
        ip_obj = raw_ip.ipv4_mapped
    if (
        ip_obj.is_loopback
        or ip_obj.is_private
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
    ):
        raise MarginError(
            "Connecting to private, loopback, or metadata IP addresses is blocked.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )


def _verify_host_is_public(hostname: str) -> list[str]:
    """Prevent SSRF by blocking loopback, RFC-1918 private IPs, and cloud metadata IPs."""
    lowered = hostname.lower().strip()
    if lowered in {"localhost", "localhost.localdomain", "metadata.google.internal"}:
        raise MarginError(
            "Connecting to local or internal network hosts is not permitted for security reasons.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    try:
        addr_infos = socket.getaddrinfo(lowered, None)
    except socket.gaierror as exc:
        raise MarginError(
            f"Could not resolve host '{hostname}'. Please check the hostname and try again.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        ) from exc

    resolved_ips: list[str] = []
    for info in addr_infos:
        ip_str = str(info[4][0])
        _verify_ip_is_public(ip_str)
        resolved_ips.append(ip_str)
    return resolved_ips


async def _assert_external_db_host_allowed(
    normalized_db_url: str,
    *,
    allow_private_hosts: bool,
) -> None:
    """Re-verify external database DNS resolution right before opening a socket."""
    if allow_private_hosts or normalized_db_url.startswith("sqlite"):
        return
    parsed = urlparse(normalized_db_url)
    hostname = parsed.hostname
    if not hostname:
        raise MarginError(
            "The connection URL is missing a database hostname.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )
    await asyncio.to_thread(_verify_host_is_public, hostname)


def _verify_connected_peer_is_public(raw_conn: Any, *, allow_private_hosts: bool) -> None:
    """Verify the established asyncpg TCP peer address did not rebind to an internal IP."""
    if allow_private_hosts:
        return
    driver_conn = getattr(raw_conn, "driver_connection", None)
    protocol = getattr(driver_conn, "_protocol", None)
    transport = getattr(protocol, "_transport", None)
    if transport is None or not hasattr(transport, "get_extra_info"):
        return
    peername = transport.get_extra_info("peername")
    if isinstance(peername, tuple) and peername:
        _verify_ip_is_public(str(peername[0]))


def validate_readonly_select_sql(sql_query: str) -> str:
    """Ensure the SQL query is a single read-only SELECT / WITH query with no write commands."""
    masked_literals, _ = _mask_sql_lexical_tokens(sql_query, mask_double_quoted=False)
    cleaned_check = masked_literals.strip().rstrip(";").strip()
    cleaned_return = sql_query.strip().rstrip(";").strip()

    if not cleaned_check:
        raise MarginError(
            "SQL query cannot be empty.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    if ";" in cleaned_check:
        raise MarginError(
            "Only a single read-only SELECT statement is permitted per query.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    first_token_match = re.match(r"^\s*([a-zA-Z]+)", cleaned_check)
    first_token = first_token_match.group(1).upper() if first_token_match else ""
    if first_token not in {"SELECT", "WITH"}:
        raise MarginError(
            "Only read-only SELECT queries are allowed in the SQL Assistant.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    forbidden_match = _FORBIDDEN_SQL_PATTERN.search(cleaned_check)
    if forbidden_match:
        keyword = forbidden_match.group(1).upper()
        raise MarginError(
            f"Disallowed SQL operation '{keyword}' detected. Only read-only queries are permitted.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    return cleaned_return


def normalize_sql_identifier_casing(
    sql_query: str,
    schema_tables: list[DatabaseTableSchema],
) -> str:
    """Ensure table and column names matching discovered schema are properly quoted for PostgreSQL.

    PostgreSQL folds unquoted identifiers to lowercase. When tables or columns were created
    with mixed/PascalCase (e.g. EF Core, Prisma, ORMs), queries like `FROM public.Customers`
    fail with `relation "public.customers" does not exist`.
    Masks string literals, comments, and existing double-quoted identifiers before rewriting.
    """
    try:
        result, preserved = _mask_sql_lexical_tokens(sql_query, mask_double_quoted=True)
    except MarginError:
        return sql_query

    for table in schema_tables:
        t_name = table.table_name
        pattern_public = rf"\bpublic\.(?!\"){re.escape(t_name)}\b"
        result = re.sub(pattern_public, f'public."{t_name}"', result, flags=re.IGNORECASE)

        pattern_dot = rf"(?<!\")(?:(?<=\s)|(?<=\()|^){re.escape(t_name)}\."
        result = re.sub(pattern_dot, f'"{t_name}".', result, flags=re.IGNORECASE)

        pattern_clause = (
            rf"(\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+)(?<!\"){re.escape(t_name)}\b(?!\")"
        )
        result = re.sub(pattern_clause, rf'\g<1>"{t_name}"', result, flags=re.IGNORECASE)

        for col in table.columns:
            c_name = col.name
            if any(ch.isupper() for ch in c_name):
                pattern_col = rf"(?<!\")\b{re.escape(c_name)}\b(?!\")"
                result = re.sub(pattern_col, f'"{c_name}"', result)

    for idx, original_token in enumerate(preserved):
        result = result.replace(f"__MARGIN_TOK_{idx}__", original_token)
    return result


async def discover_external_schema(
    normalized_db_url: str,
    *,
    timeout_seconds: float = 6.0,
    allow_private_hosts: bool = False,
) -> list[DatabaseTableSchema]:
    """Connect to the external database in read-only mode and discover tables, columns, and keys."""
    await _assert_external_db_host_allowed(
        normalized_db_url,
        allow_private_hosts=allow_private_hosts,
    )
    is_sqlite = normalized_db_url.startswith("sqlite")
    connect_args: dict[str, Any] = {} if is_sqlite else {"command_timeout": timeout_seconds}
    engine = create_async_engine(normalized_db_url, pool_pre_ping=True, connect_args=connect_args)

    try:
        async with engine.begin() as conn:
            if is_sqlite:
                return await _discover_sqlite_schema(conn)

            _verify_connected_peer_is_public(
                await conn.get_raw_connection(),
                allow_private_hosts=allow_private_hosts,
            )
            await conn.execute(text("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY"))
            columns_result = await conn.execute(
                text(
                    """
                    SELECT
                        c.table_schema,
                        c.table_name,
                        c.column_name,
                        c.data_type,
                        c.is_nullable
                    FROM information_schema.columns AS c
                    JOIN information_schema.tables AS t
                      ON c.table_schema = t.table_schema
                     AND c.table_name = t.table_name
                    WHERE c.table_schema = 'public'
                      AND t.table_type IN ('BASE TABLE', 'VIEW')
                    ORDER BY c.table_name, c.ordinal_position
                    LIMIT 600
                    """
                )
            )
            col_rows = columns_result.fetchall()

            fk_result = await conn.execute(
                text(
                    """
                    SELECT
                        kcu.table_name,
                        kcu.column_name,
                        tc.constraint_type,
                        ccu.table_name AS foreign_table_name,
                        ccu.column_name AS foreign_column_name
                    FROM information_schema.table_constraints AS tc
                    JOIN information_schema.key_column_usage AS kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema = kcu.table_schema
                    LEFT JOIN information_schema.constraint_column_usage AS ccu
                      ON ccu.constraint_name = tc.constraint_name
                     AND ccu.table_schema = tc.table_schema
                    WHERE tc.table_schema = 'public'
                      AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
                    ORDER BY kcu.table_name, kcu.column_name
                    LIMIT 2000
                    """
                )
            )
            pk_set: set[tuple[str, str]] = set()
            fk_map: dict[tuple[str, str], str] = {}
            for row in fk_result.fetchall():
                t_name = str(row[0])
                c_name = str(row[1])
                c_type = str(row[2])
                if c_type == "PRIMARY KEY":
                    pk_set.add((t_name, c_name))
                elif c_type == "FOREIGN KEY" and row[3] and row[4]:
                    fk_map[(t_name, c_name)] = f"{row[3]}.{row[4]}"

            tables_by_name: dict[str, DatabaseTableSchema] = {}
            for row in col_rows:
                schema_name = str(row[0])
                table_name = str(row[1])
                col_name = str(row[2])
                data_type = str(row[3])
                is_nullable = str(row[4]).upper() == "YES"

                if table_name not in tables_by_name:
                    tables_by_name[table_name] = DatabaseTableSchema(
                        schema_name=schema_name,
                        table_name=table_name,
                        columns=[],
                    )
                tables_by_name[table_name].columns.append(
                    DatabaseColumnSchema(
                        name=col_name,
                        data_type=data_type,
                        is_nullable=is_nullable,
                        is_primary_key=(table_name, col_name) in pk_set,
                        foreign_key_target=fk_map.get((table_name, col_name)),
                    )
                )

            return list(tables_by_name.values())
    except MarginError:
        raise
    except Exception as exc:
        raise MarginError(
            "Could not connect to database. Check connection URL, host, and read-only credentials.",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.BAD_REQUEST,
        ) from exc
    finally:
        await engine.dispose()


async def _discover_sqlite_schema(conn: Any) -> list[DatabaseTableSchema]:
    """Discover table and column metadata on SQLite connections during automated tests."""
    sql = (
        "SELECT name FROM sqlite_master "
        "WHERE type='table' AND name NOT LIKE 'sqlite_%' "
        "ORDER BY name"
    )
    tables_res = await conn.execute(text(sql))
    tables: list[DatabaseTableSchema] = []
    for (t_name,) in tables_res.fetchall():
        table_name = str(t_name)
        pragma_res = await conn.execute(text(f'PRAGMA table_info("{table_name}")'))
        cols: list[DatabaseColumnSchema] = []
        for col in pragma_res.fetchall():
            cols.append(
                DatabaseColumnSchema(
                    name=str(col[1]),
                    data_type=str(col[2] or "TEXT"),
                    is_nullable=(int(col[3]) == 0),
                    is_primary_key=(int(col[5]) > 0),
                )
            )
        tables.append(
            DatabaseTableSchema(
                schema_name="public",
                table_name=table_name,
                columns=cols,
            )
        )
    return tables


def _serialize_cell_value(val: Any) -> Any:
    """Convert database cell values (Decimal, datetime, UUID, bytes) into JSON-safe primitives."""
    if val is None or isinstance(val, (str, int, float, bool)):
        return val
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, (bytes, bytearray)):
        return val.decode("utf-8", errors="replace")
    return str(val)


def detect_chart_suggestion(
    columns: list[str],
    rows: list[dict[str, Any]],
) -> SqlChartSuggestion | None:
    """Suggest a Bar or Line chart when query results have categorical/date + numeric columns."""
    if len(columns) < 2 or len(rows) < 2 or len(rows) > 50:
        return None

    x_col: str | None = None
    y_col: str | None = None

    for col in columns:
        sample_vals = [r.get(col) for r in rows if r.get(col) is not None]
        if not sample_vals:
            continue
        is_numeric = all(
            isinstance(v, (int, float)) and not isinstance(v, bool) for v in sample_vals
        )
        if not is_numeric and x_col is None:
            x_col = col
        elif is_numeric and y_col is None:
            y_col = col

    if x_col is None or y_col is None:
        return None

    x_lower = x_col.lower()
    is_temporal = any(
        token in x_lower for token in ("date", "month", "year", "day", "week", "period", "quarter")
    )
    if is_temporal:
        chart_type = SqlChartType.LINE
    elif len(rows) > 8:
        chart_type = SqlChartType.HORIZONTAL_BAR
    else:
        chart_type = SqlChartType.BAR

    title = f"{y_col.replace('_', ' ').title()} by {x_col.replace('_', ' ').title()}"

    if chart_type == SqlChartType.LINE:
        vega_spec: dict[str, Any] = {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "title": {"text": title, "anchor": "start", "fontSize": 13, "fontWeight": 600},
            "width": "container",
            "height": 240,
            "mark": {
                "type": "line",
                "point": {"filled": True, "fill": "#4143d5", "size": 60},
                "color": "#4143d5",
                "strokeWidth": 2.5,
            },
            "encoding": {
                "x": {
                    "field": x_col,
                    "type": "temporal" if is_temporal else "nominal",
                    "axis": {
                        "title": x_col.replace("_", " ").title(),
                        "labelAngle": 0,
                        "grid": False,
                    },
                },
                "y": {
                    "field": y_col,
                    "type": "quantitative",
                    "axis": {"title": y_col.replace("_", " ").title(), "gridDash": [3, 3]},
                },
                "tooltip": [
                    {
                        "field": x_col,
                        "type": "temporal" if is_temporal else "nominal",
                        "title": x_col.replace("_", " ").title(),
                    },
                    {
                        "field": y_col,
                        "type": "quantitative",
                        "title": y_col.replace("_", " ").title(),
                    },
                ],
            },
        }
    elif chart_type == SqlChartType.HORIZONTAL_BAR:
        vega_spec = {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "title": {"text": title, "anchor": "start", "fontSize": 13, "fontWeight": 600},
            "width": "container",
            "height": max(200, min(500, len(rows) * 24)),
            "mark": {"type": "bar", "cornerRadiusEnd": 3, "color": "#4143d5"},
            "encoding": {
                "y": {
                    "field": x_col,
                    "type": "nominal",
                    "sort": "-x",
                    "axis": {"title": x_col.replace("_", " ").title()},
                },
                "x": {
                    "field": y_col,
                    "type": "quantitative",
                    "axis": {"title": y_col.replace("_", " ").title(), "gridDash": [3, 3]},
                },
                "tooltip": [
                    {"field": x_col, "type": "nominal", "title": x_col.replace("_", " ").title()},
                    {
                        "field": y_col,
                        "type": "quantitative",
                        "title": y_col.replace("_", " ").title(),
                    },
                ],
            },
        }
    else:
        vega_spec = {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "title": {"text": title, "anchor": "start", "fontSize": 13, "fontWeight": 600},
            "width": "container",
            "height": 240,
            "mark": {"type": "bar", "cornerRadiusEnd": 4, "color": "#4143d5"},
            "encoding": {
                "x": {
                    "field": x_col,
                    "type": "nominal",
                    "axis": {
                        "title": x_col.replace("_", " ").title(),
                        "labelAngle": 0,
                        "grid": False,
                    },
                },
                "y": {
                    "field": y_col,
                    "type": "quantitative",
                    "axis": {"title": y_col.replace("_", " ").title(), "gridDash": [3, 3]},
                },
                "tooltip": [
                    {"field": x_col, "type": "nominal", "title": x_col.replace("_", " ").title()},
                    {
                        "field": y_col,
                        "type": "quantitative",
                        "title": y_col.replace("_", " ").title(),
                    },
                ],
            },
        }

    return SqlChartSuggestion(
        chart_type=chart_type,
        x_column=x_col,
        y_column=y_col,
        title=title,
        vega_lite_spec=vega_spec,
    )


async def execute_readonly_sql_query(
    normalized_db_url: str,
    sql_query: str,
    *,
    timeout_seconds: float = 5.0,
    max_rows: int = 100,
    allow_private_hosts: bool = False,
) -> tuple[list[str], list[dict[str, Any]], float, SqlChartSuggestion | None]:
    """Validate and execute a read-only SELECT query with row limits and statement timeout."""
    validated_sql = validate_readonly_select_sql(sql_query)
    await _assert_external_db_host_allowed(
        normalized_db_url,
        allow_private_hosts=allow_private_hosts,
    )
    is_sqlite = normalized_db_url.startswith("sqlite")
    connect_args: dict[str, Any] = {} if is_sqlite else {"command_timeout": timeout_seconds}
    engine = create_async_engine(normalized_db_url, pool_pre_ping=True, connect_args=connect_args)

    start_ns = time.perf_counter_ns()
    try:
        async with engine.begin() as conn:
            if is_sqlite:
                await conn.execute(text("PRAGMA query_only = ON"))
                # Strip PostgreSQL public schema qualifier for SQLite test databases
                validated_sql = re.sub(r"\bpublic\.", "", validated_sql, flags=re.IGNORECASE)
            else:
                _verify_connected_peer_is_public(
                    await conn.get_raw_connection(),
                    allow_private_hosts=allow_private_hosts,
                )
                timeout_ms = int(timeout_seconds * 1000)
                await conn.execute(text("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY"))
                await conn.execute(text(f"SET LOCAL statement_timeout = '{timeout_ms}ms'"))

            result = await conn.execute(text(validated_sql))
            columns = [str(col) for col in result.keys()]  # noqa: SIM118
            raw_rows = result.fetchmany(max_rows)

            rows: list[dict[str, Any]] = []
            for raw_row in raw_rows:
                row_dict: dict[str, Any] = {}
                for idx, col_name in enumerate(columns):
                    row_dict[col_name] = _serialize_cell_value(raw_row[idx])
                rows.append(row_dict)

            duration_ms = round((time.perf_counter_ns() - start_ns) / 1_000_000, 2)
            chart_suggestion = detect_chart_suggestion(columns, rows)
            return columns, rows, duration_ms, chart_suggestion
    except MarginError:
        raise
    except Exception as exc:
        err_detail = str(exc.orig) if hasattr(exc, "orig") and exc.orig else str(exc)
        first_line = (
            err_detail.strip().splitlines()[0] if err_detail.strip() else "Query execution failed."
        )
        raise MarginError(
            f"The database could not run this SQL query: {first_line}",
            error_code=ErrorCode.VALIDATION_ERROR,
            status_code=HTTPStatus.BAD_REQUEST,
        ) from exc
    finally:
        await engine.dispose()
