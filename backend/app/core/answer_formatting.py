"""Helpers for normalizing conversational assistant responses before returning them to the UI."""

from __future__ import annotations

import re

_STANDALONE_FOLLOWUP_HEADING_RE = re.compile(
    r"(?im)^[ \t]*(?:#{1,6}[ \t]+)?\*{0,2}"
    r"follow[- ]?up(?:\s+question)?s?\*{0,2}[ \t]*[:：]?[ \t]*\*{0,2}[ \t]*\n+"
)
_INLINE_FOLLOWUP_PREFIX_RE = re.compile(
    r"(?im)^[ \t]*(?:[-*+]|\d+[.)])?[ \t]*(?:#{1,6}[ \t]+)?\*{0,2}"
    r"follow[- ]?up(?:\s+question)?s?\*{0,2}[ \t]*[:：]\*{0,2}[ \t]*"
)


def strip_followup_label_prefixes(answer_text: str) -> str:
    """Remove redundant `Follow-up:` / `Follow-up question:` line prefixes from AI answers."""
    if not answer_text:
        return answer_text
    cleaned = _STANDALONE_FOLLOWUP_HEADING_RE.sub("", answer_text)
    cleaned = _INLINE_FOLLOWUP_PREFIX_RE.sub("", cleaned)
    return cleaned.strip()
