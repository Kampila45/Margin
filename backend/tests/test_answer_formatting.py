"""Unit tests for assistant answer follow-up label normalization."""

from app.core.answer_formatting import strip_followup_label_prefixes


def test_strip_followup_label_prefixes_removes_bold_and_plain_labels() -> None:
    raw = (
        "The cover letter mentions Nyasha Kampila [1].\n\n"
        "**Follow-up:** Would you like me to locate any other personal details?"
    )
    assert strip_followup_label_prefixes(raw) == (
        "The cover letter mentions Nyasha Kampila [1].\n\n"
        "Would you like me to locate any other personal details?"
    )


def test_strip_followup_label_prefixes_handles_question_heading_and_variants() -> None:
    raw = "Returned 12 orders.\n\n**Follow-up question:**\nWould you like a breakdown by region?"
    assert strip_followup_label_prefixes(raw) == (
        "Returned 12 orders.\n\nWould you like a breakdown by region?"
    )

    heading_variant = "Summary [1].\n\n### Follow up:\nShall I compare Q1 and Q2?"
    assert strip_followup_label_prefixes(heading_variant) == (
        "Summary [1].\n\nShall I compare Q1 and Q2?"
    )


def test_strip_followup_label_prefixes_preserves_mid_sentence_followup_words() -> None:
    prose = (
        "The policy schedules follow-up reviews: every quarter [1].\n\n"
        "Would you like me to summarize the review criteria?"
    )
    assert strip_followup_label_prefixes(prose) == prose
