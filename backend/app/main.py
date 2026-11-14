"""FastAPI application factory, lifespan management, and request/session middleware for Margin."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import conversation_routes, document_routes, health_routes, sql_routes
from app.core.app_settings import AppEnvironment, Settings
from app.core.app_telemetry import configure_logging, generate_request_id, request_id_context
from app.core.dependency_container import SESSION_COOKIE_NAME, get_settings
from app.core.domain_exceptions import register_exception_handlers
from app.database.db_engine import create_engine_from_url, create_session_factory


def create_app(settings_override: Settings | None = None) -> FastAPI:
    """Construct and configure the Margin FastAPI application instance."""
    settings = settings_override or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine_from_url(settings.database_url, echo=settings.app_debug)
        app.state.engine = engine
        app.state.session_factory = create_session_factory(engine)

        # The schema is managed exclusively by Alembic migrations
        # (`.venv/bin/alembic upgrade head`). The app does not auto-create tables,
        # so `alembic_version` always reflects the actual database schema.

        try:
            yield
        finally:
            await engine.dispose()

    app = FastAPI(
        title=settings.app_name,
        description=(
            "Margin — Read deeper. Understand more. "
            "AI-powered document reader and grounded contextual RAG backend."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    if settings_override is not None:
        app.dependency_overrides[get_settings] = lambda: settings_override

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def attach_request_correlation_and_session_cookie(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Bind `request_id` and issue an `HttpOnly` session cookie when newly generated."""
        incoming_id = request.headers.get("X-Request-ID", "").strip()
        req_id = incoming_id if incoming_id else generate_request_id()
        token = request_id_context.set(req_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = req_id
            generated_session = getattr(request.state, "generated_session_id", None)
            if generated_session:
                response.set_cookie(
                    key=SESSION_COOKIE_NAME,
                    value=str(generated_session),
                    httponly=True,
                    samesite="lax",
                    secure=(
                        settings.app_env in {AppEnvironment.STAGING, AppEnvironment.PRODUCTION}
                    ),
                    max_age=60 * 60 * 24 * 7,
                )
            return response
        finally:
            request_id_context.reset(token)

    register_exception_handlers(app)

    app.include_router(health_routes.router)
    app.include_router(document_routes.router)
    app.include_router(conversation_routes.router)
    app.include_router(sql_routes.router)

    return app


app = create_app()
