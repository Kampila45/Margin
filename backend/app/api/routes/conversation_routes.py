"""Thin HTTP route handlers for conversations and grounded question answering."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.chat.conversation_orchestrator import ChatService
from app.core.dependency_container import get_chat_service, get_owner_session_id
from app.schemas.conversation_contracts import (
    ChatMessageCreateRequest,
    ChatTurnResponse,
    ConversationCreateRequest,
    ConversationDetailResponse,
    ConversationListResponse,
    ConversationSummaryResponse,
)

router = APIRouter(prefix="/api/v1/conversations", tags=["Conversations"])


@router.post(
    "",
    response_model=ConversationSummaryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new conversation for a document",
)
async def create_conversation(
    payload: ConversationCreateRequest,
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    chat_service: Annotated[ChatService, Depends(get_chat_service)],
) -> ConversationSummaryResponse:
    """Start a new conversation thread anchored to an indexed document."""
    return await chat_service.create_conversation(
        owner_session_id=owner_session_id,
        payload=payload,
    )


@router.get(
    "",
    response_model=ConversationListResponse,
    summary="List conversations in the current session",
)
async def list_conversations(
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    chat_service: Annotated[ChatService, Depends(get_chat_service)],
    document_id: Annotated[
        UUID | None,
        Query(description="Optional filter to list conversations for a single document."),
    ] = None,
    limit: Annotated[
        int,
        Query(ge=1, le=100, description="Maximum number of conversations to return."),
    ] = 50,
    offset: Annotated[
        int,
        Query(ge=0, description="Number of conversations to skip for pagination."),
    ] = 0,
) -> ConversationListResponse:
    """List paginated conversations belonging to the caller's session."""
    return await chat_service.list_conversations(
        owner_session_id,
        document_id=document_id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{conversation_id}",
    response_model=ConversationDetailResponse,
    summary="Get conversation details and message history",
)
async def get_conversation(
    conversation_id: Annotated[UUID, Path(description="Unique conversation identifier.")],
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    chat_service: Annotated[ChatService, Depends(get_chat_service)],
) -> ConversationDetailResponse:
    """Return conversation metadata and ordered message transcript with citations."""
    return await chat_service.get_conversation(
        conversation_id=conversation_id,
        owner_session_id=owner_session_id,
    )


@router.post(
    "/{conversation_id}/messages",
    response_model=ChatTurnResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ask a grounded question in a conversation",
)
async def create_message(
    conversation_id: Annotated[UUID, Path(description="Unique conversation identifier.")],
    payload: ChatMessageCreateRequest,
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    chat_service: Annotated[ChatService, Depends(get_chat_service)],
) -> ChatTurnResponse:
    """Submit a `document_qa` or `selection_qa` question and receive a cited answer."""
    return await chat_service.ask_question(
        conversation_id=conversation_id,
        owner_session_id=owner_session_id,
        payload=payload,
    )


@router.delete(
    "/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a conversation and its message history",
)
async def delete_conversation(
    conversation_id: Annotated[UUID, Path(description="Unique conversation identifier.")],
    owner_session_id: Annotated[str, Depends(get_owner_session_id)],
    chat_service: Annotated[ChatService, Depends(get_chat_service)],
) -> Response:
    """Delete a conversation thread owned by the caller's session."""
    await chat_service.delete_conversation(
        conversation_id=conversation_id,
        owner_session_id=owner_session_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
