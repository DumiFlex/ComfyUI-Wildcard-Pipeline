"""Text in a writing system the library doesn't use.

Small models drift into another script mid-answer (bench Z9: "焦" and
"曝光" inside an English fixed value), which prints as noise in the
prompt. `foreign` names the scripts a text uses that a reference text
(the request and the library's own text) doesn't, and `strip_foreign`
drops the comma-separated parts that hold them.
"""
from __future__ import annotations

import re
import unicodedata

#: Unicode name prefixes for the scripts we tell apart. Latin, digits and
#: punctuation are never foreign.
_SCRIPTS = ("CJK", "HIRAGANA", "KATAKANA", "HANGUL", "CYRILLIC", "GREEK", "ARABIC",
            "HEBREW", "THAI", "DEVANAGARI")


def _script(ch: str) -> str:
    if ch.isascii():
        return ""
    name = unicodedata.name(ch, "")
    return next((s for s in _SCRIPTS if name.startswith(s)), "")


def scripts(text: str) -> set[str]:
    return {s for s in map(_script, text or "") if s}


def foreign(text: str, reference: str) -> set[str]:
    """Scripts in `text` that `reference` never uses."""
    return scripts(text) - scripts(reference)


def strip_foreign(text: str, reference: str) -> tuple[str, list[str]]:
    """`text` without the comma-separated parts in a script `reference`
    doesn't use, and the parts dropped."""
    bad = foreign(text, reference)
    if not bad:
        return text, []
    kept: list[str] = []
    dropped: list[str] = []
    for part in re.split(r"\s*,\s*", text):
        (dropped if scripts(part) & bad else kept).append(part)
    return ", ".join(p for p in kept if p), [p for p in dropped if p]
