"""Calls that worked, shown to small models as examples (research note
"Small model tool use", T5).

When the user applies a card, the request that led to it and the call
behind it are kept (`remember`, from the turn's `meta["examples"]`) in
`ai-examples.json` beside `ai.json`, on this machine only. A small or
medium model's new message gets the two or three closest ones (`pick`),
built-in ones filling in, as "request → call" lines: a matched example
helps a small model pick the tool and write its arguments more than any
instruction does.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

#: Examples kept; the oldest go first.
MAX_KEPT = 60
#: Examples shown with one message.
MAX_SHOWN = 3
#: List items and characters an example's arguments keep.
_LIST_ITEMS = 3
_TEXT_CHARS = 120

#: Shipped examples, used until the user's own fill in.
BUILT_IN: list[dict[str, Any]] = [
    {"ask": "make a weather wildcard", "tool": "create_wildcard",
     "args": {"name": "Weather", "var": "weather",
              "options": [{"text": "light rain"}, {"text": "clear sky"}, {"text": "thick fog"}]}},
    {"ask": "add snow and hail to my weather", "tool": "add_options",
     "args": {"id": "Weather", "options": [{"text": "snow"}, {"text": "hail"}]}},
    {"ask": "make option 2 of Weather rarer and drop option 4", "tool": "edit_options",
     "args": {"id": "Weather", "weights": [{"n": 2, "weight": 0.3}], "remove": [4]}},
    {"ask": "never snow in summer", "tool": "create_constraint",
     "args": {"name": "No snow in summer", "source_id": "Season", "target_id": "Weather",
              "rules": [{"source": "summer", "target": "snow", "effect": "exclude"}]}},
    {"ask": "add an umbrella when it rains", "tool": "create_derivation",
     "args": {"name": "Rain gear", "rules": [{"summary": "an umbrella when it rains",
              "branches": [{"conditions": [{"var": "weather", "op": "contains",
                                            "value": "rain"}],
                            "actions": [{"target_var": "props", "mode": "append",
                                         "value": "umbrella"}]}]}]}},
    {"ask": "quality tags I always use", "tool": "create_fixed_values",
     "args": {"name": "Quality", "values": [{"name": "quality",
                                             "value": "masterpiece, best quality"}]}},
    {"ask": "put top, bottom and shoes into one outfit line", "tool": "create_combine",
     "args": {"name": "Outfit line", "var": "outfit", "template": "$top, $bottom, $shoes"}},
    {"ask": "tag Weather as scene", "tool": "update_info",
     "args": {"id": "Weather", "tags_add": ["scene"]}},
    {"ask": "what do I have for hair?", "tool": "search",
     "args": {"query": "hair", "type": "wildcard"}},
    {"ask": "how does constraint reach work?", "tool": "docs_search",
     "args": {"query": "constraint reach"}},
]

_WORD = re.compile(r"[a-z]{3,}")
_STOP = frozenset("the and for with that this what have make add can you please into from "
                  "are its how does give want need all any one many much more my some "
                  "option options item items value values rule rules".split())


def path() -> Path:
    from engine.ai import config as ai_config
    return ai_config.config_path().with_name("ai-examples.json")


def _words(text: str) -> set[str]:
    return {w.rstrip("s") for w in _WORD.findall(text.lower()) if w not in _STOP}


def _lead(text: str) -> str:
    first = text.strip().lower().split(maxsplit=1)
    return first[0] if first else ""


def compact(value: Any) -> Any:
    """Arguments short enough to show: lists cut to a few items, long texts
    cut."""
    if isinstance(value, dict):
        return {k: compact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [compact(v) for v in value[:_LIST_ITEMS]]
    if isinstance(value, str) and len(value) > _TEXT_CHARS:
        return value[:_TEXT_CHARS] + "…"
    return value


def load() -> list[dict[str, Any]]:
    try:
        data = json.loads(path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [e for e in data if isinstance(e, dict) and isinstance(e.get("ask"), str)
            and isinstance(e.get("tool"), str) and isinstance(e.get("args"), dict)] \
        if isinstance(data, list) else []


def remember(entries: list[dict[str, Any]]) -> None:
    """Keep applied cards' (request, call) pairs; a pair already kept moves
    to the end instead of repeating."""
    if not entries:
        return
    kept = load()
    for e in entries:
        key = (e["ask"].strip().lower(), e["tool"])
        kept = [k for k in kept if (k["ask"].strip().lower(), k["tool"]) != key]
        kept.append({"ask": e["ask"][:300], "tool": e["tool"], "args": compact(e["args"])})
    try:
        p = path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(kept[-MAX_KEPT:], ensure_ascii=False, indent=1),
                     encoding="utf-8")
    except OSError:
        pass  # examples are a help, never a reason to fail a request


def pick(text: str, tools: list[str], kept: list[dict[str, Any]] | None = None) -> \
        list[dict[str, Any]]:
    """The examples closest to `text` that use one of the chat's `tools`:
    the user's own first, built-in ones filling in; none share a word with
    the message, none are shown."""
    words = _words(text)
    if not words:
        return []
    offered = set(tools)
    lead = _lead(text)
    scored: list[tuple[int, int, int, dict[str, Any]]] = []
    for own, pool in ((1, load() if kept is None else kept), (0, BUILT_IN)):
        for i, e in enumerate(pool):
            if e["tool"] not in offered:
                continue
            score = len(words & _words(e["ask"]))
            if score and _lead(e["ask"]) == lead:
                score += 1  # the same kind of ask: "make …", "what …", "add …"
                scored.append((score, own, i, e))
    scored.sort(key=lambda x: (-x[0], -x[1], -x[2]))
    out: list[dict[str, Any]] = []
    for _, _, _, e in scored:
        if all(e["ask"] != o["ask"] for o in out):
            out.append(e)
        if len(out) >= MAX_SHOWN:
            break
    return out


def note(chosen: list[dict[str, Any]]) -> str:
    """The examples as they go with the user's message."""
    if not chosen:
        return ""
    lines = [f'- "{e["ask"]}" → {e["tool"]} {json.dumps(e["args"], ensure_ascii=False)}'
             for e in chosen]
    return ("(Calls that worked for similar requests; examples of the format, not your task "
            "and not items the user has:\n" + "\n".join(lines) + ")")
