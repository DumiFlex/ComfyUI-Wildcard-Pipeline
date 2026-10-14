"""What a running AI request is doing, for the "working" line in the browser.

The chat streams its own events. The draft panels and the pack builder wait
on one plain request that can take a minute on a local model, so the browser
names that request with an ``X-WP-Progress`` id and polls
``GET /wp/api/ai/progress/{id}`` while it waits. `complete_json` streams the
model's answer when an id is set and records here what it sees: the prompt
sent and not answered yet (the model is reading it), reasoning arriving, or
the answer being written (with its length so far).

Nothing here is needed for the answer itself: no id, no streaming, no entry.
"""
from __future__ import annotations

import contextvars
import functools
import re
import time
from typing import Any

#: The id of the request being served, set by `track`.
current: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "wp_ai_progress", default=None)

_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
#: Entries kept, oldest dropped first; a finished one lingers for a poll.
_KEEP = 64
_LINGER_S = 30.0

_entries: dict[str, dict[str, Any]] = {}


def valid(pid: str | None) -> bool:
    return bool(pid) and bool(_ID.match(pid or ""))


def begin(pid: str) -> None:
    now = time.monotonic()
    for k in [k for k, v in _entries.items()
              if v["done"] and now - v["updated"] > _LINGER_S]:
        del _entries[k]
    while len(_entries) >= _KEEP:
        del _entries[next(iter(_entries))]
    _entries[pid] = {"phase": "starting", "chars": 0, "calls": 0, "done": False,
                     "started": now, "updated": now}


def finish(pid: str) -> None:
    e = _entries.get(pid)
    if e is not None:
        e.update(done=True, phase="done", updated=time.monotonic())


def _set(**fields: Any) -> None:
    e = _entries.get(current.get() or "")
    if e is not None:
        e.update(fields, updated=time.monotonic())


def call_started() -> None:
    """A model request went out: its prompt is being read."""
    e = _entries.get(current.get() or "")
    if e is not None:
        _set(phase="reading", chars=0, calls=e["calls"] + 1)


async def on_event(ev: dict[str, Any]) -> None:
    """The emit given to `_ai_chat._post`: its `thinking` / `text` events."""
    if ev.get("type") == "thinking":
        _set(phase="thinking")
    elif ev.get("type") == "text":
        _set(phase="writing", chars=len(str(ev.get("v") or "")))


def active() -> bool:
    return (current.get() or "") in _entries


def view(pid: str) -> dict[str, Any] | None:
    e = _entries.get(pid)
    if e is None:
        return None
    return {
        "phase": e["phase"],
        # About four characters a token; enough to see it moving.
        "tokens": e["chars"] // 4,
        "calls": e["calls"],
        "seconds": round(time.monotonic() - e["started"], 1),
        "done": e["done"],
    }


def track(handler: Any) -> Any:
    """Wraps an AI route: a request carrying ``X-WP-Progress`` records its
    progress under that id while it runs."""
    @functools.wraps(handler)
    async def wrapped(request: Any) -> Any:
        pid = request.headers.get("X-WP-Progress")
        if not valid(pid):
            return await handler(request)
        begin(pid)
        token = current.set(pid)
        try:
            return await handler(request)
        finally:
            current.reset(token)
            finish(pid)

    return wrapped
