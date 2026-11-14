"""Structured logging and request correlation context for Margin."""

from __future__ import annotations

import contextvars
import logging
import sys
import uuid
from typing import Any

# Context variable propagates request_id across async boundaries without explicit parameter passing.
request_id_context: contextvars.ContextVar[str] = contextvars.ContextVar(
    "margin_request_id",
    default="system",
)


def get_request_id() -> str:
    """Return the correlation identifier for the active request or background task."""
    return request_id_context.get()


def generate_request_id() -> str:
    """Create a fresh correlation identifier for an incoming HTTP request."""
    return uuid.uuid4().hex


class RequestCorrelationFilter(logging.Filter):
    """Inject the current request correlation ID into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Attach `request_id` attribute so standard formatters can render it safely."""
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id()
        return True


def configure_logging(log_level: str = "INFO") -> None:
    """Configure root structured logging once at application startup."""
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)

    if any(h.get_name() == "margin_stdout_handler" for h in root_logger.handlers):
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.set_name("margin_stdout_handler")
    handler.setLevel(numeric_level)
    handler.addFilter(RequestCorrelationFilter())
    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)s [%(name)s] [request_id=%(request_id)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )
    handler.setFormatter(formatter)

    root_logger.handlers.clear()
    root_logger.addHandler(handler)


def log_service_warning(
    logger: logging.Logger,
    event: str,
    *,
    error_code: str,
    **metadata: Any,
) -> None:
    """Emit a structured warning with safe operational metadata and no raw document content."""
    meta_pairs = " ".join(f"{key}={value}" for key, value in sorted(metadata.items()))
    suffix = f" {meta_pairs}" if meta_pairs else ""
    logger.warning("%s error_code=%s%s", event, error_code, suffix)


def log_service_error(
    logger: logging.Logger,
    event: str,
    *,
    error_code: str,
    exc_info: bool = True,
    **metadata: Any,
) -> None:
    """Emit a structured error log with safe operational metadata and stack trace."""
    meta_pairs = " ".join(f"{key}={value}" for key, value in sorted(metadata.items()))
    suffix = f" {meta_pairs}" if meta_pairs else ""
    logger.error("%s error_code=%s%s", event, error_code, suffix, exc_info=exc_info)
