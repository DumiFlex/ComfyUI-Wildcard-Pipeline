"""Strip empty fragments left behind by null-option wildcard picks.

A wildcard option with is_null=True returns "" at resolve time. That
"" inside a template like `{$mood} mood, $subject` produces stray
`, ` artifacts. Without ctx the rule can't tell those apart from
intentional empty content, so it's WP-aware-only.

When the rule fires it removes:
  - Bare `, ,` runs in tags mode (collapses to one comma — the
    whitespace rule strips the resulting `, ,` leftover on the next
    pass).
  - `  ` (double space) in text mode where it stands alongside the
    null'd variable name.
"""
from __future__ import annotations

import re

from engine.cleaner.types import CleanerCtx, RuleResult

_TAGS_EMPTY_RUN = re.compile(r",(\s*,)+")
_TEXT_DOUBLE_SPACE = re.compile(r"  +")


def apply(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    if ctx is None:
        return {"text": text, "stats": {}}
    has_null_pick = any(
        pick.get("is_null") is True
        for pick in ctx.picks.values()
    )
    if not has_null_pick:
        return {"text": text, "stats": {"stripped": 0}}
    out = text
    stripped = 0
    if mode == "tags":
        new = _TAGS_EMPTY_RUN.sub(",", out)
        if new != out:
            stripped += 1
        out = new
    else:
        new = _TEXT_DOUBLE_SPACE.sub(" ", out)
        if new != out:
            stripped += 1
        out = new
    return {"text": out, "stats": {"stripped": stripped}}
