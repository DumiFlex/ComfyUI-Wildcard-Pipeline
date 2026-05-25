"""Cleaner rule registry.

Each rule module exports a single `apply(text, mode, config)` function
returning a `RuleResult`. The registry below pins the canonical
execution order — the pipeline iterates rules in this order regardless
of how the widget toggles them, so output stays deterministic.
"""
from __future__ import annotations

from collections.abc import Callable

from engine.cleaner.rules import (
    blocklist,
    dedupe,
    punctuation,
    whitespace,
)
from engine.cleaner.types import RuleId, RuleResult

ApplyFn = Callable[[str, str, dict], RuleResult]

RULE_REGISTRY: list[tuple[RuleId, ApplyFn]] = [
    ("whitespace", whitespace.apply),
    ("punctuation", punctuation.apply),
    ("dedupe_exact", dedupe.apply_exact),
    ("fuzzy_dedupe", dedupe.apply_fuzzy),
    ("blocklist", blocklist.apply),
]


def get_rule(rule_id: RuleId) -> ApplyFn:
    for rid, fn in RULE_REGISTRY:
        if rid == rule_id:
            return fn
    raise KeyError(f"unknown rule id: {rule_id!r}")
