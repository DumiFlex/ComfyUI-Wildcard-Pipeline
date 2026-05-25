"""Lightweight token/word/char counters for the cleaner UI.

The cleaner widget shows `Nw · Nc` next to the prompt. These helpers
keep that math out of the rule modules so they stay focused on
transformation.

CLIP token count is deferred to the node layer where the actual CLIP
tokenizer instance lives (it can't be imported in the engine because
torch loading is heavy).
"""
from __future__ import annotations

import re

_WORD = re.compile(r"\w+", re.UNICODE)


def count_words(text: str) -> int:
    if not text:
        return 0
    return len(_WORD.findall(text))


def count_chars(text: str) -> int:
    return len(text)
