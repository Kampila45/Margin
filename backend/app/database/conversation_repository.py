"""Data-access repository for reader conversations and grounded message turns."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database.orm_entities import ConversationMessageModel, ConversationModel
from app.schemas.conversation_contracts import ChatMode, MessageRole


class ConversationRepository:
    """Session-scoped persistence operations for conversations and messages."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_conversation(
        self,
        *,
        owner_session_id: str,
        document_id: UUID,
        document_ids: Sequence[UUID] | None = None,
        title: str,
    ) -> ConversationModel:
        """Create a new conversation anchored to `document_id`, `document_ids`, and session."""
        scoped_ids = [str(uid) for uid in (document_ids or [document_id])]
        conversation = ConversationModel(
            owner_session_id=owner_session_id,
            document_id=document_id,
            document_ids_json=scoped_ids,
            title=title,
        )
        self._session.add(conversation)
        await self._session.flush()
        return conversation

    async def list_for_session(
        self,
        owner_session_id: str,
        *,
        document_id: UUID | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ConversationModel], int]:
        """Return paginated conversations owned by `owner_session_id`, newest activity first."""
        base_stmt = select(ConversationModel).where(
            ConversationModel.owner_session_id == owner_session_id
        )
        if document_id is not None:
            base_stmt = base_stmt.where(ConversationModel.document_id == document_id)

        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total = int((await self._session.execute(count_stmt)).scalar_one())

        stmt = base_stmt.order_by(ConversationModel.updated_at.desc()).limit(limit).offset(offset)
        result = await self._session.execute(stmt)
        return list(result.scalars().all()), total

    async def get_with_messages(
        self,
        conversation_id: UUID,
        owner_session_id: str,
        *,
        for_update: bool = False,
    ) -> ConversationModel | None:
        """Fetch a conversation and its ordered message transcript if owned by the session."""
        stmt = (
            select(ConversationModel)
            .options(selectinload(ConversationModel.messages))
            .where(
                ConversationModel.id == conversation_id,
                ConversationModel.owner_session_id == owner_session_id,
            )
        )
        bind = self._session.get_bind()
        if for_update and bind is not None and bind.dialect.name == "postgresql":
            stmt = stmt.with_for_update()

        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def append_turn(
        self,
        *,
        conversation: ConversationModel,
        mode: ChatMode,
        question: str,
        selected_text: str | None,
        selected_page_number: int | None,
        answer_text: str,
        insufficient_context: bool,
        citations_payload: list[dict[str, Any]],
    ) -> tuple[ConversationMessageModel, ConversationMessageModel]:
        """Append the user question and assistant grounded answer with monotonic timestamps."""
        user_time = datetime.now(UTC)
        # Offset assistant timestamp by 1 millisecond so ordering by created_at is deterministic.
        assistant_time = user_time + timedelta(milliseconds=1)

        user_msg = ConversationMessageModel(
            conversation_id=conversation.id,
            role=MessageRole.USER.value,
            mode=mode.value,
            content=question,
            selected_text=selected_text,
            selected_page_number=selected_page_number,
            insufficient_context=False,
            citations_json=[],
            created_at=user_time,
        )
        assistant_msg = ConversationMessageModel(
            conversation_id=conversation.id,
            role=MessageRole.ASSISTANT.value,
            mode=mode.value,
            content=answer_text,
            selected_text=selected_text,
            selected_page_number=selected_page_number,
            insufficient_context=insufficient_context,
            citations_json=citations_payload,
            created_at=assistant_time,
        )
        conversation.updated_at = assistant_time
        self._session.add_all([user_msg, assistant_msg])
        await self._session.flush()
        return user_msg, assistant_msg

    async def delete_conversation(self, conversation: ConversationModel) -> None:
        """Delete a conversation and cascade-delete its message history."""
        await self._session.delete(conversation)
        await self._session.flush()
