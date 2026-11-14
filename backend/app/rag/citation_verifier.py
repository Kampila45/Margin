"""Citation extraction and verification against retrieved source chunks."""

from __future__ import annotations

import re

from app.database.document_repository import RetrievedChunkRecord
from app.rag.grounded_prompt_builder import INSUFFICIENT_CONTEXT_TOKEN
from app.schemas.conversation_contracts import CitationResponse

_CITATION_BRACKET_RE = re.compile(r"\[(\d{1,3}(?:\s*(?:,|[-–—‑])\s*\d{1,3})*)\]")
_ALT_CITATION_MARKER_RE = re.compile(
    r"(?:"
    r"【\s*(\d{1,3}(?:\s*(?:,|[-–—‑])\s*\d{1,3})*)(?:\s*†[^】]*)?\s*】"
    r"|"
    r"\[\s*(\d{1,3}(?:\s*(?:,|[-–—‑])\s*\d{1,3})*)\s*†[^\]\n]*\]"
    r")"
    r"(?:[ \t]+([.,;:!?]))?"
)


def normalize_citation_markers(answer_text: str) -> str:
    """Convert provider-native citation tags (e.g. `【1†L1-L4】`) into `[1]` markers."""
    if not answer_text or ("【" not in answer_text and "†" not in answer_text):
        return answer_text

    def _replace(match: re.Match[str]) -> str:
        indices = match.group(1) or match.group(2)
        punctuation = match.group(3) or ""
        return f"[{indices}]{punctuation}"

    return _ALT_CITATION_MARKER_RE.sub(_replace, answer_text)


def _expand_citation_group(group_text: str) -> list[int]:
    """Expand a bracket expression like `1`, `1, 3`, or `1-4` into ordered integers."""
    expanded: list[int] = []
    for part in group_text.split(","):
        token = part.strip()
        range_match = re.fullmatch(r"(\d{1,3})\s*[-–—‑]\s*(\d{1,3})", token)
        if range_match:
            start = int(range_match.group(1))
            end = int(range_match.group(2))
            if start <= end and (end - start) <= 20:
                expanded.extend(range(start, end + 1))
            continue
        if token.isdigit():
            expanded.append(int(token))
    return expanded


def detect_insufficient_context(raw_answer: str) -> tuple[bool, str]:
    """Detect whether the model signalled insufficient document context and clean the prefix."""
    stripped = raw_answer.strip()
    if stripped.startswith(INSUFFICIENT_CONTEXT_TOKEN):
        cleaned = stripped[len(INSUFFICIENT_CONTEXT_TOKEN) :].lstrip(": -").strip()
        if not cleaned:
            cleaned = (
                "The uploaded document does not contain enough information to answer this question."
            )
        return True, cleaned
    return False, stripped


def extract_verified_citations(
    answer_text: str,
    retrieved_chunks: list[RetrievedChunkRecord],
    *,
    max_excerpt_chars: int = 1600,
) -> list[CitationResponse]:
    """Map `[n]` markers in `answer_text` to verified retrieved chunks; drop phantom markers."""
    if not answer_text or not retrieved_chunks:
        return []

    normalized_answer = normalize_citation_markers(answer_text)
    seen_indices: set[int] = set()
    verified: list[CitationResponse] = []

    for match in _CITATION_BRACKET_RE.finditer(normalized_answer):
        for marker_num in _expand_citation_group(match.group(1)):
            if marker_num < 1 or marker_num > len(retrieved_chunks):
                # Ignore out-of-range citation markers rather than fabricating sources.
                continue
            if marker_num in seen_indices:
                continue
            seen_indices.add(marker_num)

            chunk = retrieved_chunks[marker_num - 1]
            excerpt = chunk.text_content.strip()
            if len(excerpt) > max_excerpt_chars:
                excerpt = excerpt[: max_excerpt_chars - 1].rstrip() + "…"

            verified.append(
                CitationResponse(
                    citation_index=marker_num,
                    chunk_id=chunk.chunk_id,
                    document_id=chunk.document_id,
                    document_filename=chunk.document_filename,
                    chunk_index=chunk.chunk_index,
                    page_number=chunk.page_number,
                    excerpt=excerpt,
                    score=chunk.score,
                )
            )

    return verified
