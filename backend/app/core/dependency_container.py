"""FastAPI dependency injection factories wiring repositories, storage, and services."""

from __future__ import annotations

import re
import secrets
from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Annotated

from fastapi import Cookie, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.gemini_provider_adapter import GeminiEmbeddingProvider, GeminiLLMProvider
from app.ai.grok_provider_adapter import GrokLLMProvider
from app.chat.conversation_orchestrator import ChatService
from app.core.app_settings import Settings
from app.database.conversation_repository import ConversationRepository
from app.database.db_engine import yield_db_session
from app.database.document_repository import DocumentRepository
from app.documents.document_ingestion_service import DocumentService
from app.documents.text_extractor import DefaultDocumentExtractor
from app.ports.ai_provider_ports import EmbeddingProviderProtocol, LLMProviderProtocol
from app.ports.document_extractor_port import DocumentExtractorProtocol
from app.ports.file_storage_port import FileStorageProtocol
from app.rag.contextual_qa_service import RagService
from app.sql.sql_assistant_service import SqlAssistantService
from app.storage.local_disk_storage import LocalFileStorage
from app.storage.s3_file_storage import S3FileStorage

SESSION_COOKIE_NAME = "margin_session_id"
_SESSION_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{3,128}$")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings validated at startup."""
    return Settings()


def _sanitise_session_token(raw: str | None) -> str | None:
    """Validate or sanitise a session identifier string."""
    if not raw or not raw.strip():
        return None
    candidate = raw.strip()
    if _SESSION_ID_PATTERN.match(candidate):
        return candidate
    cleaned = "".join(ch for ch in candidate if ch.isalnum() or ch in ("-", "_"))[:128]
    return cleaned if len(cleaned) >= 3 else None


def get_owner_session_id(
    request: Request,
    margin_session_cookie: Annotated[
        str | None,
        Cookie(
            alias=SESSION_COOKIE_NAME,
            description="HttpOnly session cookie isolating user documents and conversations.",
        ),
    ] = None,
    x_session_id: Annotated[
        str | None,
        Header(
            alias="X-Session-ID",
            description="Optional session identifier header for API/test clients.",
        ),
    ] = None,
) -> str:
    """Resolve `owner_session_id` from HttpOnly cookie, header, or server-generated token."""
    resolved = (
        _sanitise_session_token(margin_session_cookie)
        or _sanitise_session_token(x_session_id)
        or getattr(request.state, "generated_session_id", None)
    )
    if resolved:
        return str(resolved)
    fresh_token = f"sess_{secrets.token_urlsafe(24)}"
    request.state.generated_session_id = fresh_token
    return fresh_token


async def get_db_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped async database session from the app state's session factory."""
    session_factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    async for session in yield_db_session(session_factory):
        yield session


@lru_cache(maxsize=4)
def _build_s3_storage(
    *,
    bucket: str,
    region: str | None,
    endpoint_url: str | None,
    access_key_id: str | None,
    secret_access_key: str | None,
    key_prefix: str,
) -> S3FileStorage:
    """Reuse a cached `S3FileStorage` and `boto3` client pool per storage configuration."""
    return S3FileStorage(
        bucket=bucket,
        region=region,
        endpoint_url=endpoint_url,
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        key_prefix=key_prefix,
    )


def get_storage(
    settings: Annotated[Settings, Depends(get_settings)],
) -> FileStorageProtocol:
    """Provide the configured file storage adapter (local disk or S3-compatible)."""
    provider = settings.storage_provider.lower().strip()
    if provider == "s3":
        return _build_s3_storage(
            bucket=settings.s3_bucket.strip(),
            region=settings.s3_region.strip() or None,
            endpoint_url=settings.s3_endpoint_url.strip() or None,
            access_key_id=settings.s3_access_key_id.strip() or None,
            secret_access_key=settings.s3_secret_access_key.strip() or None,
            key_prefix=settings.s3_key_prefix,
        )
    return LocalFileStorage(settings.storage_dir)


def get_extractor() -> DocumentExtractorProtocol:
    """Provide the document text extractor."""
    return DefaultDocumentExtractor()


def get_embedding_provider(
    settings: Annotated[Settings, Depends(get_settings)],
) -> EmbeddingProviderProtocol:
    """Provide the hosted Google Gemini embedding adapter."""
    return GeminiEmbeddingProvider(
        api_key=settings.gemini_api_key,
        model_name=settings.gemini_embedding_model,
        output_dimensionality=settings.gemini_embedding_dimension,
        timeout_seconds=settings.gemini_timeout_seconds,
    )


def get_llm_provider(
    settings: Annotated[Settings, Depends(get_settings)],
) -> LLMProviderProtocol:
    """Provide the active text and SQL generation adapter (Grok by default, or Gemini fallback)."""
    provider = settings.llm_provider.lower().strip()
    grok_key = settings.resolved_grok_api_key

    # Use Groq / Grok if configured with a valid key
    if provider in ("grok", "groq") and grok_key:
        return GrokLLMProvider(
            api_key=grok_key,
            model_name=settings.grok_model,
            base_url=settings.grok_api_base,
            timeout_seconds=settings.grok_timeout_seconds,
        )

    # If Grok / Groq is chosen but key is not yet set, fall back to Gemini
    if provider in ("grok", "groq") and not grok_key and settings.gemini_api_key:
        return GeminiLLMProvider(
            api_key=settings.gemini_api_key,
            model_name=settings.gemini_generation_model,
            timeout_seconds=settings.gemini_timeout_seconds,
        )

    if provider in ("grok", "groq"):
        return GrokLLMProvider(
            api_key="",
            model_name=settings.grok_model,
            base_url=settings.grok_api_base,
            timeout_seconds=settings.grok_timeout_seconds,
        )

    return GeminiLLMProvider(
        api_key=settings.gemini_api_key,
        model_name=settings.gemini_generation_model,
        timeout_seconds=settings.gemini_timeout_seconds,
    )


def get_document_repository(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> DocumentRepository:
    """Provide a request-scoped `DocumentRepository`."""
    return DocumentRepository(session)


def get_conversation_repository(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> ConversationRepository:
    """Provide a request-scoped `ConversationRepository`."""
    return ConversationRepository(session)


def get_document_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    document_repo: Annotated[DocumentRepository, Depends(get_document_repository)],
    storage: Annotated[FileStorageProtocol, Depends(get_storage)],
    extractor: Annotated[DocumentExtractorProtocol, Depends(get_extractor)],
    embedding_provider: Annotated[EmbeddingProviderProtocol, Depends(get_embedding_provider)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DocumentService:
    """Assemble `DocumentService` with its required ports and repositories."""
    return DocumentService(
        session=session,
        document_repo=document_repo,
        storage=storage,
        extractor=extractor,
        embedding_provider=embedding_provider,
        settings=settings,
    )


def get_rag_service(
    document_repo: Annotated[DocumentRepository, Depends(get_document_repository)],
    embedding_provider: Annotated[EmbeddingProviderProtocol, Depends(get_embedding_provider)],
    llm_provider: Annotated[LLMProviderProtocol, Depends(get_llm_provider)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> RagService:
    """Assemble `RagService` with vector retrieval and Gemini generation providers."""
    return RagService(
        document_repo=document_repo,
        embedding_provider=embedding_provider,
        llm_provider=llm_provider,
        top_k=settings.retrieval_top_k,
        surrounding_window=settings.selection_surrounding_window,
        embedding_model_name=settings.gemini_embedding_model,
    )


def get_chat_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    document_repo: Annotated[DocumentRepository, Depends(get_document_repository)],
    conversation_repo: Annotated[ConversationRepository, Depends(get_conversation_repository)],
    rag_service: Annotated[RagService, Depends(get_rag_service)],
) -> ChatService:
    """Assemble `ChatService` for managing conversations and grounded Q&A turns."""
    return ChatService(
        session=session,
        document_repo=document_repo,
        conversation_repo=conversation_repo,
        rag_service=rag_service,
    )


def get_sql_assistant_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    llm_provider: Annotated[LLMProviderProtocol, Depends(get_llm_provider)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SqlAssistantService:
    """Assemble `SqlAssistantService` for external database connections and Text-to-SQL."""
    return SqlAssistantService(
        session=session,
        llm_provider=llm_provider,
        settings=settings,
    )
