"""Unit tests for deterministic text normalisation and page-aware passage chunking."""

from __future__ import annotations

import pytest

from app.documents.text_extractor import ExtractedPage
from app.rag.passage_chunker import chunk_extracted_pages, normalise_text


def test_normalise_text_repairs_hyphenation_and_collapses_whitespace() -> None:
    """Verify hyphenated line wraps are rejoined and redundant spaces are collapsed."""
    raw = "The docu-\nment   contains\t\timportant\n\n\n\nfindings."
    result = normalise_text(raw)
    assert result == "The document contains important\n\nfindings."


def test_chunk_extracted_pages_preserves_page_numbers_and_overlap() -> None:
    """Verify chunking splits long pages on clean boundaries while retaining page attribution."""
    page_one_text = (
        "Paragraph one introduces the Margin reading architecture and its core design goals. "
        "It ensures that every extracted passage retains its original page attribution.\n\n"
        "Paragraph two explains how overlapping windows preserve semantic continuity across "
        "adjacent chunks so questions spanning two sentences are still answered accurately."
    )
    page_two_text = "Second page summary with concise conclusions."

    pages = [
        ExtractedPage(page_number=1, text=page_one_text),
        ExtractedPage(page_number=2, text=page_two_text),
    ]

    chunks = chunk_extracted_pages(pages, target_chars=140, overlap_chars=30)

    assert len(chunks) >= 3
    assert chunks[0].page_number == 1
    assert chunks[0].chunk_index == 0
    assert chunks[-1].page_number == 2
    assert chunks[-1].text_content == page_two_text
    for idx, chunk in enumerate(chunks):
        assert chunk.chunk_index == idx
        assert chunk.token_estimate > 0


def test_chunk_extracted_pages_rejects_invalid_overlap() -> None:
    """Verify overlap greater than or equal to target size raises ValueError."""
    pages = [ExtractedPage(page_number=1, text="Sample text")]
    with pytest.raises(ValueError, match="overlap_chars"):
        chunk_extracted_pages(pages, target_chars=100, overlap_chars=100)
