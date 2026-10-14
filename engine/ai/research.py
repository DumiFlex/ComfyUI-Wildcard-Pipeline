"""Web searches the Draft with AI panels may ask for.

When web search is set up (Settings › AI assistant › Web search), the
wildcard draft and edit panels and the text panel (fixed values, combines,
templates) offer the model a `research` list in its answer: up to
`MAX_RESEARCH` searches for facts it doesn't know (a franchise's
characters, a real art style's vocabulary). The answer is then held back:
the panel shows the searches, the user allows or skips them, and the same
request goes again with the results (or with a note that the user
skipped), so the model never searches on its own. Allowed results go
with every later request of the conversation. One round per ask; the
pack builder's plan step does the same with its own `research` field.

Derivation and constraint panels don't offer it: their rules work on the
options already in the library.
"""
from __future__ import annotations

import copy
from typing import Any

from engine.ai.pack import MAX_RESEARCH, web_note

PROMPT = (
    "Web search is on. If the answer needs facts you don't know well (names of "
    "real characters, artists, brands, places, styles, a recent release), list "
    f"up to {MAX_RESEARCH} short web searches in research and still give your best "
    "answer; don't wait to be asked. The user decides whether to run them, then "
    "you revise. research is [] when you know enough."
)

SKIPPED = ("The user chose not to search the web. Answer from what you know; "
           "don't ask to search again.")


def with_research(schema: dict[str, Any]) -> dict[str, Any]:
    """The answer schema with a required `research` list of queries."""
    out = copy.deepcopy(schema)
    out.setdefault("properties", {})["research"] = {
        "type": "array", "items": {"type": "string"}}
    req = list(out.get("required") or [])
    if "research" not in req:
        req.append("research")
    out["required"] = req
    return out


def take(answer: Any, searched: list[str] | None = None) -> tuple[Any, list[str]]:
    """``(answer without research, queries)``: the searches the model asked
    for, cleaned, at most `MAX_RESEARCH`, minus ones already run."""
    if not isinstance(answer, dict) or "research" not in answer:
        return answer, []
    rest = {k: v for k, v in answer.items() if k != "research"}
    raw = answer.get("research")
    done = {q.lower() for q in searched or []}
    out: list[str] = []
    for q in raw if isinstance(raw, list) else []:
        if isinstance(q, str):
            q = " ".join(q.split())[:120]
            if q and q.lower() not in done and q.lower() not in {x.lower() for x in out}:
                out.append(q)
    return rest, out[:MAX_RESEARCH]


def note(results: Any, skipped: bool = False) -> str:
    """What goes with a request: the results the user allowed in this
    conversation (sent with every later request, so the facts outlive the
    follow-up that used them), and that they skipped the last searches."""
    return "\n\n".join(t for t in (web_note(results), SKIPPED if skipped else "") if t)
