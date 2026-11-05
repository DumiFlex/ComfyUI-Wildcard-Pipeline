"""What a chat answer SAYS it did, checked against what its cards do.

`request_check` compares the request with the cards; this compares the
answer's text with them. Small models report actions they never took: on the
2026-10-26 bench the 9B wrote "Hair colour now runs right after Race" beside a
bundle card that moved nothing (B4), "boost factor 0.1" beside a ×2 card
(X5), "weight 0.5" beside a card with no weight (W13) and "created
successfully" before anything was applied (B3). Each check here finds one such
claim; the route adds a note under the answer (research note
`pr-drafts/chat-claims-research-2026-10-27.md`).

Every check leans quiet: a claim it can't tie to a card's op is left alone.
"""
from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any


def _walk(value: Any) -> Iterator[tuple[str, Any]]:
    if isinstance(value, dict):
        for k, v in value.items():
            yield str(k), v
            yield from _walk(v)
    elif isinstance(value, list):
        for v in value:
            yield from _walk(v)


def _op(p: dict[str, Any]) -> dict[str, Any]:
    op = p.get("op")
    return op if isinstance(op, dict) else {}


# ── kinds ──────────────────────────────────────────────────────────────


def card_kinds(proposals: list[dict[str, Any]]) -> set[str]:
    """Every item kind the cards make, change or delete ("wildcard",
    "bundle", …): "I've proposed deleting the Hair colour wildcard" is
    about a wildcard although no card creates one (bench W23, F6)."""
    have: set[str] = set()
    for p in proposals:
        op = _op(p)
        body = op.get("body") if isinstance(op.get("body"), dict) else {}
        have.add(str(op.get("type") or body.get("type") or op.get("kind")))
        for it in op.get("items") or []:
            if isinstance(it, dict):
                have.add(str(it.get("type") or it.get("kind")))
    return have


#: An answer saying it made an item of some kind ("I've proposed a combine").
_CLAIM_KIND = re.compile(r"\bI(?:'ve| have)?\s+(?:just\s+)?(?:created|made|added|built|set up|"
                         r"proposed)\b([^.\n]{0,80}?)\b(fixed[ -]values?|combine|template|bundle|"
                         r"constraint|derivation|wildcard)s?\b", re.I)
#: Words between the verb and the kind that make it a change to an item, not
#: a new one ("I've proposed deleting the Hair colour wildcard").
_NOT_MADE = re.compile(r"\b(?:delet|remov|renam|retag|tagg|mov|switch|turn|disabl|chang|edit|"
                       r"updat|fix|rat(?:e|ing))\w*|\b(?:to|in|into|from|on|of)\s+(?:the|your|"
                       r"my)\b", re.I)


def missing_kinds(message: str, proposals: list[dict[str, Any]]) -> list[str]:
    """Kinds the answer says it made that no card of this answer is."""
    have = card_kinds(proposals)
    said = [re.sub(r"fixed[ -]values?", "fixed_values", m.group(2).lower())
            for m in _CLAIM_KIND.finditer(message or "") if not _NOT_MADE.search(m.group(1))]
    return [k for k in dict.fromkeys(said) if k not in have]


# ── numbers ────────────────────────────────────────────────────────────

#: A weight or factor the answer gives: "weight 0.5", "boost factor 0.1",
#: "weighted at 3", "×2". Percentages are test results, not settings.
_NUMBER_CLAIM = re.compile(
    r"\b(?:weight(?:ed|s)?|factor|boost(?:ed|s)?|reduc(?:e|ed|es)|odds)\b"
    r"[^.\n\d%]{0,20}?(?:[×x]\s*)?(\d+(?:\.\d+)?)(?!\s*%)(?!\.?\d)"
    r"|[×](\d+(?:\.\d+)?)(?!\.?\d|%)", re.I)
_NUMBER_KEYS = frozenset({"weight", "factor"})


def card_numbers(proposals: list[dict[str, Any]]) -> set[float]:
    """Every weight and factor the cards hold, old and new."""
    out: set[float] = {1.0}  # the default weight and factor every option has
    for p in proposals:
        for k, v in _walk(_op(p)):
            if k in _NUMBER_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
                out.add(round(float(v), 4))
        for line in [*(p.get("preview") or []), str(p.get("title") or "")]:
            for m in re.finditer(r"[×x](\d+(?:\.\d+)?)", str(line)):
                out.add(round(float(m.group(1)), 4))
    return out


def unbacked_numbers(message: str, proposals: list[dict[str, Any]]) -> list[str]:
    """Weights and factors the answer names that no card sets (bench W13,
    X5, Z12). Only when a card could hold one: a weight or rule card."""
    if not any(p.get("tool") in _WEIGHT_TOOLS for p in proposals):
        return []
    have = card_numbers(proposals)
    out: list[str] = []
    for m in _NUMBER_CLAIM.finditer(message or ""):
        raw = m.group(1) or m.group(2)
        if round(float(raw), 4) not in have and raw not in out:
            out.append(raw)
    return out


_WEIGHT_TOOLS = frozenset({"create_wildcard", "add_options", "edit_options",
                           "create_constraint", "edit_constraint"})


# ── order ──────────────────────────────────────────────────────────────

#: "Hair colour now runs right after Race", "moved Mood before Weather".
_MOVE_CLAIM = re.compile(
    r"\b(?:now\s+(?:runs?|comes?|sits?|goes|is|are)|moved?|placed|put)\s+"
    r"(?:\w+\s+){0,4}?(?:right\s+|directly\s+|just\s+|to\s+)?"
    r"(?:after|before|ahead of|first|last)\b",
    re.I)


def _reordered(op: dict[str, Any]) -> bool:
    body = op.get("body") if isinstance(op.get("body"), dict) else {}
    before = op.get("before") if isinstance(op.get("before"), dict) else {}
    new = [c.get("id") for c in body.get("children") or [] if isinstance(c, dict)]
    old = [c.get("id") for c in before.get("children") or [] if isinstance(c, dict)]
    return [i for i in new if i in old] != [i for i in old if i in new]


def unbacked_move(message: str, proposals: list[dict[str, Any]]) -> bool:
    """The answer says a bundle child moved and no bundle card of it moves
    one (bench B4: "Hair colour now runs right after Race", both runs)."""
    bundles = [p for p in proposals if p.get("tool") == "edit_bundle"]
    if not bundles or not _MOVE_CLAIM.search(message or ""):
        return False
    return not any(_reordered(_op(p)) for p in bundles)


# ── done before Apply ──────────────────────────────────────────────────

#: The answer saying the change already happened (bench B3: "created
#: successfully" before Apply).
_DONE = re.compile(
    r"\b(?:has|have)\s+(?:now\s+)?been\s+(?:successfully\s+)?(?:created|added|updated|deleted|"
    r"removed|moved|applied|saved|changed)\b|\b(?:created|added|updated|saved|applied|deleted)"
    r"\s+successfully\b|\bis\s+now\s+(?:in|part\s+of)\s+your\s+library\b", re.I)


def says_done(message: str) -> bool:
    return bool(_DONE.search(message or ""))


#: Under an answer whose text says the change is done (`says_done`).
NOT_APPLIED = ("*(Nothing has changed yet: the card does it when you press Apply.)*")


# ── tool names ─────────────────────────────────────────────────────────

#: How a reply names what a tool does, for the tools users ask about most.
_TOOL_WORDS = {
    "run_test": "a test run", "edit_options": "an options change",
    "add_options": "new options", "create_wildcard": "a new wildcard",
    "edit_bundle": "a bundle change", "edit_rules": "a rules change",
    "add_rules": "new rules", "edit_constraint": "a constraint change",
    "update_info": "an info change", "update_many": "a change to many items",
    "delete_items": "a delete card", "read_page": "reading the page",
    "web_search": "a web search", "more_tools": "more tools",
}


def plain_tool_names(message: str, names: list[str] | tuple[str, ...]) -> str:
    """The answer with internal tool names said in plain words (bench C5:
    "I'll use the edit_options tool"). Only names with an underscore, or a
    name followed by "tool", so words like "search" stay; code is left alone."""
    named = sorted((n for n in names if "_" in n), key=len, reverse=True)
    if not named or not message:
        return message
    pattern = re.compile(r"(?:\bthe\s+)?`?\b(" + "|".join(map(re.escape, named))
                         + r")\b`?(?:\s+(?:tool|function|call))?", re.I)
    parts = re.split(r"(```.*?```)", message, flags=re.S)
    return "".join(p if p.startswith("```") else pattern.sub(
        lambda m: _TOOL_WORDS.get(m.group(1).lower(), m.group(1).replace("_", " ")), p)
        for p in parts)
