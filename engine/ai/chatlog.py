"""A chat's turn log: what the model saw, kept so every request replays it.

The server keeps the log (`ChatRepository`), so the browser sends only the
new message. Replaying the log exactly is what lets a follow-up ("so what
did you find?", "undo the second one") see the earlier tool calls, results
and proposal ids, and what keeps the start of every request the same, so
model servers reuse what they already read (see
`/pr-drafts/ai-context-management.md`).

Entries, oldest first:

- ``{"kind": "user", "text": what the user typed, "sent": the message as
  the model got it (with "since your last message", page note, …)}``
- ``{"kind": "step", "text": str, "calls": [{"id", "tool", "args",
  "args_text"}], "answer": the JSON-mode object or None, "usage": {…}}`` —
  one model step. `text` is what the model wrote (JSON mode: the raw JSON).
- ``{"kind": "results", "items": [{"id", "tool", "text"}], "tail": str}`` —
  every call of the step before it gets exactly one item.
- ``{"kind": "note", "text": str}`` — a nudge from the server.

Rendering gives provider-neutral messages that `_ai_client` turns into each
API's format. A turn always ends with a step that calls nothing, so roles
alternate the way strict chat templates (Mistral) require.

Shortening is monotonic and stored in the chat's meta, never redone per
request: `masked_before` (results before that entry show only their first
line) and `dropped_before` (entries before it are left out). Each only ever
moves forward, so once applied the prefix is stable again.
"""
from __future__ import annotations

import json
import re
from typing import Any

#: User turns whose tool results always stay whole.
KEEP_TURNS = 3
MAX_CHANGES_LISTED = 8
DROPPED_NOTE = "(Earlier messages of this chat were left out to save room.)"


def dumps(value: Any) -> str:
    """JSON the same way every time: the cache needs identical bytes."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def user_entry(text: str, sent: str) -> dict[str, Any]:
    return {"kind": "user", "text": text, "sent": sent}


def step_entry(text: str, calls: list[dict[str, Any]], *, answer: Any = None,
               usage: dict[str, Any] | None = None, synthetic: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {"kind": "step", "text": text, "calls": calls, "answer": answer,
                           "usage": usage or {}}
    if synthetic:
        out["synthetic"] = True
    return out


def results_entry(items: list[dict[str, Any]], tail: str) -> dict[str, Any]:
    return {"kind": "results", "items": items, "tail": tail}


def note_entry(text: str) -> dict[str, Any]:
    return {"kind": "note", "text": text}


def _first_line(text: str) -> str:
    head = (text or "").split("\n", 1)[0]
    if len(head) > 200:
        head = head[:200] + "…"
    return head + "\n… (older result left out to save room)"


def render(entries: list[dict[str, Any]], meta: dict[str, Any]) -> list[dict[str, Any]]:
    """The log as neutral messages:

    - ``{"role": "user", "content": str}``
    - ``{"role": "assistant", "content": str, "calls": [...], "answer": …}``
    - ``{"role": "tool", "items": [{"id", "tool", "content"}], "tail": str}``

    Consecutive user messages (a note after a turn-ending result, say) are
    joined, since some chat templates refuse two in a row.
    """
    masked = int(meta.get("masked_before") or 0)
    dropped = int(meta.get("dropped_before") or 0)
    out: list[dict[str, Any]] = []
    first_user = True
    for i, e in enumerate(entries):
        if i < dropped:
            continue
        kind = e.get("kind")
        if kind in ("user", "note"):
            text = str(e.get("sent") if kind == "user" else e.get("text") or "")
            if first_user and dropped:
                text = DROPPED_NOTE + "\n\n" + text
            first_user = False
            if out and out[-1]["role"] == "user":
                out[-1]["content"] += "\n\n" + text
            else:
                out.append({"role": "user", "content": text})
        elif kind == "step":
            out.append({"role": "assistant", "content": str(e.get("text") or ""),
                        "calls": list(e.get("calls") or []), "answer": e.get("answer")})
        elif kind == "results":
            items = [{"id": it.get("id"), "tool": it.get("tool"),
                      "content": _first_line(str(it.get("text") or "")) if i < masked
                      else str(it.get("text") or "")}
                     for it in e.get("items") or []]
            out.append({"role": "tool", "items": items,
                        "tail": "" if i < masked else str(e.get("tail") or "")})
    return out


def size(messages: list[dict[str, Any]]) -> int:
    """Characters the rendered log adds to a request (an estimate)."""
    total = 0
    for m in messages:
        if m["role"] == "tool":
            total += sum(len(it["content"]) + 40 for it in m["items"]) + len(m.get("tail") or "")
        else:
            total += len(m.get("content") or "")
            for c in m.get("calls") or []:
                total += len(c.get("args_text") or dumps(c.get("args") or {})) + 40
    return total


def _user_starts(entries: list[dict[str, Any]]) -> list[int]:
    return [i for i, e in enumerate(entries) if e.get("kind") == "user"]


def fit(entries: list[dict[str, Any]], meta: dict[str, Any], limit: int) -> dict[str, Any]:
    """Meta with `masked_before` / `dropped_before` moved forward until the
    rendered log fits `limit` characters. Both only move forward and jump to
    whole turns, so this changes the prefix rarely and all at once:

    1. mask every result before the last `KEEP_TURNS` user turns;
    2. mask every result but the newest;
    3. leave out whole turns from the oldest, keeping the current one.
    """
    meta = dict(meta)
    if size(render(entries, meta)) <= limit:
        return meta
    starts = _user_starts(entries)
    if len(starts) > KEEP_TURNS:
        meta["masked_before"] = max(int(meta.get("masked_before") or 0),
                                    starts[-KEEP_TURNS])
        if size(render(entries, meta)) <= limit:
            return meta
    last_results = max((i for i, e in enumerate(entries) if e.get("kind") == "results"),
                       default=0)
    meta["masked_before"] = max(int(meta.get("masked_before") or 0), last_results)
    if size(render(entries, meta)) <= limit:
        return meta
    for start in starts[1:]:
        if start >= starts[-1]:
            break
        meta["dropped_before"] = max(int(meta.get("dropped_before") or 0), start)
        if size(render(entries, meta)) <= limit:
            return meta
    if starts:
        meta["dropped_before"] = max(int(meta.get("dropped_before") or 0), starts[-1])
    return meta


def last_reply(entries: list[dict[str, Any]]) -> str:
    """What the user last saw from the assistant: the newest step's text
    that called nothing (the JSON-mode message, when it has one)."""
    for e in reversed(entries):
        if e.get("kind") == "step" and not e.get("calls"):
            answer = e.get("answer")
            if isinstance(answer, dict) and isinstance(answer.get("message"), str):
                return answer["message"]
            return str(e.get("text") or "")
    return ""


# ── what changed between messages ───────────────────────────────────────


def fingerprint(rows: list[dict[str, Any]], kind_of: Any) -> dict[str, list[str]]:
    """id -> [name, kind, updated_at], to spot changes between messages."""
    return {str(r["id"]): [str(r.get("name") or ""), str(kind_of(r)),
                           str(r.get("updated_at") or "")]
            for r in rows if isinstance(r.get("id"), str)}


def library_changes(old: dict[str, list[str]], new: dict[str, list[str]]) -> str:
    """One line saying what was created, changed and removed, or ""."""
    if not old:
        return ""
    made = [f"{v[0]} ({k}, {v[1]})" for k, v in new.items() if k not in old]
    changed = [f"{v[0]} ({k})" for k, v in new.items() if k in old and old[k] != v]
    gone = [f"{v[0]} ({k})" for k, v in old.items() if k not in new]
    bits = []
    for label, items in (("new", made), ("changed", changed), ("removed", gone)):
        if items:
            more = f" +{len(items) - MAX_CHANGES_LISTED} more" \
                if len(items) > MAX_CHANGES_LISTED else ""
            bits.append(f"{label}: {', '.join(sorted(items)[:MAX_CHANGES_LISTED])}{more}")
    return ("Library changed since the last message: " + "; ".join(bits) + ".") if bits else ""


_STATUS_WORDS = {
    "applied": "applied", "editor": "put into the open editor (not saved yet)",
    "dismissed": "dismissed", "undone": "undone", "failed": "failed to apply",
}


def apply_events(meta: dict[str, Any], events: Any) -> tuple[dict[str, Any], str]:
    """Record what the user did with proposal cards since the last message
    and say it in one line for the model."""
    meta = dict(meta)
    proposals = dict(meta.get("proposals") or {})
    said: list[str] = []
    for ev in events if isinstance(events, list) else []:
        if not isinstance(ev, dict):
            continue
        pid, status = ev.get("pid"), ev.get("status")
        if not isinstance(pid, str) or pid not in proposals or status not in _STATUS_WORDS:
            continue
        info = dict(proposals[pid])
        if info.get("status") == status:
            continue
        info["status"] = status
        proposals[pid] = info
        said.append(f"{pid} \"{info.get('title', '')}\" {_STATUS_WORDS[status]}")
    meta["proposals"] = proposals
    line = ("Since your last message the user " + "; ".join(said) + ".") if said else ""
    return meta, line


_TITLE_WS = re.compile(r"\s+")


def title_for(text: str) -> str:
    """A chat's title from its first message."""
    t = _TITLE_WS.sub(" ", text or "").strip()
    return t if len(t) <= 60 else t[:59].rstrip() + "…"
