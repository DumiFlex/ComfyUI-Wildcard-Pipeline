"""What the user asked for that this answer's cards don't have yet.

Before an answer with cards stands, code compares the request with the
cards, the other way round from the claim checks (which compare what the
answer SAYS with what was made). Mingbird's finish gate (harness research
H1, `/pr-drafts/reports/Small-model harness ideas.md`) was the largest of
its four mechanisms on a 2B model; the 9B used a boost where the user said
"only gets" (smoke s-only, 2026-10-23).

Only features whose words are exact and whose presence a card shows are
checked: a constraint, an "only" rule, a fallback option, negatives, a
tag-filtered ref ("only the warm colours from Palette"). Counts
belong to the plan loop; kinds of item are left to it too.
"""
from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from typing import Any

_CONSTRAINT_TOOLS = frozenset({"create_constraint", "edit_constraint"})


def _walk(value: Any) -> Iterator[tuple[str, Any]]:
    """Every (key, value) pair in a card's op, at any depth."""
    if isinstance(value, dict):
        for k, v in value.items():
            yield str(k), v
            yield from _walk(v)
    elif isinstance(value, list):
        for v in value:
            yield from _walk(v)


def _has_constraint(cards: list[dict[str, Any]]) -> bool:
    return any(c.get("tool") in _CONSTRAINT_TOOLS for c in cards)


def _has_only(cards: list[dict[str, Any]]) -> bool:
    return any(k in ("effect", "mode") and v == "only"
               for c in cards if c.get("tool") in _CONSTRAINT_TOOLS
               for k, v in _walk(c.get("op")))


def _has_fallback(cards: list[dict[str, Any]]) -> bool:
    return any(k == "fallback" and v is True for c in cards for k, v in _walk(c.get("op")))


def _has_tag_ref(cards: list[dict[str, Any]]) -> bool:
    return any(isinstance(v, str) and _TAG_REF.search(v)
               for c in cards for _k, v in _walk(c.get("op")))


_TAG_REF = re.compile(r"@\{[^}]*:")


def _has_negative(cards: list[dict[str, Any]]) -> bool:
    return any((k == "negative" and isinstance(v, str) and v.strip())
               or (k == "mode" and v in ("negative", "negative_replace"))
               for c in cards for k, v in _walk(c.get("op")))


#: (what the note calls it, the request words, whether the cards have it).
FEATURES: tuple[tuple[str, re.Pattern[str], Callable[[list[dict[str, Any]]], bool]], ...] = (
    ("a constraint", re.compile(
        r"\bconstraints?\b|\bgoes with\b|\bgo with\b|\bonly gets?\b|\bgets? only\b|"
        r"\bexclud\w*|"
        r"\brule[sd]? out\b|\bnever\b.{0,60}?\b(?:when|with|for|to|if|on|in)\b", re.I),
     _has_constraint),
    ('an "only" rule (effect only: the target may use just what the row names)', re.compile(
        r"\bonly (?:gets?|allow\w*|with|uses?)\b|\b(?:gets?|uses?|allows?) only\b|"
        r"\bgoes with\b|\bgo with\b", re.I),
     _has_only),
    ("a fallback option", re.compile(r"\bfallback\b|\bnever (?:be )?empty\b", re.I),
     _has_fallback),
    ("negatives", re.compile(r"\bnegatives?\b", re.I), _has_negative),
    ("a tag-filtered ref (an option such as \"a @{Palette:warm} sky\", not the colours "
     "copied in)", re.compile(r"\bonly\b[^.]{0,40}?\bfrom\b|\btagged \w+ from\b", re.I),
     _has_tag_ref),
)

#: Phrases that read like an ask above but aren't: "only the warm colours
#: from Palette" is a tag filter, not an only rule; "when rules rule out
#: everything" is how a fallback is described (smoke 2026-10-23, both
#: nudged wrongly).
_NOT_ASKS = re.compile(r"\bonly\b[^.]{0,40}?\bfrom\b|\brules?\s+rule[sd]?\s+out\b", re.I)

#: Chips name items; their names must not count as asks ("[[id#Never Rain]]").
_CHIP = re.compile(r"\[\[[^\]]*\]\]")


def gaps(request: str, cards: list[dict[str, Any]]) -> list[str]:
    """What `request` asks for that `cards` (this answer's proposals) lack,
    in `FEATURES` order. An "only" rule counts as the constraint too."""
    if not request or not cards:
        return []
    plain = _CHIP.sub(" ", request)
    asks = _NOT_ASKS.sub(" ", plain)
    out = [name for name, words, has in FEATURES
           if (words.search(plain) if name.startswith("a tag-filtered") else words.search(asks))
           and not has(cards)]
    if len(out) > 1 and out[0] == "a constraint" and out[1].startswith('an "only"'):
        out.pop(0)
    return out


def nudge(missing: list[str], request: str) -> str:
    """The one note an answer gets when its cards miss part of the request."""
    asked = request.strip()
    if len(asked) > 400:
        asked = asked[:400].rstrip() + "…"
    return (f"Before you finish, check the cards against the request: it asks for "
            f"{' and '.join(missing)}, and no card in this answer has "
            f"{'it' if len(missing) == 1 else 'them'}. Propose "
            f"{'it' if len(missing) == 1 else 'them'} now (or change the card that should "
            f"have it), or say why it isn't needed.\nThe request: \"{asked}\"")
