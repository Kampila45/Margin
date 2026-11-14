"""Async SQLAlchemy engine and session factory management."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base class for all Margin relational and vector ORM models."""


def create_engine_from_url(database_url: str, *, echo: bool = False) -> AsyncEngine:
    """Create an async SQLAlchemy engine configured with connection pre-pinging."""
    # SQLite in-memory/file engines used in tests do not support pool_pre_ping with StaticPool args,
    # whereas asyncpg benefits from pool_pre_ping to recover cleanly from dropped connections.
    is_sqlite = database_url.startswith("sqlite")
    if is_sqlite:
        return create_async_engine(database_url, echo=echo)
    return create_async_engine(
        database_url,
        echo=echo,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Create a session factory that preserves loaded attributes after commit."""
    return async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )


async def yield_db_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Yield an async database session and roll back automatically on unhandled errors."""
    async with session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
