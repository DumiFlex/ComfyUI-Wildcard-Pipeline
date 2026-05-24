"""Whitespace + punctuation normalization.

Rules applied in one pass over the input:
  1. Collapse runs of horizontal whitespace into a single space.
  2. Strip leading + trailing whitespace.
  3. Collapse runs of commas (`,,,` -> `,`).
  4. Drop leading + trailing standalone commas.
  5. Normalize `comma-space` separator in tags mode.

Counts every kind of fix into stats.fixed so the UI can show
`ws:N` next to the rule row.
"""
from __future__ import annotations

import re

from engine.cleaner.types import CleanerCtx, RuleResult

_WS_RUN = re.compile(r"[ \t]+")
_COMMA_RUN = re.compile(r",[ \t,]*,")


def apply(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    fixed = 0
    out = text

    collapsed_ws = _WS_RUN.sub(" ", out)
    if collapsed_ws != out:
        fixed += 1
    out = collapsed_ws

    trimmed = out.strip()
    if trimmed != out:
        fixed += 1
    out = trimmed

    collapsed_commas = _COMMA_RUN.sub(",", out)
    if collapsed_commas != out:
        fixed += 1
    out = collapsed_commas

    while out.startswith(","):
        out = out[1:].lstrip()
        fixed += 1
    while out.endswith(","):
        out = out[:-1].rstrip()
        fixed += 1

    if mode == "tags":
        normalized = re.sub(r",(?!\s)", ", ", out)
        if normalized != out:
            fixed += 1
        out = normalized

    return {"text": out, "stats": {"fixed": fixed}}
