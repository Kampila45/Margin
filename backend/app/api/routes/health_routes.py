"""Liveness and readiness probe endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_settings import Settings
from app.core.dependency_container import get_db_session, get_settings
from app.schemas.api_envelopes import HealthResponse, ReadinessResponse

router = APIRouter(prefix="/api/v1", tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness check",
)
async def check_liveness() -> HealthResponse:
    """Confirm the HTTP process is running and responsive."""
    return HealthResponse(status="ok", service="margin-api")


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    summary="Readiness check",
)
@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    summary="Readiness check (alias)",
)
async def check_readiness(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReadinessResponse | JSONResponse:
    """Verify database connectivity and Gemini API key configuration."""
    db_status = "ok"
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        db_status = "unavailable"

    ai_status = "configured" if bool(settings.gemini_api_key.strip()) else "unconfigured"
    overall_ready = db_status == "ok" and ai_status == "configured"

    payload = ReadinessResponse(
        status="ready" if overall_ready else "degraded",
        database=db_status,
        ai_provider=ai_status,
    )
    if not overall_ready:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=payload.model_dump(),
        )
    return payload
