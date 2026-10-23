"""What each chat answer offered the model and what the model did with it,
kept so small-model changes can be judged on real chats (research note
"Request-aware prompts", Phase 0).

One trace per answer, stored on its ``shown`` entry (the model never
reads it). `scripts/ai_trace_report.py` sums them over a library's chats:
shortlist misses (`more_tools` calls), docs lookups, nudges, repeats and
prompt re-reads.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from engine.ai import chat as ai_chat

#: Note texts the turn sends, by name: every ``*_NUDGE`` / ``*_NOTE``
#: string in `engine/ai/chat.py`, matched on its start.
_KNOWN: tuple[tuple[str, str], ...] = tuple(sorted(
    ((v[:48], k.lower()) for k, v in vars(ai_chat).items()
     if k.isupper() and k.endswith(("_NUDGE", "_NOTE")) and isinstance(v, str) and len(v) >= 24),
    key=lambda kv: -len(kv[0])))

#: The tail blocks a user message can carry, in the order `_prepare` joins them.
TAIL_KINDS = ("since", "changes", "perms", "images", "page", "library", "model", "examples",
              "cards", "recipe", "plan")

#: A re-read: a request with a prompt this size or more that came back
#: with no more than this share cached.
REREAD_MIN_PROMPT = 2000
REREAD_SHARE = 0.5


def nudge_label(text: Any) -> str:
    """The name of the note a turn sent (``empty_nudge``), or "other"."""
    s = str(text or "")
    for head, name in _KNOWN:
        if s.startswith(head):
            return name
    return "other"


def tail_kinds(parts: dict[str, Any]) -> list[str]:
    """The non-empty tail blocks of a user message, by `TAIL_KINDS` name."""
    return [k for k in TAIL_KINDS if parts.get(k)]


def step_record(n: int, offered: list[str] | None, calls: list[dict[str, Any]],
                usage: dict[str, Any], seconds: float | None = None) -> dict[str, Any]:
    """One model step: the tools its grammar offered (None: every tool of
    the chat), the tools it called, its token counts (`thought`: the
    reasoning part of `output`, where the server says) and how long it took."""
    out: dict[str, Any] = {"n": n, "called": [str(c.get("tool")) for c in calls]}
    if offered is not None:
        out["offered"] = list(offered)
    if seconds is not None:
        out["seconds"] = round(seconds, 1)
    for key in ("prompt", "cached", "output", "thought"):
        v = usage.get(key) if isinstance(usage, dict) else None
        if isinstance(v, int):
            out[key] = v
    return out


def timed_out_record(n: int, offered: list[str] | None, seconds: float) -> dict[str, Any]:
    """A step the model never finished within the step limit: no usage
    comes back, so without it a stalled turn's time shows up nowhere."""
    out = step_record(n, offered, [], {}, seconds)
    out["timed_out"] = True
    return out


def turn_record(*, steps: list[dict[str, Any]], tail: list[str], short: Any,
                notes: list[str], refused: dict[str, int], errors: dict[str, int],
                widened: bool, plan_n: int, model: Any, profile: Any,
                asks: str = "task") -> dict[str, Any]:
    """The trace stored with one answer."""
    out: dict[str, Any] = {"steps": steps, "tail": list(tail), "model": str(model or ""),
                           "profile": str(profile or "")}
    if short is not None:
        out["short"] = list(short)
    if notes:
        out["notes"] = [nudge_label(n) for n in notes]
    if refused:
        out["refused"] = dict(refused)
    if errors:
        out["errors"] = dict(errors)
    if widened:
        out["widened"] = True
    if plan_n:
        out["plan_n"] = plan_n
    if asks != "task":
        out["asks"] = asks
    return out


def rereads(trace: dict[str, Any]) -> int:
    """Steps after the first whose prompt came back mostly uncached."""
    n = 0
    for st in (trace.get("steps") or [])[1:]:
        prompt, cached = st.get("prompt"), st.get("cached")
        if isinstance(prompt, int) and isinstance(cached, int) \
                and prompt >= REREAD_MIN_PROMPT and cached <= prompt * REREAD_SHARE:
            n += 1
    return n


def summarize(traces: list[dict[str, Any]]) -> dict[str, Any]:
    """Totals over many answers' traces, for the report script."""
    called: Counter[str] = Counter()
    notes: Counter[str] = Counter()
    tails: Counter[str] = Counter()
    refused: Counter[str] = Counter()
    out: dict[str, Any] = {"answers": 0, "steps": 0, "shortlisted": 0, "widened": 0,
                           "more_tools": 0, "docs": 0, "rereads": 0, "prompt_tokens": 0,
                           "cached_tokens": 0, "thought_tokens": 0, "timed_out": 0,
                           "seconds": 0.0, "slowest": 0.0, "questions": 0,
                           "question_changes": 0, "first_offered": 0}
    for tr in traces:
        if not isinstance(tr, dict):
            continue
        out["answers"] += 1
        steps = [s for s in tr.get("steps") or [] if isinstance(s, dict)]
        out["steps"] += len(steps)
        out["shortlisted"] += int("short" in tr)
        out["widened"] += int(bool(tr.get("widened")))
        out["rereads"] += rereads(tr)
        if tr.get("asks") in ("question", "chat"):
            out["questions"] += 1
            out["question_changes"] += int(any(
                t.startswith(("create_", "add_", "edit_", "update_"))
                for st in steps for t in st.get("called") or []))
        if steps and isinstance(steps[0].get("offered"), list):
            out["first_offered"] = max(out["first_offered"], len(steps[0]["offered"]))
        for st in steps:
            for tool in st.get("called") or []:
                called[tool] += 1
            out["prompt_tokens"] += int(st.get("prompt") or 0)
            out["cached_tokens"] += int(st.get("cached") or 0)
            out["thought_tokens"] += int(st.get("thought") or 0)
            out["timed_out"] += int(bool(st.get("timed_out")))
            secs = float(st.get("seconds") or 0)
            out["seconds"] += secs
            out["slowest"] = max(out["slowest"], secs)
        notes.update(tr.get("notes") or [])
        tails.update(tr.get("tail") or [])
        refused.update(tr.get("refused") or {})
    out["more_tools"] = called.get("more_tools", 0)
    out["docs"] = called.get("explain", 0) + called.get("docs_search", 0)
    out["called"] = dict(called.most_common())
    out["notes"] = dict(notes.most_common())
    out["tail"] = dict(tails.most_common())
    out["refused"] = dict(refused.most_common(15))
    out["seconds"] = round(out["seconds"], 1)
    return out
