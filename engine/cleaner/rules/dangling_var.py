"""Stub — replaced in Task 5."""
from __future__ import annotations

from engine.cleaner.types import CleanerCtx, RuleResult


def apply(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    return {"text": text, "stats": {}}
