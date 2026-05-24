"""Stub — replaced in Task 6."""
from __future__ import annotations

from engine.cleaner.types import CleanerCtx, RuleResult


def apply(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    return {"text": text, "stats": {}}
