"""Unit tests for grounded prompt construction and citation verification."""

from __future__ import annotations

import uuid

from app.database.document_repository import RetrievedChunkRecord
from app.rag.citation_verifier import (
    detect_insufficient_context,
    extract_verified_citations,
    normalize_citation_markers,
)
from app.rag.grounded_prompt_builder import (
    INSUFFICIENT_CONTEXT_TOKEN,
    PromptSourceChunk,
    build_grounded_qa_prompt,
)
from app.schemas.conversation_contracts import ChatMode


def test_build_grounded_qa_prompt_includes_selection_block_in_selection_mode() -> None:
    """Verify `selection_qa` prompts wrap the highlighted passage in `<selected_passage>` tags."""
    sources = [
        PromptSourceChunk(
            citation_index=1,
            document_filename="paper.pdf",
            page_number=4,
            chunk_index=7,
            text_content="The experiment achieved 94.2% accuracy on the benchmark dataset.",
        )
    ]
    prompt = build_grounded_qa_prompt(
        mode=ChatMode.SELECTION_QA,
        question="What accuracy did this experiment achieve?",
        sources=sources,
        selected_text="achieved 94.2% accuracy",
        selected_page_number=4,
    )

    assert "<mode>selection_qa</mode>" in prompt
    assert '<selected_passage page="4">' in prompt
    assert "achieved 94.2% accuracy" in prompt
    assert '<source index="1" document="paper.pdf" page="4" chunk_index="7">' in prompt
    assert "<user_question>\nWhat accuracy did this experiment achieve?\n</user_question>" in prompt


def test_extract_verified_citations_filters_out_of_range_and_duplicate_markers() -> None:
    """Verify `[n]` markers map to retrieved chunks and phantom markers like `[99]` are dropped."""
    doc_id = uuid.uuid4()
    chunk_1_id = uuid.uuid4()
    chunk_2_id = uuid.uuid4()

    retrieved = [
        RetrievedChunkRecord(
            chunk_id=chunk_1_id,
            document_id=doc_id,
            document_filename="report.pdf",
            chunk_index=0,
            page_number=1,
            text_content="Revenue grew by 18% in Q3 driven by enterprise adoption.",
            score=0.92,
        ),
        RetrievedChunkRecord(
            chunk_id=chunk_2_id,
            document_id=doc_id,
            document_filename="report.pdf",
            chunk_index=1,
            page_number=2,
            text_content="Operating margin improved to 24% after infrastructure optimization.",
            score=0.87,
        ),
    ]

    answer = (
        "Revenue grew by 18% in Q3 [1], while operating margin reached 24% [2]. "
        "A repeated reference [1] and an unverified phantom marker [9] are handled safely."
    )

    citations = extract_verified_citations(answer, retrieved)

    assert len(citations) == 2
    assert citations[0].citation_index == 1
    assert citations[0].chunk_id == chunk_1_id
    assert citations[0].page_number == 1
    assert citations[1].citation_index == 2
    assert citations[1].chunk_id == chunk_2_id
    assert citations[1].page_number == 2


def test_detect_insufficient_context_strips_sentinel_prefix() -> None:
    """Verify answers beginning with `INSUFFICIENT_DOCUMENT_CONTEXT` set the boolean flag."""
    raw = f"{INSUFFICIENT_CONTEXT_TOKEN}: The document does not mention Q4 projections."
    flag, cleaned = detect_insufficient_context(raw)

    assert flag is True
    assert cleaned == "The document does not mention Q4 projections."


def test_extract_verified_citations_expands_grouped_and_range_markers() -> None:
    """Verify `[1-2]` and `[1, 2]` expand deterministically against retrieved chunks."""
    doc_id = uuid.uuid4()
    retrieved = [
        RetrievedChunkRecord(
            chunk_id=uuid.uuid4(),
            document_id=doc_id,
            document_filename="doc.pdf",
            chunk_index=0,
            page_number=1,
            text_content="First passage content.",
            score=0.95,
        ),
        RetrievedChunkRecord(
            chunk_id=uuid.uuid4(),
            document_id=doc_id,
            document_filename="doc.pdf",
            chunk_index=1,
            page_number=2,
            text_content="Second passage content.",
            score=0.90,
        ),
    ]

    citations = extract_verified_citations("Summary based on [1‑2] and [1, 9].", retrieved)
    assert [c.citation_index for c in citations] == [1, 2]
    assert citations[0].chunk_id == retrieved[0].chunk_id
    assert citations[1].chunk_id == retrieved[1].chunk_id


def test_grounded_qa_prompt_includes_recent_history_and_followup_rule() -> None:
    """Verify conversation history and follow-up guidance are present in grounded QA prompts."""
    from app.rag.document_agent_service import DOC_AGENT_SYSTEM_INSTRUCTION
    from app.rag.grounded_prompt_builder import SYSTEM_INSTRUCTION

    prompt = build_grounded_qa_prompt(
        mode=ChatMode.DOCUMENT_QA,
        question="Yes, tell me about the budget.",
        sources=[],
        conversation_history=[
            (
                "What does this proposal cover?",
                "It covers infrastructure upgrades [1]. Would you like details on the budget?",
            )
        ],
    )

    assert "<conversation_history>" in prompt
    assert "What does this proposal cover?" in prompt
    assert "follow-up question" in SYSTEM_INSTRUCTION.lower()
    assert "follow-up" in DOC_AGENT_SYSTEM_INSTRUCTION.lower()


def test_normalize_citation_markers_and_extract_verified_citations_from_provider_tags() -> None:
    """Verify provider-native `【1†L1-L4】` / `[2†L31-L38]` tags normalize and verify cleanly."""
    doc_id = uuid.uuid4()
    retrieved = [
        RetrievedChunkRecord(
            chunk_id=uuid.uuid4(),
            document_id=doc_id,
            document_filename="warma.pdf",
            chunk_index=0,
            page_number=1,
            text_content="Regulate and manage the use of Zambia's water resources.",
            score=0.95,
        ),
        RetrievedChunkRecord(
            chunk_id=uuid.uuid4(),
            document_id=doc_id,
            document_filename="warma.pdf",
            chunk_index=1,
            page_number=2,
            text_content="WARMA is an Equal Opportunity Employer inviting applications.",
            score=0.90,
        ),
    ]

    raw = (
        "WARMA manages water resources 【1†L1-L4】 . "
        "It is an Equal Opportunity Employer [2†L31-L38] , inviting applications."
    )
    normalized = normalize_citation_markers(raw)
    assert normalized == (
        "WARMA manages water resources [1]. "
        "It is an Equal Opportunity Employer [2], inviting applications."
    )

    citations = extract_verified_citations(raw, retrieved)
    assert [c.citation_index for c in citations] == [1, 2]
    assert citations[0].chunk_id == retrieved[0].chunk_id
    assert citations[1].chunk_id == retrieved[1].chunk_id
