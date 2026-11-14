"""Shared budget contracts for PydanticAI agent runs."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AgentExecutionBudget:
    """Resource and safety limits enforced on an autonomous PydanticAI agent run."""

    max_rounds: int = 4
    max_tool_calls: int = 4
    max_total_timeout_seconds: float = 12.0
    tool_timeout_seconds: float = 4.0
