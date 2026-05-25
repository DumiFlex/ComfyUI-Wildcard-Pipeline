"""Shared types for the cleaner pipeline.

All rules are string-only — no upstream PIPELINE_CONTEXT dependency.
The cleaner operates purely on the prompt string + the user's widget
config (mode, intensity, rule overrides, blocklist).
"""
from __future__ import annotations

from typing import Any, Literal, TypedDict

RuleId = Literal[
    "whitespace",
    "punctuation",
    "dedupe_exact",
    "fuzzy_dedupe",
    "blocklist",
]

Mode = Literal["tags", "text"]


class RuleResult(TypedDict):
    """Return shape for every rule.

    `text` is the transformed prompt. `stats` is a per-rule key/value
    dict the pipeline collects into a RunReport — UI surfaces these
    inline next to each active rule in the widget.
    """

    text: str
    stats: dict[str, Any]


# A RunReport is `{rule_id -> stats dict}`. Keep as a type alias rather
# than TypedDict so callers can iterate rule_ids dynamically.
RunReport = dict[RuleId, dict[str, Any]]
