"""Shared API envelope schemas for errors and health checks."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    """Consistent error envelope returned across all non-2xx API responses."""

    error_code: str = Field(description="Stable machine-readable error identifier.")
    message: str = Field(description="User-safe error explanation with no internal paths or PII.")
    request_id: str = Field(description="Correlation ID matching server structured logs.")


class HealthResponse(BaseModel):
    """Liveness response payload."""

    status: str = Field(default="ok")
    service: str = Field(default="margin-api")


class ReadinessResponse(BaseModel):
    """Readiness response verifying database and Gemini provider configuration."""

    status: str
    database: str
    ai_provider: str
