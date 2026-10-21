"""Worked examples for small and medium models: earlier requests and the
calls that answered them, put in a new message's tail when they look like
it.

A small model picks the right tool and fills its arguments more often when
it sees two or three examples of the same kind of request than from tool
descriptions alone (2-5 examples "significantly improve" small models on
function calling, Small Models, Big Tasks, 2025). The best examples are
ones from this library that worked, so a card the user APPLIES is kept as
one (`wp_api/_ai_chats.py`, from the proposal's `ex` in the chat meta): its
request and the call behind it, arguments cut short. A few built-in ones
cover the common asks until there are some.

Stored in `ai-examples.json` next to `ai.json`, newest first, at most
`MAX`. Only the user's own requests and calls; it never leaves the machine
except as part of a request to the user's own model.
"""
from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any

FILENAME = "ai-examples.json"
#: Examples kept; the oldest go first.
MAX = 200
#: Examples shown with one message.
SHOW = 3
#: Words a request must share with an example to show it.
MIN_SHARED = 2
#: Longest text kept in an example's arguments, and items kept per list.
TEXT_CHARS = 80
LIST_ITEMS = 4

_lock = threading.Lock()
_WORD = re.compile(r"[a-z0-9$]+")
#: Words too common to make two requests alike.
_STOP = frozenset("""a an and are as at be but by can do for from have i in is it its me my of on
or our please so that the their them then these this those to us want we what which with you
your""".split())


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1}

#: Common asks, shown until the user's own applied cards cover them. Kept
#: valid against the tools' schemas by the tests.
BUILTIN: tuple[dict[str, Any], ...] = (
    {"ask": "add a war axe and a spear to my Weapon wildcard", "calls": [
        {"tool": "add_options", "args": {"id": "Weapon", "options": [
            {"text": "war axe"}, {"text": "spear"}]}}]},
    {"ask": "make three new wildcards for winter: Hat, Scarf and Gloves", "calls": [
        {"tool": "create_wildcard", "args": {"name": "Hat", "var": "hat", "options": [
            {"text": "knit beanie"}, {"text": "fur hat"}, {"text": "earmuffs"}]}},
        {"tool": "create_wildcard", "args": {"name": "Scarf", "var": "scarf", "options": [
            {"text": "red wool scarf"}, {"text": "checkered scarf"}]}},
        {"tool": "create_wildcard", "args": {"name": "Gloves", "var": "gloves", "options": [
            {"text": "leather gloves"}, {"text": "mittens"}]}}]},
    {"ask": "make heavy rain rarer in my Weather wildcard", "calls": [
        {"tool": "read", "args": {"id": "Weather"}},
        {"tool": "edit_options", "args": {"id": "Weather", "weights": [
            {"n": 3, "weight": 0.5}]}}]},
    {"ask": "when the season is winter, the outfit should be warm", "calls": [
        {"tool": "create_constraint", "args": {
            "source_id": "Season", "target_id": "Outfit", "rules": [
                {"source": "winter", "target": "#warm", "effect": "only"}]}}]},
    {"ask": "how do constraints work?", "calls": [
        {"tool": "docs_search", "args": {"query": "constraints"}}]},
    {"ask": "which wildcards set $hair_color?", "calls": [
        {"tool": "variables", "args": {"var": "hair_color"}}]},
    {"ask": "does my Outfit wildcard ever pick the swimsuit?", "calls": [
        {"tool": "run_test", "args": {"stack": ["Outfit"], "seeds": 200}}]},
    {"ask": "build me a full cyberpunk character pack", "calls": [
        {"tool": "plan_pack", "args": {"description": "cyberpunk character: subject, "
                                       "outfit, cybernetics, setting, lighting"}}]},
)


def path() -> Path:
    from engine.ai import config as ai_config
    return ai_config.config_path().with_name(FILENAME)


def load(where: Path | None = None) -> list[dict[str, Any]]:
    """The stored examples, newest first ([] when none or unreadable)."""
    p = where or path()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    rows = data.get("examples") if isinstance(data, dict) else None
    return [r for r in rows if _valid(r)] if isinstance(rows, list) else []


def _valid(row: Any) -> bool:
    return (isinstance(row, dict) and isinstance(row.get("ask"), str)
            and isinstance(row.get("calls"), list)
            and all(isinstance(c, dict) and isinstance(c.get("tool"), str)
                    and isinstance(c.get("args"), dict) for c in row["calls"]))


def compact(value: Any, depth: int = 0) -> Any:
    """Arguments cut short for an example: long texts trimmed, lists cut to a
    few items, deep nesting dropped."""
    if isinstance(value, str):
        return value if len(value) <= TEXT_CHARS else value[:TEXT_CHARS - 1] + "…"
    if isinstance(value, list):
        return [compact(v, depth + 1) for v in value[:LIST_ITEMS]] if depth < 4 else []
    if isinstance(value, dict):
        return {str(k): compact(v, depth + 1) for k, v in list(value.items())[:12]} \
            if depth < 4 else {}
    return value


def add(ask: str, calls: list[dict[str, Any]], where: Path | None = None) -> bool:
    """Keep one applied request and its calls. An example for the same
    request and tools replaces the older one. False when there is nothing
    to keep."""
    ask = " ".join(str(ask or "").split())[:300]
    calls = [{"tool": str(c.get("tool")), "args": compact(c.get("args") or {})}
             for c in calls if isinstance(c, dict) and c.get("tool")][:4]
    if not ask or not calls:
        return False
    p = where or path()
    key = (ask.lower(), tuple(c["tool"] for c in calls))
    with _lock:
        rows = [r for r in load(p)
                if (r["ask"].lower(), tuple(c["tool"] for c in r["calls"])) != key]
        rows.insert(0, {"ask": ask, "calls": calls})
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps({"examples": rows[:MAX]}, ensure_ascii=False,
                                      indent=1), encoding="utf-8")
            tmp.replace(p)
        except OSError:
            return False
    return True


def pick(text: str, stored: list[dict[str, Any]] | None = None,
         k: int = SHOW) -> list[dict[str, Any]]:
    """The examples most like this message: the user's own first, then the
    built-in ones, each sharing at least `MIN_SHARED` words with it."""
    said = _words(text or "")
    if not said:
        return []
    own = stored if stored is not None else load()
    scored: list[tuple[float, int, dict[str, Any]]] = []
    for i, row in enumerate([*own, *BUILTIN]):
        shared = len(said & _words(row["ask"]))
        if shared >= MIN_SHARED:
            # The user's own (earlier in the list) win a tie.
            scored.append((shared + (0.5 if i < len(own) else 0.0), -i, row))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    out: list[dict[str, Any]] = []
    for _, _, row in scored:
        if row["ask"].lower() != (text or "").strip().lower() and row not in out:
            out.append(row)
        if len(out) >= k:
            break
    return out


_JSON_SPACE = re.compile(r"\s+")


def note(rows: list[dict[str, Any]]) -> str:
    """The examples as a message-tail note, or ""."""
    if not rows:
        return ""
    lines = []
    for row in rows:
        calls = "; ".join(
            f"{c['tool']} {_JSON_SPACE.sub(' ', json.dumps(c['args'], ensure_ascii=False))[:240]}"
            for c in row["calls"])
        lines.append(f'- "{row["ask"]}" → {calls}')
    return ("Requests like this one and the calls that worked for them (examples of how to "
            "use the tools; the names in them may not be in this library):\n"
            + "\n".join(lines))
