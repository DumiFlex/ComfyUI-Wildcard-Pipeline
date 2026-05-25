"""Cleaner rule registry.

Each rule module exports a single `apply(text, mode, ctx, config)`
function returning a `RuleResult`. The registry below pins the
canonical execution order — the pipeline iterates rules in this
order regardless of how the widget toggles them, so output stays
deterministic.
"""
from __future__ import annotations

from collections.abc import Callable

from engine.cleaner.rules import (
    blocklist,
    dangling_var,
    dedupe,
    null_slot,
    punctuation,
    whitespace,
)
from engine.cleaner.types import RuleId, RuleResult

ApplyFn = Callable[[str, str, object, dict], RuleResult]

RULE_REGISTRY: list[tuple[RuleId, ApplyFn]] = [
    ("whitespace", whitespace.apply),
    ("punctuation", punctuation.apply),
    ("dedupe_exact", dedupe.apply_exact),
    ("wp_dedupe", dedupe.apply_wp),
    ("null_slot", null_slot.apply),
    ("fuzzy_dedupe", dedupe.apply_fuzzy),
    ("dangling_var", dangling_var.apply),
    ("blocklist", blocklist.apply),
]


def get_rule(rule_id: RuleId) -> ApplyFn:
    for rid, fn in RULE_REGISTRY:
        if rid == rule_id:
            return fn
    raise KeyError(f"unknown rule id: {rule_id!r}")
