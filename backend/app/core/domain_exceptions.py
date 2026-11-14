"""Typed domain exceptions and centralized HTTP error translation for Margin."""

from __future__ import annotations

import logging
from enum import StrEnum
from http import HTTPStatus
from typing import TYPE_CHECKING

from app.core.app_telemetry import get_request_id, log_service_error, log_service_warning
from app.schemas.api_envelopes import ErrorResponse

if TYPE_CHECKING:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class ErrorCode(StrEnum):
    """Stable machine-readable error codes returned in API error envelopes."""

    UNSUPPORTED_DOCUMENT_FORMAT = "UNSUPPORTED_DOCUMENT_FORMAT"
    FILE_SIZE_LIMIT_EXCEEDED = "FILE_SIZE_LIMIT_EXCEEDED"
    PAGE_LIMIT_EXCEEDED = "PAGE_LIMIT_EXCEEDED"
    SESSION_QUOTA_EXCEEDED = "SESSION_QUOTA_EXCEEDED"
    DOCUMENT_NOT_FOUND = "DOCUMENT_NOT_FOUND"
    DOCUMENT_NOT_READY = "DOCUMENT_NOT_READY"
    CONVERSATION_NOT_FOUND = "CONVERSATION_NOT_FOUND"
    DATABASE_CONNECTION_NOT_FOUND = "DATABASE_CONNECTION_NOT_FOUND"
    INVALID_SELECTION_CONTEXT = "INVALID_SELECTION_CONTEXT"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR"


class MarginError(Exception):
    """Base exception for all expected domain and application errors in Margin."""

    status_code: int = HTTPStatus.BAD_REQUEST
    error_code: ErrorCode = ErrorCode.VALIDATION_ERROR

    def __init__(
        self,
        message: str,
        *,
        error_code: ErrorCode | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if error_code is not None:
            self.error_code = error_code
        if status_code is not None:
            self.status_code = status_code


class UnsupportedDocumentFormatError(MarginError):
    """Raised when an uploaded file fails extension, MIME, or magic-byte verification."""

    status_code = HTTPStatus.UNPROCESSABLE_ENTITY
    error_code = ErrorCode.UNSUPPORTED_DOCUMENT_FORMAT


class FileSizeLimitExceededError(MarginError):
    """Raised when an uploaded file exceeds the configured byte limit or is empty."""

    status_code = HTTPStatus.REQUEST_ENTITY_TOO_LARGE
    error_code = ErrorCode.FILE_SIZE_LIMIT_EXCEEDED


class PageLimitExceededError(MarginError):
    """Raised when an extracted document exceeds the configured maximum page count."""

    status_code = HTTPStatus.UNPROCESSABLE_ENTITY
    error_code = ErrorCode.PAGE_LIMIT_EXCEEDED


class SessionQuotaExceededError(MarginError):
    """Raised when a session exceeds its allowed number of stored documents."""

    status_code = HTTPStatus.TOO_MANY_REQUESTS
    error_code = ErrorCode.SESSION_QUOTA_EXCEEDED


class DocumentNotFoundError(MarginError):
    """Raised when a document does not exist or belongs to another session."""

    status_code = HTTPStatus.NOT_FOUND
    error_code = ErrorCode.DOCUMENT_NOT_FOUND


class DocumentNotReadyError(MarginError):
    """Raised when a Q&A operation targets a document that is not yet in `ready` state."""

    status_code = HTTPStatus.CONFLICT
    error_code = ErrorCode.DOCUMENT_NOT_READY


class ConversationNotFoundError(MarginError):
    """Raised when a conversation does not exist or belongs to another session."""

    status_code = HTTPStatus.NOT_FOUND
    error_code = ErrorCode.CONVERSATION_NOT_FOUND


class DatabaseConnectionNotFoundError(MarginError):
    """Raised when an external database connection does not exist or belongs to another session."""

    status_code = HTTPStatus.NOT_FOUND
    error_code = ErrorCode.DATABASE_CONNECTION_NOT_FOUND


class InvalidSelectionContextError(MarginError):
    """Raised when `selection_qa` mode is requested without a valid highlighted passage."""

    status_code = HTTPStatus.UNPROCESSABLE_ENTITY
    error_code = ErrorCode.INVALID_SELECTION_CONTEXT


class ProviderUnavailableError(MarginError):
    """Raised when the hosted Gemini provider fails, times out, or is unconfigured."""

    status_code = HTTPStatus.SERVICE_UNAVAILABLE
    error_code = ErrorCode.PROVIDER_UNAVAILABLE


def register_exception_handlers(app: FastAPI) -> None:
    """Register centralized exception handlers translating domain errors to `ErrorResponse`."""
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse

    @app.exception_handler(MarginError)
    async def handle_margin_error(request: Request, exc: MarginError) -> JSONResponse:
        request_id = get_request_id()
        log_service_warning(
            logger,
            "domain_exception_raised",
            error_code=exc.error_code.value,
            path=request.url.path,
            status_code=exc.status_code,
        )
        payload = ErrorResponse(
            error_code=exc.error_code.value,
            message=exc.message,
            request_id=request_id,
        )
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump())

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        request_id = get_request_id()
        first_error = exc.errors()[0] if exc.errors() else {}
        field_loc = ".".join(str(part) for part in first_error.get("loc", []))
        detail_msg = first_error.get("msg", "Request validation failed.")
        message = f"Invalid request field '{field_loc}': {detail_msg}" if field_loc else detail_msg

        log_service_warning(
            logger,
            "request_validation_failed",
            error_code=ErrorCode.VALIDATION_ERROR.value,
            path=request.url.path,
            field=field_loc or "unknown",
        )
        payload = ErrorResponse(
            error_code=ErrorCode.VALIDATION_ERROR.value,
            message=message,
            request_id=request_id,
        )
        return JSONResponse(
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            content=payload.model_dump(),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        request_id = get_request_id()
        log_service_error(
            logger,
            "unhandled_server_exception",
            error_code=ErrorCode.INTERNAL_SERVER_ERROR.value,
            path=request.url.path,
            exception_type=type(exc).__name__,
        )
        payload = ErrorResponse(
            error_code=ErrorCode.INTERNAL_SERVER_ERROR.value,
            message="An unexpected error occurred while processing your request.",
            request_id=request_id,
        )
        return JSONResponse(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            content=payload.model_dump(),
        )
