"""Strip orphan / leading / trailing punctuation.

Two cleanups:

  1. Tags mode — drop tags whose only content is punctuation
     (`.`, `,`, `:`, `;`, `!`, `?`, `-`, `_`, plus runs of those).
  2. Tags + text mode — strip leading + trailing punctuation runs
     from each tag (tags mode) or from the whole string (text mode).

Idempotent: re-running on the same input produces the same output.
Reports `stats.stripped` = total tags + edges trimmed.
"""
from __future__ import annotations

import re

from engine.cleaner.types import RuleResult

_PUNCT_CHARS = r".,:;!?\-_"
_PURE_PUNCT_RE = re.compile(rf"^[{_PUNCT_CHARS}\s]+$")
_LEADING_PUNCT_RE = re.compile(rf"^[{_PUNCT_CHARS}\s]+")
_TRAILING_PUNCT_RE = re.compile(rf"[{_PUNCT_CHARS}\s]+$")


def _strip_edges(s: str) -> tuple[str, bool]:
    new = _LEADING_PUNCT_RE.sub("", s)
    new = _TRAILING_PUNCT_RE.sub("", new)
    return new, new != s


def apply(text: str, mode: str, config: dict) -> RuleResult:
    stripped = 0
    if mode == "tags":
        tags = [t.strip() for t in text.split(",") if t.strip()]
        kept: list[str] = []
        for tag in tags:
            if _PURE_PUNCT_RE.match(tag):
                stripped += 1
                continue
            edged, changed = _strip_edges(tag)
            if changed:
                stripped += 1
            if edged:
                kept.append(edged)
        out = ", ".join(kept)
    else:
        out, changed = _strip_edges(text)
        if changed:
            stripped += 1
    return {"text": out, "stats": {"stripped": stripped}}
