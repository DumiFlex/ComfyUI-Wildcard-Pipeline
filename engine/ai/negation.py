"""Text that only says what to leave out ("no guns, no rifles").

Printed in a prompt, such a value names the very things it excludes, and a
pick it stands in for (the weapon) goes missing: a 35B wrote a fantasy
pack's "no firearms" rule as the weapon's value. The compilers move it to
the negative or drop it. One "no X" piece stays: "no hat" is a real look.
"""
from __future__ import annotations

import re

_NO_PIECE = re.compile(r"^(?:no|without|never|not)\s+(?:any\s+)?(.+)$", re.I)


def excluded(text: str) -> str:
    """What a value made only of two or more "no X" pieces leaves out
    ("no guns, no rifles" → "guns, rifles"), else ""."""
    pieces = [p.strip() for p in str(text or "").split(",") if p.strip()]
    if len(pieces) < 2:
        return ""
    got = [m.group(1).strip() for p in pieces if (m := _NO_PIECE.match(p))]
    return ", ".join(got) if len(got) == len(pieces) else ""
