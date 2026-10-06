"""LoRA tag spacing.

Tidies `<lora:name:0.8>` style tags (and the lyco / locon / hypernet /
embedding siblings that share the shape, see engine/cleaner/atoms.py):

  * inside the tag, spaces at the edges of each `:` segment go
    (`< lora : name : 0.8 >` -> `<lora:name:0.8>`). Spaces INSIDE a
    segment stay, so a file name with spaces still resolves;
  * outside, a tag jammed against a word gets one space on that side
    (`girl<lora:x:1>smile` -> `girl <lora:x:1> smile`), and spaces
    between a tag and a following comma go (`<lora:x:1> , hat` ->
    `<lora:x:1>, hat`).

Reports `stats.tidied` = tags changed.
"""
from __future__ import annotations

import re

from engine.cleaner.types import RuleResult

_TAG_RE = re.compile(
    r"<\s*(?P<kind>lora|lyco|locon|hypernet|embedding)\s*:(?P<rest>[^<>]*)>",
    re.IGNORECASE,
)
# A tag needs a space from a neighbour unless that neighbour is whitespace,
# a separator or a bracket edge.
_NO_SPACE_BEFORE = set(" \t\n,([{")
_NO_SPACE_AFTER = set(" \t\n,)]}")


def apply(text: str, mode: str, config: dict) -> RuleResult:
    tidied = 0
    out: list[str] = []
    pos = 0
    for m in _TAG_RE.finditer(text):
        start, end = m.start(), m.end()
        before = text[pos:start]
        segments = [s.strip() for s in m.group("rest").split(":")]
        tag = f"<{m.group('kind')}:{':'.join(segments)}>"
        changed = tag != m.group(0)
        # Space on the left when the tag touches a word (or another tag).
        prev = (out[-1][-1:] if not before and out else before[-1:]) or ""
        if prev and prev not in _NO_SPACE_BEFORE:
            before += " "
            changed = True
        out.append(before + tag)
        pos = end
        # Spaces between the tag and a following comma.
        after = text[pos:]
        stripped = after.lstrip(" \t")
        if stripped.startswith(",") and stripped != after:
            pos += len(after) - len(stripped)
            changed = True
        elif after and after[0] not in _NO_SPACE_AFTER and not _TAG_RE.match(after):
            out.append(" ")
            changed = True
        if changed:
            tidied += 1
    out.append(text[pos:])
    return {"text": "".join(out) if tidied else text, "stats": {"tidied": tidied}}
