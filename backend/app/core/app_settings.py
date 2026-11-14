"""Application configuration loaded and validated at startup via Pydantic Settings."""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PG_EMBEDDING_DIMENSION = 768
DEFAULT_CREDENTIAL_ENCRYPTION_SECRET = "margin-default-credential-encryption-secret-change-in-prod"


class AppEnvironment(StrEnum):
    """Deployment environment identifiers governing logging and security defaults."""

    DEVELOPMENT = "Development"
    STAGING = "Staging"
    PRODUCTION = "Production"


class Settings(BaseSettings):
    """Validated runtime configuration for the Margin backend."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = Field(default="Margin API", alias="APP_NAME")
    app_env: AppEnvironment = Field(default=AppEnvironment.DEVELOPMENT, alias="APP_ENV")
    app_debug: bool = Field(default=False, alias="APP_DEBUG")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    cors_origins_raw: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        alias="CORS_ORIGINS",
    )

    database_url: str = Field(
        default="postgresql+asyncpg://margin:margin_dev_password@localhost:5432/margin",
        alias="DATABASE_URL",
    )

    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_generation_model: str = Field(
        default="gemini-flash-latest",
        alias="GEMINI_GENERATION_MODEL",
    )
    gemini_embedding_model: str = Field(
        default="gemini-embedding-001",
        alias="GEMINI_EMBEDDING_MODEL",
    )
    gemini_embedding_dimension: int = Field(
        default=768,
        ge=64,
        le=3072,
        alias="GEMINI_EMBEDDING_DIMENSION",
    )
    gemini_timeout_seconds: float = Field(
        default=30.0,
        gt=1.0,
        le=120.0,
        alias="GEMINI_TIMEOUT_SECONDS",
    )

    # Grok / xAI Configuration for Reasoning & Generation
    llm_provider: str = Field(
        default="grok",
        alias="LLM_PROVIDER",
    )
    xai_api_key: str = Field(
        default="",
        alias="XAI_API_KEY",
    )
    grok_api_key: str = Field(
        default="",
        alias="GROK_API_KEY",
    )
    groq_api_key: str = Field(
        default="",
        alias="GROQ_API_KEY",
    )
    grok_model: str = Field(
        default="grok-2-latest",
        alias="GROK_MODEL",
    )
    grok_api_base: str = Field(
        default="https://api.x.ai/v1",
        alias="GROK_API_BASE",
    )
    grok_timeout_seconds: float = Field(
        default=30.0,
        gt=1.0,
        le=120.0,
        alias="GROK_TIMEOUT_SECONDS",
    )

    storage_dir: Path = Field(default=Path("./storage/uploads"), alias="STORAGE_DIR")
    storage_provider: str = Field(default="local", alias="STORAGE_PROVIDER")
    s3_bucket: str = Field(default="", alias="S3_BUCKET")
    s3_region: str = Field(default="", alias="S3_REGION")
    s3_endpoint_url: str = Field(default="", alias="S3_ENDPOINT_URL")
    s3_access_key_id: str = Field(default="", alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str = Field(default="", alias="S3_SECRET_ACCESS_KEY")
    s3_key_prefix: str = Field(default="documents", alias="S3_KEY_PREFIX")
    max_upload_size_bytes: int = Field(
        default=20_971_520,
        gt=1_024,
        alias="MAX_UPLOAD_SIZE_BYTES",
    )
    max_pages_per_document: int = Field(
        default=150,
        ge=1,
        le=2_000,
        alias="MAX_PAGES_PER_DOCUMENT",
    )
    max_documents_per_session: int = Field(
        default=25,
        ge=1,
        le=500,
        alias="MAX_DOCUMENTS_PER_SESSION",
    )

    chunk_target_chars: int = Field(
        default=1_200,
        ge=200,
        le=8_000,
        alias="CHUNK_TARGET_CHARS",
    )
    chunk_overlap_chars: int = Field(
        default=200,
        ge=0,
        le=2_000,
        alias="CHUNK_OVERLAP_CHARS",
    )
    retrieval_top_k: int = Field(
        default=6,
        ge=1,
        le=20,
        alias="RETRIEVAL_TOP_K",
    )
    selection_surrounding_window: int = Field(
        default=1,
        ge=0,
        le=5,
        alias="SELECTION_SURROUNDING_WINDOW",
    )

    credential_encryption_secret: str = Field(
        default=DEFAULT_CREDENTIAL_ENCRYPTION_SECRET,
        alias="CREDENTIAL_ENCRYPTION_SECRET",
    )
    sql_allow_private_hosts: bool = Field(
        default=False,
        alias="SQL_ALLOW_PRIVATE_HOSTS",
    )
    sql_query_timeout_seconds: float = Field(
        default=5.0,
        gt=0.5,
        le=30.0,
        alias="SQL_QUERY_TIMEOUT_SECONDS",
    )
    sql_max_rows: int = Field(
        default=100,
        ge=1,
        le=500,
        alias="SQL_MAX_ROWS",
    )

    @field_validator("app_env", mode="before")
    @classmethod
    def normalize_app_env_casing(cls, value: object) -> object:
        """Accept title-case or lowercase environment strings cleanly."""
        if isinstance(value, str):
            return value.strip().capitalize()
        return value

    @field_validator("gemini_embedding_model")
    @classmethod
    def upgrade_deprecated_embedding_model(cls, value: str) -> str:
        """Upgrade retired `text-embedding-004` model identifiers to `gemini-embedding-001`."""
        cleaned = value.strip()
        if cleaned in {"text-embedding-004", "models/text-embedding-004"}:
            return "gemini-embedding-001"
        return cleaned

    @field_validator("database_url")
    @classmethod
    def normalize_asyncpg_database_url(cls, value: str) -> str:
        """Normalize standard `postgresql://` and Neon SSL query params for SQLAlchemy `asyncpg`."""
        cleaned = value.strip().strip("'").strip('"')
        if cleaned.startswith("postgres://"):
            cleaned = "postgresql+asyncpg://" + cleaned[len("postgres://") :]
        elif cleaned.startswith("postgresql://"):
            cleaned = "postgresql+asyncpg://" + cleaned[len("postgresql://") :]

        # asyncpg expects `ssl=require` rather than libpq's `sslmode` / `channel_binding`.
        if "postgresql+asyncpg://" in cleaned and "?" in cleaned:
            base, query = cleaned.split("?", 1)
            params: list[str] = []
            for part in query.split("&"):
                if part.startswith("sslmode="):
                    params.append("ssl=" + part.split("=", 1)[1])
                elif part.startswith("channel_binding="):
                    continue
                elif part:
                    params.append(part)
            cleaned = f"{base}?{'&'.join(params)}" if params else base
        return cleaned

    @field_validator("chunk_overlap_chars")
    @classmethod
    def validate_overlap_smaller_than_target(cls, value: int, info: object) -> int:
        """Prevent infinite chunking loops when overlap equals or exceeds target size."""
        data = getattr(info, "data", {})
        target = data.get("chunk_target_chars", 1_200)
        if isinstance(target, int) and value >= target:
            raise ValueError("CHUNK_OVERLAP_CHARS must be strictly less than CHUNK_TARGET_CHARS")
        return value

    @model_validator(mode="after")
    def validate_production_and_vector_invariants(self) -> Settings:
        """Enforce safe non-development credentials and pgvector column dimension compatibility."""
        if self.app_env in {AppEnvironment.STAGING, AppEnvironment.PRODUCTION}:
            secret = self.credential_encryption_secret.strip()
            if not secret or secret == DEFAULT_CREDENTIAL_ENCRYPTION_SECRET:
                raise ValueError(
                    "CREDENTIAL_ENCRYPTION_SECRET must be set to a unique non-default "
                    f"secret in {self.app_env.value}."
                )

        provider = self.storage_provider.lower().strip()
        if provider not in {"local", "s3"}:
            raise ValueError("STORAGE_PROVIDER must be either 'local' or 's3'.")

        if provider == "s3":
            bucket = self.s3_bucket.strip()
            if not bucket or bucket == "your-bucket":
                raise ValueError(
                    "S3_BUCKET must be configured with a real bucket name when STORAGE_PROVIDER=s3"
                )
            endpoint = self.s3_endpoint_url.strip()
            if endpoint:
                if "<" in endpoint or ">" in endpoint:
                    raise ValueError(
                        "S3_ENDPOINT_URL still contains a template placeholder; "
                        "set the real endpoint URL."
                    )
                if not endpoint.startswith(("https://", "http://")):
                    raise ValueError("S3_ENDPOINT_URL must start with https:// or http://.")

            has_access = bool(self.s3_access_key_id.strip())
            has_secret = bool(self.s3_secret_access_key.strip())
            if has_access != has_secret:
                raise ValueError(
                    "Both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together "
                    "when STORAGE_PROVIDER=s3."
                )
            if endpoint and not (has_access and has_secret):
                raise ValueError(
                    "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when using a "
                    "custom S3_ENDPOINT_URL."
                )
            if not self.s3_region.strip() and not endpoint:
                raise ValueError(
                    "S3_REGION or S3_ENDPOINT_URL is required when STORAGE_PROVIDER=s3."
                )

        if (
            self.database_url.startswith("postgresql")
            and self.gemini_embedding_dimension != PG_EMBEDDING_DIMENSION
        ):
            raise ValueError(
                f"GEMINI_EMBEDDING_DIMENSION must be {PG_EMBEDDING_DIMENSION} to match the "
                "PostgreSQL document_chunks.embedding VECTOR(768) column unless migrated."
            )
        return self

    @property
    def resolved_grok_api_key(self) -> str:
        """Resolve Groq / xAI API key from GROQ_API_KEY, XAI_API_KEY, or GROK_API_KEY."""
        key = self.groq_api_key.strip() or self.xai_api_key.strip() or self.grok_api_key.strip()
        placeholders = {
            "your-xai-api-key-here",
            "your-grok-api-key-here",
            "your-groq-api-key-here",
            "your-key-here",
        }
        if key in placeholders:
            return ""
        return key

    @property
    def cors_origins(self) -> list[str]:
        """Parse comma-separated CORS origins into a clean list."""
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]
