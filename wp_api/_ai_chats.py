"""Saved chats: list, reopen, rename/pin/card status, delete, compact,
and the vision check the drawer asks before attaching images."""
from __future__ import annotations

from typing import Any

from aiohttp import web

from engine.ai import budget as ai_budget
from engine.ai import chatlog as ai_chatlog
from engine.ai import compact as ai_compact
from engine.ai import config as ai_config
from engine.ai import examples as ai_examples
from engine.ai import lint as ai_lint
from engine.ai import safety as ai_safety
from engine.db.repositories import (
    ChatNotFound,
    ChatRepository,
)
from wp_api import (
    _ai_chat,
)
from wp_api._ai_common import (
    _body,
    _enabled_cfg,
)
from wp_api._ai_context import (
    CLOUD_WINDOW,
    _context,
    _maybe_compact,
    _window,
)
from wp_api._helpers import db_session, json_error, json_ok

# ── the chat list ───────────────────────────────────────────────────────


def _chat_id(request: web.Request) -> str:
    return str(request.match_info.get("chat_id") or "")[:40]


async def get_vision(request: web.Request) -> web.Response:
    """Whether the chosen model sees images: true, false, or null when the
    server doesn't say."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    return json_ok({"vision": await _ai_chat.vision_support(cfg), "model": cfg.get("model")})


async def get_chats(request: web.Request) -> web.Response:
    """The stored chats, pinned first, then newest. `?q=` searches titles
    and what was said."""
    q = str(request.query.get("q") or "")
    with db_session(request) as conn:
        return json_ok({"chats": ChatRepository(conn).list(q)})


async def get_chat(request: web.Request) -> web.Response:
    """One chat as the user saw it, to reopen it in the drawer."""
    with db_session(request) as conn:
        repo = ChatRepository(conn)
        try:
            chat = repo.get(_chat_id(request))
        except ChatNotFound:
            return json_error("that chat is gone", status=404)
        log = repo.messages(chat["id"])
    meta = chat["meta"]
    cfg = ai_config.load_effective()
    usage = next((e.get("usage") or {} for e in reversed(log) if e.get("kind") == "step"), {})
    window = int(meta.get("window") or 0) or (
        CLOUD_WINDOW.get(str(cfg.get("api")), 128000) if not cfg.get("local")
        else int(cfg.get("context_max") or ai_budget.CONTEXT_DEFAULT))
    return json_ok({
        "id": chat["id"], "title": chat["title"], "pinned": chat.get("pinned", False),
        "updated_at": chat["updated_at"], "model": meta.get("model"),
        "turns": ai_chatlog.display(log, meta),
        "waiting": bool(meta.get("pending")),
        "summary": str(meta.get("summary") or ""),
        "context": _context(cfg, meta, log, len(chat.get("snapshot") or "") + 12000, usage,
                            window),
    })


async def patch_chat(request: web.Request) -> web.Response:
    """Body: {title?, pinned?, events?: [{pid, status, created?}]}. Events
    record what the user did with cards for reopening the chat; the model
    is told on the next message, as before."""
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    title = body.get("title")
    if title is not None:
        if not isinstance(title, str) or not title.strip():
            return json_error("a chat needs a title", status=400)
        title = ai_safety.strip_invisible(title).strip()[:120]
    pinned = body.get("pinned")
    if pinned is not None and not isinstance(pinned, bool):
        return json_error("pinned must be true or false", status=400)
    with db_session(request) as conn:
        repo = ChatRepository(conn)
        try:
            chat = repo.update(_chat_id(request), title=title, pinned=pinned)
        except ChatNotFound:
            return json_error("that chat is gone", status=404)
        events = body.get("events")
        bodies: dict[str, Any] = {}
        log: list[dict[str, Any]] | None = None
        if isinstance(events, list) and events:
            meta = dict(chat["meta"])
            seen = dict(meta.get("shown_status") or {})
            for ev in events[:200]:
                if not isinstance(ev, dict) or not isinstance(ev.get("pid"), str):
                    continue
                if isinstance(ev.get("fix"), str):
                    if log is None:
                        log = repo.messages(chat["id"])
                    fixed = _record_fix(log, meta, ev["pid"][:12], ev["fix"][:40])
                    if fixed is not None:
                        bodies[ev["pid"][:12]] = fixed
                    continue
                if ev.get("status") not in ("applied", "editor", "dismissed", "failed", "undone",
                                            "opened"):
                    continue
                entry = {"status": ev["status"]}
                left = ev.get("left_out")
                if isinstance(left, int) and not isinstance(left, bool) and 0 < left <= 1000:
                    entry["left_out"] = left
                if isinstance(ev.get("created"), str) and len(ev["created"]) <= 40:
                    entry["created"] = ev["created"]
                seen[ev["pid"][:12]] = entry
                if ev["status"] == "applied":
                    _keep_example(meta, ev["pid"][:12])
            meta["shown_status"] = seen
            repo.set_meta(chat["id"], meta)
    out: dict[str, Any] = {"id": chat["id"], "title": chat["title"], "pinned": chat["pinned"]}
    if bodies:
        out["fixed"] = bodies
    return json_ok(out)


def _keep_example(meta: dict[str, Any], pid: str) -> None:
    """An applied card's request and call, kept as a worked example for
    small and medium models (`engine/ai/examples.py`). Once per card."""
    card = (meta.get("proposals") or {}).get(pid)
    ex = card.get("ex") if isinstance(card, dict) else None
    if not isinstance(ex, dict) or card.get("kept"):
        return
    if ai_examples.add(str(ex.get("ask") or ""),
                       [{"tool": ex.get("tool"), "args": ex.get("args") or {}}]):
        card["kept"] = True


def _record_fix(log: list[dict[str, Any]], meta: dict[str, Any], pid: str,
                key: str) -> dict[str, Any] | None:
    """Make one of card ``pid``'s own fixes (`lint.fixes`) and remember it,
    so reopening the chat and later answers see the card as fixed. Returns
    the card's new op body, or None when the card has no such fix."""
    card = None
    for e in log:
        if e.get("kind") == "shown":
            for p in (e.get("view") or {}).get("proposals") or []:
                if isinstance(p, dict) and p.get("pid") == pid:
                    card = p
    if card is None or key not in {f.get("key") for f in card.get("fixes") or []
                                   if isinstance(f, dict)}:
        return None
    fixes = dict(meta.get("fixes") or {})
    keys = list(fixes.get(pid) or [])
    if key not in keys:
        keys.append(key)
    fixes[pid] = keys
    meta["fixes"] = fixes
    body = ai_lint.fixed_body(card, keys)
    return body if body is not None else (card.get("op") or {}).get("body")


async def delete_chat(request: web.Request) -> web.Response:
    with db_session(request) as conn:
        try:
            ChatRepository(conn).delete(_chat_id(request))
        except ChatNotFound:
            return json_error("that chat is gone", status=404)
    return json_ok({"deleted": True})


async def post_compact(request: web.Request) -> web.Response:
    """Summarise a chat's older turns now (the meter's Compact)."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    with db_session(request) as conn:
        repo = ChatRepository(conn)
        try:
            chat = repo.get(_chat_id(request))
        except ChatNotFound:
            return json_error("that chat is gone", status=404)
        log = repo.messages(chat["id"])
    meta = dict(chat["meta"])
    if meta.get("pending"):
        return json_error("this chat is waiting for an answer", status=409)
    if ai_compact.best_split(log, meta) is None:
        return json_error("nothing to summarize yet: your latest message always stays whole",
                          status=409)
    prof = ai_budget.profile(cfg)
    num_ctx = int(cfg.get("context_max") or ai_budget.CONTEXT_DEFAULT)
    window = await _window(cfg, meta)
    after = await _maybe_compact(cfg, log, meta, prof, num_ctx, window,
                                 len(chat.get("snapshot") or "") + 12000, None, force=True)
    if after.get("compactions") == meta.get("compactions"):
        return json_error("the model couldn't write a summary; try again", status=502)
    with db_session(request) as conn:
        ChatRepository(conn).set_meta(chat["id"], after)
    usage: dict[str, Any] = {}
    return json_ok({"compacted": True, "summary": str(after.get("summary") or ""),
                    "context": _context(cfg, after, log, len(chat.get("snapshot") or "") + 12000,
                                        usage, window)})
