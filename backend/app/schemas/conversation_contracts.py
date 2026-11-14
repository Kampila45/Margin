"""Pydantic contracts and enums for conversations, messages, selections, and citations."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChatMode(StrEnum):
    """Question-answering interaction modes supported by Margin."""

    DOCUMENT_QA = "document_qa"
    SELECTION_QA = "selection_qa"


class MessageRole(StrEnum):
    """Speaker role in a conversation transcript."""

    USER = "user"
    ASSISTANT = "assistant"


class SelectionInput(BaseModel):
    """Highlighted passage context passed when `mode` is `selection_qa`."""

    document_id: UUID | None = Field(
        default=None,
        description="Optional document ID where the passage was selected.",
    )
    selected_text: str = Field(
        min_length=1,
        max_length=10_000,
        description="Exact passage highlighted by the reader.",
    )
    page_number: int | None = Field(
        default=None,
        ge=1,
        description="Optional 1-based page number where the selection occurred.",
    )
    start_offset: int | None = Field(
        default=None,
        ge=0,
        description="Optional character start offset within the page or chunk.",
    )
    end_offset: int | None = Field(
        default=None,
        ge=0,
        description="Optional character end offset within the page or chunk.",
    )


class ChatMessageCreateRequest(BaseModel):
    """Request payload for asking a grounded question in a conversation."""

    question: str = Field(
        min_length=1,
        max_length=4_000,
        description="User question about the document(s) or highlighted passage.",
    )
    mode: ChatMode = Field(
        default=ChatMode.DOCUMENT_QA,
        description="Whether to query whole document(s) or prioritize a highlighted passage.",
    )
    document_ids: list[UUID] | None = Field(
        default=None,
        description="Optional override list of active document IDs to scope retrieval.",
    )
    selection: SelectionInput | None = Field(
        default=None,
        description="Required when `mode` is `selection_qa`.",
    )


class CitationResponse(BaseModel):
    """Verified source citation linking an answer back to a specific document chunk."""

    citation_index: int = Field(ge=1, description="1-based citation marker number `[n]`.")
    chunk_id: UUID
    document_id: UUID
    document_filename: str
    chunk_index: int = Field(ge=0)
    page_number: int | None = None
    excerpt: str
    score: float | None = None


class ChatMessageResponse(BaseModel):
    """Single message turn in a conversation."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    role: MessageRole
    mode: ChatMode
    content: str
    selected_text: str | None = None
    selected_page_number: int | None = None
    insufficient_context: bool = False
    citations: list[CitationResponse] = Field(default_factory=list)
    created_at: datetime


class ChatTurnResponse(BaseModel):
    """Response returned after submitting a user question and generating a grounded answer."""

    user_message: ChatMessageResponse
    assistant_message: ChatMessageResponse


class ConversationCreateRequest(BaseModel):
    """Request payload to start a new conversation scoped to one or more documents."""

    document_id: UUID | None = Field(
        default=None,
        description="Primary document ID (convenience when starting from a single document).",
    )
    document_ids: list[UUID] | None = Field(
        default=None,
        description="Collection of document IDs in scope for multi-document synthesis.",
    )
    title: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def ensure_at_least_one_document(self) -> ConversationCreateRequest:
        """Require either `document_id` or a non-empty `document_ids` list."""
        resolved: list[UUID] = []
        if self.document_ids:
            for doc_id in self.document_ids:
                if doc_id not in resolved:
                    resolved.append(doc_id)
        if self.document_id is not None and self.document_id not in resolved:
            resolved.insert(0, self.document_id)
        if not resolved:
            raise ValueError("Provide at least one document via `document_id` or `document_ids`.")
        self.document_id = resolved[0]
        self.document_ids = resolved
        return self


class ConversationSummaryResponse(BaseModel):
    """Metadata summary of a conversation."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_id: UUID
    document_ids: list[UUID] = Field(default_factory=list)
    title: str
    created_at: datetime
    updated_at: datetime


class ConversationListResponse(BaseModel):
    """Paginated and session-scoped list of conversations."""

    items: list[ConversationSummaryResponse]
    total: int
    limit: int = 50
    offset: int = 0


class ConversationDetailResponse(BaseModel):
    """Full conversation metadata and ordered message transcript."""

    id: UUID
    document_id: UUID
    document_ids: list[UUID] = Field(default_factory=list)
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessageResponse]
