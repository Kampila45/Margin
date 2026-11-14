"""Deterministic text normalisation and paragraph/sentence-aware passage chunker."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.ports.document_extractor_port import ExtractedPage


@dataclass(frozen=True, slots=True)
class ChunkCandidate:
    """In-memory chunk representation before database persistence and embedding."""

    chunk_index: int
    page_number: int | None
    start_char_offset: int
    end_char_offset: int
    text_content: str
    token_estimate: int


def normalise_text(raw_text: str) -> str:
    """Normalise Unicode, repair hyphenated line wraps, and collapse noisy whitespace."""
    if not raw_text:
        return ""
    normalised = unicodedata.normalize("NFKC", raw_text)
    normalised = normalised.replace("\r\n", "\n").replace("\r", "\n")
    # Rejoin words split by hyphenation at line breaks (e.g. "inter-\naction" -> "interaction").
    normalised = re.sub(r"([a-zA-Z])-\n([a-zA-Z])", r"\1\2", normalised)
    # Collapse horizontal whitespace while preserving paragraph breaks.
    normalised = re.sub(r"[ \t\f\v]+", " ", normalised)
    normalised = re.sub(r"\n{3,}", "\n\n", normalised)
    return normalised.strip()


def _estimate_tokens(text: str) -> int:
    """Approximate token count (~4 characters per token) for metadata and prompt budgeting."""
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def _find_split_boundary(text: str, start: int, max_end: int) -> int:
    """Prefer paragraph, newline, sentence, or word boundaries over mid-word splits."""
    if max_end >= len(text):
        return len(text)

    window = text[start:max_end]
    min_acceptable = max(1, len(window) // 2)

    for separator in ("\n\n", "\n", ". ", "? ", "! ", "; ", " "):
        pos = window.rfind(separator)
        if pos >= min_acceptable:
            return start + pos + len(separator)

    return max_end


def chunk_extracted_pages(
    pages: list[ExtractedPage],
    *,
    target_chars: int = 1_200,
    overlap_chars: int = 200,
) -> list[ChunkCandidate]:
    """Split extracted pages into overlapping chunks while preserving page attribution."""
    if target_chars <= 0:
        raise ValueError("target_chars must be positive")
    if overlap_chars < 0 or overlap_chars >= target_chars:
        raise ValueError("overlap_chars must be in [0, target_chars)")

    chunks: list[ChunkCandidate] = []
    chunk_idx = 0

    for page in pages:
        cleaned_page = normalise_text(page.text)
        if not cleaned_page:
            continue

        page_len = len(cleaned_page)
        cursor = 0
        while cursor < page_len:
            tentative_end = min(page_len, cursor + target_chars)
            actual_end = _find_split_boundary(cleaned_page, cursor, tentative_end)
            if actual_end <= cursor:
                actual_end = tentative_end

            raw_slice = cleaned_page[cursor:actual_end].strip()
            if raw_slice:
                chunks.append(
                    ChunkCandidate(
                        chunk_index=chunk_idx,
                        page_number=page.page_number,
                        start_char_offset=cursor,
                        end_char_offset=actual_end,
                        text_content=raw_slice,
                        token_estimate=_estimate_tokens(raw_slice),
                    )
                )
                chunk_idx += 1

            if actual_end >= page_len:
                break

            next_cursor = max(cursor + 1, actual_end - overlap_chars)
            # Align overlap start to a word boundary when possible so chunks start cleanly.
            while (
                next_cursor < actual_end
                and next_cursor > cursor + 1
                and not cleaned_page[next_cursor - 1].isspace()
            ):
                next_cursor += 1
            if next_cursor >= actual_end:
                next_cursor = max(cursor + 1, actual_end - overlap_chars)
            cursor = next_cursor

    return chunks
