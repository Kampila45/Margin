"""Application service managing reader conversations and grounded question-answering turns."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.domain_exceptions import (
    ConversationNotFoundError,
    DocumentNotFoundError,
    DocumentNotReadyError,
)
from app.database.conversation_repository import ConversationRepository
from app.database.document_repository import DocumentRepository
from app.database.orm_entities import ConversationMessageModel, ConversationModel
from app.rag.contextual_qa_service import RagService
from app.schemas.conversation_contracts import (
    ChatMessageCreateRequest,
    ChatMessageResponse,
    ChatMode,
    ChatTurnResponse,
    CitationResponse,
    ConversationCreateRequest,
    ConversationDetailResponse,
    ConversationListResponse,
    ConversationSummaryResponse,
    MessageRole,
)
from app.schemas.document_contracts import DocumentStatus


def _parse_document_ids(conversation: ConversationModel) -> list[UUID]:
    """Resolve the list of scoped document UUIDs stored on a `ConversationModel`."""
    parsed: list[UUID] = []
    for raw in conversation.document_ids_json or []:
        try:
            uid = UUID(str(raw))
            if uid not in parsed:
                parsed.append(uid)
        except ValueError:
            continue
    if conversation.document_id not in parsed:
        parsed.insert(0, conversation.document_id)
    return parsed


def _map_summary_model(conversation: ConversationModel) -> ConversationSummaryResponse:
    """Convert `ConversationModel` into `ConversationSummaryResponse` including `document_ids`."""
    return ConversationSummaryResponse(
        id=conversation.id,
        document_id=conversation.document_id,
        document_ids=_parse_document_ids(conversation),
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


def _map_message_model(model: ConversationMessageModel) -> ChatMessageResponse:
    """Convert a persisted `ConversationMessageModel` into a `ChatMessageResponse`."""
    citations = [CitationResponse.model_validate(item) for item in (model.citations_json or [])]
    return ChatMessageResponse(
        id=model.id,
        conversation_id=model.conversation_id,
        role=MessageRole(model.role),
        mode=ChatMode(model.mode),
        content=model.content,
        selected_text=model.selected_text,
        selected_page_number=model.selected_page_number,
        insufficient_context=model.insufficient_context,
        citations=citations,
        created_at=model.created_at,
    )


class ChatService:
    """Coordinate conversation lifecycle, message persistence, and RAG question answering."""

    def __init__(
        self,
        *,
        session: AsyncSession,
        document_repo: DocumentRepository,
        conversation_repo: ConversationRepository,
        rag_service: RagService,
    ) -> None:
        self._session = session
        self._document_repo = document_repo
        self._conversation_repo = conversation_repo
        self._rag_service = rag_service

    async def create_conversation(
        self,
        *,
        owner_session_id: str,
        payload: ConversationCreateRequest,
    ) -> ConversationSummaryResponse:
        """Create a conversation bound to one or more ready session-owned documents."""
        target_ids = payload.document_ids or ([payload.document_id] if payload.document_id else [])
        documents = await self._document_repo.get_many_for_session(target_ids, owner_session_id)
        if len(documents) != len(target_ids):
            raise DocumentNotFoundError(
                "One or more requested documents were not found in your session."
            )
        for doc in documents:
            if doc.status != DocumentStatus.READY.value:
                raise DocumentNotReadyError(
                    f"Document '{doc.original_filename}' is currently '{doc.status}' "
                    "and cannot start a conversation yet."
                )

        primary_doc = next(doc for doc in documents if doc.id == target_ids[0])
        default_title = (
            f"Notes on {primary_doc.original_filename}"
            if len(documents) == 1
            else f"Synthesis: {primary_doc.original_filename} + {len(documents) - 1} more"
        )
        title = (
            payload.title.strip() if payload.title and payload.title.strip() else default_title
        )[:200]

        conversation = await self._conversation_repo.create_conversation(
            owner_session_id=owner_session_id,
            document_id=primary_doc.id,
            document_ids=target_ids,
            title=title,
        )
        await self._session.commit()
        return _map_summary_model(conversation)

    async def list_conversations(
        self,
        owner_session_id: str,
        *,
        document_id: UUID | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ConversationListResponse:
        """Return paginated conversations owned by `owner_session_id`."""
        records, total = await self._conversation_repo.list_for_session(
            owner_session_id,
            document_id=document_id,
            limit=limit,
            offset=offset,
        )
        items = [_map_summary_model(rec) for rec in records]
        return ConversationListResponse(items=items, total=total, limit=limit, offset=offset)

    async def get_conversation(
        self,
        *,
        conversation_id: UUID,
        owner_session_id: str,
    ) -> ConversationDetailResponse:
        """Fetch a conversation and its ordered message transcript."""
        conversation = await self._conversation_repo.get_with_messages(
            conversation_id,
            owner_session_id,
        )
        if conversation is None:
            raise ConversationNotFoundError(
                "The requested conversation was not found in your session."
            )
        return ConversationDetailResponse(
            id=conversation.id,
            document_id=conversation.document_id,
            document_ids=_parse_document_ids(conversation),
            title=conversation.title,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            messages=[_map_message_model(msg) for msg in conversation.messages],
        )

    async def ask_question(
        self,
        *,
        conversation_id: UUID,
        owner_session_id: str,
        payload: ChatMessageCreateRequest,
    ) -> ChatTurnResponse:
        """Execute a grounded RAG query and persist both user and assistant messages."""
        conversation = await self._conversation_repo.get_with_messages(
            conversation_id,
            owner_session_id,
        )
        if conversation is None:
            raise ConversationNotFoundError(
                "The requested conversation was not found in your session."
            )

        active_doc_ids = payload.document_ids or _parse_document_ids(conversation)
        recent_history: list[tuple[str, str]] = []
        pending_q: str | None = None
        for msg in conversation.messages:
            if msg.role == MessageRole.USER.value:
                pending_q = msg.content
            elif msg.role == MessageRole.ASSISTANT.value and pending_q is not None:
                recent_history.append((pending_q, msg.content))
                pending_q = None

        # Perform retrieval and external Gemini API generation before acquiring a row lock
        # or opening a write transaction for message persistence.
        rag_result = await self._rag_service.answer_question(
            owner_session_id=owner_session_id,
            document_id=conversation.document_id,
            document_ids=active_doc_ids,
            question=payload.question,
            mode=payload.mode,
            selection=payload.selection,
            conversation_history=recent_history[-4:],
        )

        locked_conversation = await self._conversation_repo.get_with_messages(
            conversation_id,
            owner_session_id,
            for_update=True,
        )
        if locked_conversation is None:
            raise ConversationNotFoundError(
                "The requested conversation was not found in your session."
            )

        citations_payload = [citation.model_dump(mode="json") for citation in rag_result.citations]
        user_msg, assistant_msg = await self._conversation_repo.append_turn(
            conversation=locked_conversation,
            mode=payload.mode,
            question=payload.question.strip(),
            selected_text=payload.selection.selected_text if payload.selection else None,
            selected_page_number=payload.selection.page_number if payload.selection else None,
            answer_text=rag_result.answer_text,
            insufficient_context=rag_result.insufficient_context,
            citations_payload=citations_payload,
        )
        await self._session.commit()

        return ChatTurnResponse(
            user_message=_map_message_model(user_msg),
            assistant_message=_map_message_model(assistant_msg),
        )

    async def delete_conversation(
        self,
        *,
        conversation_id: UUID,
        owner_session_id: str,
    ) -> None:
        """Delete a conversation owned by `owner_session_id`."""
        conversation = await self._conversation_repo.get_with_messages(
            conversation_id,
            owner_session_id,
        )
        if conversation is None:
            raise ConversationNotFoundError(
                "The requested conversation was not found in your session."
            )
        await self._conversation_repo.delete_conversation(conversation)
        await self._session.commit()
