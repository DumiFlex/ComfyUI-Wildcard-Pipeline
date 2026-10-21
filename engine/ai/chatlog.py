"""A chat's turn log: what the model saw, kept so every request replays it.

The server keeps the log (`ChatRepository`), so the browser sends only the
new message. Replaying the log exactly is what lets a follow-up ("so what
did you find?", "undo the second one") see the earlier tool calls, results
and proposal ids, and what keeps the start of every request the same, so
model servers reuse what they already read (see
`/pr-drafts/ai-context-management.md`).

Entries, oldest first:

- ``{"kind": "user", "text": what the user typed, "sent": the message as
  the model got it (with "since your last message", page note, …),
  "images"?: [{"media_type", "data" (base64), "w", "h"}]}`` — images the
  user attached, checked and re-encoded by `wp_api/_ai_images.py`.
- ``{"kind": "step", "text": str, "calls": [{"id", "tool", "args",
  "args_text"}], "answer": the JSON-mode object or None, "usage": {…},
  "model"?: str, "raw"?: [...]}`` — one model step. `text` is what the model
  wrote (JSON mode: the raw JSON). `raw` is what OpenAI's Responses API
  returned (encrypted reasoning, the message, the calls), replayed as is to
  the same model.
- ``{"kind": "results", "items": [{"id", "tool", "text"}], "tail": str}`` —
  every call of the step before it gets exactly one item.
- ``{"kind": "note", "text": str}`` — a nudge from the server.
- ``{"kind": "shown", "view": {message, steps, proposals, refs, …}}`` — what
  the user saw for this part of the turn, so the chat list can reopen it.
  The model never sees it (`render` skips it). Its view's ``reaction`` (the
  `react` tool's emoji) shows on the user message before it.
- ``{"kind": "aside", "text": str, "reaction": emoji}`` — a message that was
  only thanks or praise (`engine/ai/react.py:quick`): it got a reaction and
  no model call. `render` skips it, so the model's prefix stays the same.

Rendering gives provider-neutral messages that `_ai_client` turns into each
API's format. A turn always ends with a step that calls nothing, so roles
alternate the way strict chat templates (Mistral) require.

Shortening is monotonic and stored in the chat's meta, never redone per
request: `masked_before` (results before that entry show only their first
line) and `dropped_before` (entries before it are left out). Each only ever
moves forward, so once applied the prefix is stable again. Images follow
the same rule with `images_before`: only the newest `MAX_IMAGES_SENT` go to
the model, older ones become a line of text.
"""
from __future__ import annotations

import json
import re
from typing import Any

#: User turns whose tool results always stay whole.
KEEP_TURNS = 3
MAX_CHANGES_LISTED = 8
DROPPED_NOTE = "(Earlier messages of this chat were left out to save room.)"
SUMMARY_HEAD = "Earlier in this chat (a summary of messages left out to save room):\n"
#: Images sent to the model per request; older ones become a line of text.
MAX_IMAGES_SENT = 8
#: Pixels per token of an image (Claude's estimate; close enough for the
#: local encoders, which use fewer).
IMAGE_PIXELS_PER_TOKEN = 750
#: Characters per token, as `budget.CHARS_PER_TOKEN` (no import: budget
#: is the higher layer).
_CHARS_PER_TOKEN = 3.2


def dumps(value: Any) -> str:
    """JSON the same way every time: the cache needs identical bytes."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def user_entry(text: str, sent: str,
               images: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"kind": "user", "text": text, "sent": sent}
    if images:
        out["images"] = images
    return out


def _image_line(img: dict[str, Any]) -> str:
    return (f"(An image the user sent earlier ({img.get('w')}×{img.get('h')}) was left out "
            "to save room.)")


def image_chars(img: dict[str, Any]) -> int:
    """What an image costs a request, in characters (for the budget)."""
    try:
        px = int(img.get("w") or 0) * int(img.get("h") or 0)
    except (TypeError, ValueError):
        px = 0
    return int(max(px, 200 * 200) / IMAGE_PIXELS_PER_TOKEN * _CHARS_PER_TOKEN)


def move_images(entries: list[dict[str, Any]], meta: dict[str, Any]) -> dict[str, Any]:
    """Meta with `images_before` moved forward (whole messages at a time)
    until at most `MAX_IMAGES_SENT` images are sent."""
    start = int(meta.get("images_before") or 0)
    holders = [(i, len(e.get("images") or [])) for i, e in enumerate(entries)
               if i >= start and e.get("kind") == "user" and e.get("images")]
    total = sum(n for _, n in holders)
    k = 0
    while total > MAX_IMAGES_SENT and k < len(holders) - 1:
        total -= holders[k][1]
        k += 1
        start = holders[k][0]
    if start == int(meta.get("images_before") or 0):
        return meta
    return {**meta, "images_before": start}


def step_entry(text: str, calls: list[dict[str, Any]], *, answer: Any = None,
               usage: dict[str, Any] | None = None, synthetic: bool = False,
               model: str = "", raw: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"kind": "step", "text": text, "calls": calls, "answer": answer,
                           "usage": usage or {}}
    if raw:
        out["raw"] = raw
    if model:
        out["model"] = model  # which model wrote it (the chat's model can change)
    if synthetic:
        out["synthetic"] = True
    return out


def shown_entry(view: dict[str, Any]) -> dict[str, Any]:
    return {"kind": "shown", "view": view}


def last_shown(entries: list[dict[str, Any]]) -> str:
    """The message of the last answer the user saw (what they reply to)."""
    for e in reversed(entries):
        if e.get("kind") == "shown" and isinstance(e.get("view"), dict):
            return str(e["view"].get("message") or "")
        if e.get("kind") == "user":
            return ""
    return ""


def aside_entry(text: str, reaction: str) -> dict[str, Any]:
    return {"kind": "aside", "text": text, "reaction": reaction}


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
    shown_from = int(meta.get("images_before") or 0)
    out: list[dict[str, Any]] = []
    first_user = True
    for i, e in enumerate(entries):
        if i < dropped:
            continue
        kind = e.get("kind")
        if kind in ("user", "note"):
            text = str(e.get("sent") if kind == "user" else e.get("text") or "")
            if first_user and meta.get("summary") and dropped:
                text = SUMMARY_HEAD + str(meta["summary"]) + "\n\n" + text
            elif first_user and dropped:
                text = DROPPED_NOTE + "\n\n" + text
            first_user = False
            images = [dict(im) for im in e.get("images") or []] if kind == "user" else []
            if images and i < shown_from:
                text = "\n".join(_image_line(im) for im in images) + "\n\n" + text
                images = []
            if out and out[-1]["role"] == "user":
                out[-1]["content"] += "\n\n" + text
                if images:
                    out[-1]["images"] = [*out[-1].get("images", []), *images]
            else:
                msg: dict[str, Any] = {"role": "user", "content": text}
                if images:
                    msg["images"] = images
                out.append(msg)
        elif kind == "step":
            msg = {"role": "assistant", "content": str(e.get("text") or ""),
                   "calls": list(e.get("calls") or []), "answer": e.get("answer")}
            if e.get("raw"):
                msg["raw"] = e["raw"]
                msg["model"] = e.get("model") or ""
            out.append(msg)
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
            total += sum(image_chars(im) for im in m.get("images") or [])
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


def last_user_text(entries: list[dict[str, Any]]) -> str:
    """The user's newest message (what a resumed turn is still answering)."""
    for e in reversed(entries):
        if e.get("kind") == "user":
            return str(e.get("text") or "")
    return ""


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
    "replaced": "replaced by a newer card",
    "opened": "opened in a new editor to finish there (not saved yet, and the user may "
              "change it; it has no id until they save)",
}


#: Cards with one status in one message that are said together.
MANY_EVENTS = 3


def apply_events(meta: dict[str, Any], events: Any) -> tuple[dict[str, Any], str]:
    """Record what the user did with proposal cards since the last message
    and say it in one line for the model."""
    meta = dict(meta)
    proposals = dict(meta.get("proposals") or {})
    said: list[str] = []
    #: Plain status changes by status, said as one part per status when a
    #: group card applies or dismisses many cards at once.
    plain: dict[str, list[str]] = {}
    for ev in events if isinstance(events, list) else []:
        if not isinstance(ev, dict):
            continue
        pid, status = ev.get("pid"), ev.get("status")
        fix = ev.get("fix")
        if isinstance(pid, str) and pid in proposals and isinstance(fix, str):
            # The user used one of the card's own fixes (`lint.fixes`).
            info = dict(proposals[pid])
            done = list(info.get("fixes") or [])
            if fix not in done and len(done) < 8:
                info["fixes"] = [*done, fix]
                proposals[pid] = info
                label = ev.get("label") if isinstance(ev.get("label"), str) else fix
                said.append(f"{pid} \"{info.get('title', '')}\": used the card's fix "
                            f"\"{label[:60]}\" (the card changed; the user still has to apply it)")
            continue
        if not isinstance(pid, str) or pid not in proposals or status not in _STATUS_WORDS:
            continue
        info = dict(proposals[pid])
        if info.get("status") == status:
            continue
        info["status"] = status
        proposals[pid] = info
        left = ev.get("left_out")
        part = ""
        if isinstance(left, int) and not isinstance(left, bool) and left > 0 \
                and status in ("applied", "editor", "opened"):
            part = f" without {left} of its options (the user left them out)"
        if part:
            said.append(f"{pid} \"{info.get('title', '')}\" {_STATUS_WORDS[status]}{part}")
        else:
            plain.setdefault(status, []).append(f"{pid} \"{info.get('title', '')}\"")
    for status, cards in plain.items():
        if len(cards) >= MANY_EVENTS:
            said.append(f"{_STATUS_WORDS[status]} {len(cards)} cards: {', '.join(cards)}")
        else:
            said.extend(f"{c} {_STATUS_WORDS[status]}" for c in cards)
    meta["proposals"] = proposals
    line = ("Since your last message the user " + "; ".join(said) + ".") if said else ""
    return meta, line


_TITLE_WS = re.compile(r"\s+")
#: Openers that say nothing about the chat ("could you please …").
_FILLER = re.compile(
    r"^(?:(?:hi|hey|hello|ok(?:ay)?|so|um|please|pls|(?:can|could|would|will) (?:you|we|u)|"
    r"i want(?: you)? to|i'd like(?: you)? to|i would like(?: you)? to|help me to|"
    r"let'?s)[\s,!.]+)+",
    re.IGNORECASE,
)
TITLE_CHARS = 60


def title_for(text: str) -> str:
    """A chat's title from its first message: its first line without the
    polite opener, cut at a word. The model isn't asked: that would be a
    second request on a local GPU (or a paid one) for every chat."""
    t = _TITLE_WS.sub(" ", (text or "").strip().split("\n", 1)[0]).strip()
    short = _FILLER.sub("", t).strip(" ,.!?")
    if len(short) >= 4:
        t = short[0].upper() + short[1:]
    t = t.rstrip(" ?.!") or (text or "").strip()[:TITLE_CHARS]
    if len(t) <= TITLE_CHARS:
        return t
    cut = t.rfind(" ", 0, TITLE_CHARS - 1)
    return t[:cut if cut > TITLE_CHARS // 2 else TITLE_CHARS - 1].rstrip(" ,;:") + "…"


def display(entries: list[dict[str, Any]], meta: dict[str, Any]) -> list[dict[str, Any]]:
    """The chat as the user saw it, for reopening from the chat list:
    ``{"role": "user", "text"}`` and ``{"role": "assistant", "view", "status",
    "created"}``. Card status comes from what the browser reported (applied,
    undone, …); a turn from before `shown` entries existed shows its reply
    text only."""
    shown_status = meta.get("shown_status") or {}
    model_status = meta.get("proposals") or {}

    def status_of(view: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
        status: dict[str, str] = {}
        created: dict[str, str] = {}
        for p in view.get("proposals") or []:
            pid = p.get("pid") if isinstance(p, dict) else None
            if not isinstance(pid, str):
                continue
            seen = shown_status.get(pid) or {}
            st = seen.get("status") or (model_status.get(pid) or {}).get("status")
            if st in ("applied", "editor", "dismissed", "failed", "opened"):
                status[pid] = st
            if isinstance(seen.get("created"), str) and st == "applied":
                created[pid] = seen["created"]
        return status, created

    out: list[dict[str, Any]] = []
    span: list[dict[str, Any]] = []

    def close() -> None:
        if span and not any(e.get("kind") == "shown" for e in span):
            # A turn from before `shown` entries: its last words, else the
            # last step that said anything, else say it was empty (never
            # leave the turn out: the user's message would look unanswered).
            reply = last_reply(span) or next(
                (str(e.get("text") or "") for e in reversed(span)
                 if e.get("kind") == "step" and str(e.get("text") or "").strip()), "")
            if not reply and any(e.get("kind") == "step" for e in span):
                reply = "(The model gave an empty answer.)"
            if reply:
                model = next((str(e["model"]) for e in reversed(span)
                              if e.get("kind") == "step" and e.get("model")),
                             str(meta.get("model") or ""))
                out.append({"role": "assistant", "view": {"message": reply, "steps": [],
                            "proposals": [], "refs": {}, "model": model},
                            "status": {}, "created": {}})

    for e in entries:
        kind = e.get("kind")
        if kind == "user":
            close()
            span = []
            turn: dict[str, Any] = {"role": "user", "text": str(e.get("text") or "")}
            if e.get("images"):
                turn["images"] = [f"data:{im.get('media_type')};base64,{im.get('data')}"
                                  for im in e["images"]]
            out.append(turn)
        elif kind == "aside":
            out.append({"role": "user", "text": str(e.get("text") or ""),
                        "reaction": str(e.get("reaction") or ""), "aside": True})
        elif kind == "shown" and isinstance(e.get("view"), dict):
            view = answered_view(fixed_view(e["view"], meta), meta)
            if view.get("reaction"):
                asker = next((t for t in reversed(out) if t["role"] == "user"
                              and not t.get("aside")), None)
                if asker is not None:
                    asker["reaction"] = view["reaction"]
            status, created = status_of(view)
            out.append({"role": "assistant", "view": view, "status": status,
                        "created": created})
        span.append(e)
    close()
    return out


def answered_view(view: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """A shown answer with what the user answered to its `ask` questions
    (`meta["asked"]`, call id -> answers), as ``view["answered"]``."""
    asked = meta.get("asked") or {}
    ids = [c.get("id") for c in view.get("pending") or []
           if isinstance(c, dict) and c.get("tool") == "ask" and c.get("id") in asked]
    if not ids:
        return view
    return {**view, "answered": {i: asked[i] for i in ids}}


def fixed_view(view: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """A shown answer with the card fixes the user used made (`meta["fixes"]`,
    pid -> keys), so a reopened chat shows its cards as they were left."""
    fixes = meta.get("fixes") or {}
    props = view.get("proposals") or []
    if not fixes or not any(isinstance(p, dict) and p.get("pid") in fixes for p in props):
        return view
    from engine.ai import lint
    return {**view, "proposals": [
        lint.with_fixes(p, list(fixes.get(p.get("pid")) or []))
        if isinstance(p, dict) and p.get("pid") in fixes else p for p in props]}


def last_turn_start(entries: list[dict[str, Any]]) -> int | None:
    """Index of the newest user entry (where a retried turn starts)."""
    for i in range(len(entries) - 1, -1, -1):
        if entries[i].get("kind") == "user":
            return i
    return None
