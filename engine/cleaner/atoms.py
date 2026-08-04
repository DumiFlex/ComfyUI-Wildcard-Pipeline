"""Prompt-syntax atoms the cleaner must not rewrite.

The cleaner's rules treat a prompt as prose or as a comma-separated tag list.
That is the right model for tags, and the wrong one for the handful of tokens
that are *addresses* rather than words — `embedding:name` and `<lora:name:1.0>`
resolve to a file on disk, so a single edited character silently changes what
the sampler loads, or loads nothing at all.

Two rules were provably destructive (P3 #31, pinned by
`tests/engine/cleaner/test_embedding_roundtrip.py`):

  * punctuation stripping — `_` and `-` are in the stripped set, so
    `embedding:bad_prompt_` (a real published shape) became
    `embedding:bad_prompt`. ComfyUI resolves a missing embedding to nothing,
    so the negative prompt quietly stopped working, with no error.
  * fuzzy dedupe — versioned names are near-identical strings and the
    threshold is 0.9, so `embedding:badhandv4, embedding:badhandv5` lost the
    second. Two different files, one silently dropped.

This widens the cleaner's remit from "text" to "knows a little prompt syntax",
which the findings called out as the cost of fixing it. The alternative was
leaving a rule that corrupts a file reference without saying so.

Deliberately narrow: only the well-known forms, and only whole tokens. Anything
not matched here keeps its existing treatment.
"""
from __future__ import annotations

import re

# `embedding:name`, optionally weighted / parenthesised by the caller. The name
# runs to the next separator: whitespace, comma, or a closing paren/angle.
_EMBEDDING_RE = re.compile(r"\bembedding:[^\s,)\]>]+", re.IGNORECASE)

# `<lora:name:1.0>` and the siblings that share its shape. Matched whole, so
# internal punctuation and decimal weights are untouchable.
_ANGLE_RE = re.compile(
    r"<\s*(?:lora|lyco|locon|hypernet|embedding)\s*:[^>]*>",
    re.IGNORECASE,
)


def contains_atom(text: str) -> bool:
    """True when `text` carries a file-reference token cleaning must preserve."""
    if not text:
        return False
    return bool(_EMBEDDING_RE.search(text) or _ANGLE_RE.search(text))


def ends_with_atom(text: str) -> bool:
    """True when `text` ENDS in an atom, so trimming its trailing edge would
    eat part of the reference. Used by the text-mode punctuation pass, which
    trims the whole string rather than per-tag."""
    if not text:
        return False
    stripped = text.rstrip()
    for pattern in (_EMBEDDING_RE, _ANGLE_RE):
        for match in pattern.finditer(stripped):
            if match.end() == len(stripped):
                return True
    return False
