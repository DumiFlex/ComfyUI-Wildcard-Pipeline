"""Shared types for the cleaner pipeline.

`CleanerCtx` is a minimal dataclass — the node layer fills it from
PIPELINE_CONTEXT so engine code never imports comfy_api. Rules that
don't read ctx (whitespace, dedupe_exact, fuzzy_dedupe, blocklist)
should still accept the parameter for a uniform signature.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

RuleId = Literal[
    "whitespace",
    "punctuation",
    "dedupe_exact",
    "wp_dedupe",
    "null_slot",
    "fuzzy_dedupe",
    "dangling_var",
    "blocklist",
    "reorder",
]

Mode = Literal["tags", "text"]


@dataclass
class CleanerCtx:
    """Snapshot of WP chain state the cleaner needs.

    Populated at the node boundary from `PIPELINE_CONTEXT`. WP-aware
    rules read these fields; non-WP rules ignore the dataclass.
    """

    picks: dict[str, dict[str, Any]] = field(default_factory=dict)
    constraints: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)


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
