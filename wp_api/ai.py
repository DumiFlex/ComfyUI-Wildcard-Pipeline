"""/wp/api/ai/* — the AI assistant.

    GET  /wp/api/ai/config          settings without the key (+ key_set)
    PUT  /wp/api/ai/config          partial update; `api_key` is write-only
    POST /wp/api/ai/models          list the server's models (uses saved config)
    POST /wp/api/ai/test            Test connection: models + a tiny JSON call
    POST /wp/api/ai/wildcard/draft  new options for a wildcard (not saved)
    POST /wp/api/ai/wildcard/edit   remove / rewrite / retag / re-weight
                                    options (a before/after list, not saved)
    POST /wp/api/ai/derivation/draft  derivation rules from a description
    POST /wp/api/ai/constraint/draft  constraint cells + exceptions from a
                                      description
    POST /wp/api/ai/describe        a description + library tags for a
                                    module, bundle or template
    POST /wp/api/ai/organize        category, tags and rating for a batch
                                    of modules and bundles
    POST /wp/api/ai/chat            a chat turn: the model reads the library
                                    with tools and proposes changes; the
                                    server keeps the chat (`ai_chats`)
    POST /wp/api/ai/pack/plan       pack builder: an outline from a request
    POST /wp/api/ai/pack/change     pack builder: rewrite or add one plan item
    POST /wp/api/ai/pack/search     pack builder: run web searches the user allowed
    POST /wp/api/ai/pack/review     check a plan against the guide (+ model review)
    POST /wp/api/ai/pack/item       build one planned item (not saved)
    POST /wp/api/ai/pack/check      run the built pack on the engine
    POST /wp/api/ai/pack/install    install the pack as one undoable import
    POST /wp/api/ai/bundle/split    group a bundle's children into sub-bundles

Every drafting route also takes `history` (earlier turns of the same
conversation, see `engine/ai/followup.py`) and returns the model's raw
`answer`, so the editor can send a follow-up that refines the last answer.

Off by default: every route except the config pair answers 403 until the user
turns the assistant on. Nothing here writes to the library. Drafts come back
to the editor, which inserts them like any pasted option and saves only when
the user does. See `_ai_client.py` for the threat model.

This module holds settings, Test connection, the library index and route
registration. The handlers live by feature: `_ai_drafts.py` (editor panels),
`_ai_turn.py` (a chat turn), `_ai_context.py` (what a turn sends the model),
`_ai_chats.py` (saved chats), `_ai_pack.py` (pack builder) and
`_ai_common.py` (what they share). Register every new route here with `add`.
"""
from __future__ import annotations

import json as _json
from typing import Any

from aiohttp import web

from engine.ai import budget as ai_budget
from engine.ai import chat as ai_chat
from engine.ai import config as ai_config
from engine.ai import index as ai_index
from engine.db.repositories import (
    BundleRepository,
    CategoryRepository,
    ModuleRepository,
    TemplateRepository,
)
from wp_api import (
    _ai_chat,
    _ai_client,
    _ai_embed,
    _ai_progress,
    _ai_search,
)
from wp_api._ai_chats import (
    delete_chat,
    get_chat,
    get_chats,
    get_vision,
    patch_chat,
    post_compact,
)
from wp_api._ai_common import (
    _body,
    _enabled_cfg,
)
from wp_api._ai_context import (
    _LIBRARY_HEAD,
    _decls,
    _fixed_chars,
    _lean,
    _library_index_for,
    _open_chat,
    _splits,
    _synced_index,
    _window,
)
from wp_api._ai_drafts import (
    post_constraint_draft,
    post_derivation_draft,
    post_describe,
    post_organize,
    post_text_draft,
    post_wildcard_draft,
    post_wildcard_edit,
)
from wp_api._ai_guard import guarded
from wp_api._ai_pack import (
    post_bundle_split,
    post_pack_change,
    post_pack_check,
    post_pack_install,
    post_pack_item,
    post_pack_plan,
    post_pack_review,
    post_pack_search,
)
from wp_api._ai_turn import (
    post_chat,
)
from wp_api._helpers import cancel_on_disconnect, db_session, json_error, json_ok


async def get_config(request: web.Request) -> web.Response:
    return json_ok(ai_config.public_view())


async def put_config(request: web.Request) -> web.Response:
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    try:
        return json_ok(ai_config.update(body))
    except ai_config.ConfigError as e:
        return json_error(str(e), status=400)
    except OSError as e:
        return json_error(f"could not save AI settings: {e}", status=500)


async def post_models(request: web.Request) -> web.Response:
    """Body (optional): {"for": "embed"} lists the embedding server's models
    instead of the chat server's."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request) if request.can_read_body else {}
    if isinstance(body, web.Response):
        return body
    try:
        if body.get("for") == "embed":
            return json_ok({"models": await _ai_embed.list_models(cfg)})
        return json_ok({"models": await _ai_client.list_models(cfg)})
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)


async def post_test(request: web.Request) -> web.Response:
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    result = await _ai_client.probe(cfg)
    result["embed"] = await _ai_embed.check(cfg) if result.get("ok") else None
    result["prefix"] = await _prefix(request, cfg) if result.get("json_ok") else None
    return json_ok(result)


async def _prefix(request: web.Request, cfg: dict[str, Any]) -> dict[str, Any]:
    """What a new chat would send before its first message, opened the way
    `post_chat` opens one (no page): instructions, tools and the library
    summary, in tokens, with the window it was fitted to."""
    with db_session(request) as conn:
        lib = ai_chat.Library(
            ModuleRepository(conn).list(), BundleRepository(conn).list(),
            CategoryRepository(conn).list(), TemplateRepository(conn).list(),
        )
    prof = ai_budget.profile(cfg)
    fmt = await _ai_chat.pick_format(cfg)
    lazy = bool(prof["slim"] or prof.get("scoped"))
    meta: dict[str, Any] = {"web": _ai_search.enabled(cfg) and not lazy,
                            "typed": _ai_chat.checks_schema(cfg),
                            "delete": bool(cfg.get("allow_delete")),
                            "split": bool(prof.get("split")), "lazy": lazy}
    window = await _window(cfg, meta)
    snapshot = _open_chat(lib, cfg, meta, prof, None, fmt, window)
    slim = prof["slim"] or bool(_lean(meta).get("slim"))
    sized = {**prof, "slim": slim}
    fixed = _fixed_chars(cfg, sized, meta, fmt, snapshot)
    library = len(snapshot) + len(_LIBRARY_HEAD)
    decls = len(_json.dumps(_decls(cfg, meta, fmt))) if fmt == "native" else 0
    # The parts of the fixed prefix: instructions (with the JSON tool list in
    # JSON mode), native tool declarations, the library summary.
    parts = {"instructions": ai_budget.tokens(fixed - library - decls),
             "tools": ai_budget.tokens(decls) if decls else 0,
             "library": ai_budget.tokens(library)}
    return {"tokens": ai_budget.tokens(fixed), "window": window, "tools": len(meta["tools"]),
            "lean": int(meta.get("lean") or 0), "format": fmt, "parts": parts,
            "fits": ai_budget.fits(fixed, window), "size": prof["size"],
            "split": _splits(cfg, meta, fmt)}


def _index_status(idx: ai_index.Index | None, cfg: dict[str, Any]) -> dict[str, Any]:
    model = cfg.get("embed_model") if _ai_embed.enabled(cfg) else ""
    if idx is None:
        return {"available": False, "items": 0, "embed_model": model or None,
                "vectors": 0, "filling": False}
    return {"available": True, "items": idx.count(), "embed_model": model or None,
            "vectors": idx.vector_count(model) if model else 0,
            "filling": _ai_embed.filling(idx)}


def _index_sync(request: web.Request) -> ai_index.Index | None:
    with db_session(request) as conn:
        lib = ai_chat.Library(
            ModuleRepository(conn).list(), BundleRepository(conn).list(),
            CategoryRepository(conn).list(), TemplateRepository(conn).list(),
        )
        return _synced_index(conn, lib)


async def get_index(request: web.Request) -> web.Response:
    """The chat's library index: how many items it holds and, with meaning
    search on, how many have vectors. Brings it up to date first."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    idx = _index_sync(request)
    if idx is not None:
        _ai_embed.fill_in_background(cfg, idx)
    return json_ok(_index_status(idx, cfg))


async def post_index_rebuild(request: web.Request) -> web.Response:
    """Throw the index away and build it again (vectors too)."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    with db_session(request) as conn:
        idx = _library_index_for(conn)
    if idx is None:
        return json_error("this Python's SQLite has no full-text search (FTS5); "
                          "the chat searches without an index", status=409)
    if _ai_embed.filling(idx):
        return json_error("the library is being embedded; try again when it's done", status=409)
    idx.clear()
    idx = _index_sync(request)
    if idx is not None:
        _ai_embed.fill_in_background(cfg, idx)
    return json_ok(_index_status(idx, cfg))


async def get_progress(request: web.Request) -> web.Response:
    """What the request named by this id is doing (`_ai_progress`)."""
    view = _ai_progress.view(request.match_info["pid"])
    if view is None:
        return json_error("no such request", status=404)
    return json_ok(view)


def register(router: web.UrlDispatcher) -> None:
    def add(method: str, path: str, handler: Any, *, cut_short: bool = True) -> None:
        # Every AI route: our own request checks (wp_api/_ai_guard.py), and
        # model calls stop when the browser goes away.
        h = cancel_on_disconnect(handler) if cut_short else handler
        router.add_route(method, path, guarded(_ai_progress.track(h)))

    add("GET", "/wp/api/ai/config", get_config, cut_short=False)
    add("PUT", "/wp/api/ai/config", put_config, cut_short=False)
    add("GET", "/wp/api/ai/index", get_index, cut_short=False)
    add("POST", "/wp/api/ai/index/rebuild", post_index_rebuild, cut_short=False)
    add("POST", "/wp/api/ai/models", post_models)
    add("POST", "/wp/api/ai/test", post_test)
    add("POST", "/wp/api/ai/wildcard/draft", post_wildcard_draft)
    add("POST", "/wp/api/ai/pack/review", post_pack_review)
    add("POST", "/wp/api/ai/bundle/split", post_bundle_split)
    add("POST", "/wp/api/ai/wildcard/edit", post_wildcard_edit)
    add("POST", "/wp/api/ai/derivation/draft", post_derivation_draft)
    add("POST", "/wp/api/ai/constraint/draft", post_constraint_draft)
    add("POST", "/wp/api/ai/text/draft", post_text_draft)
    add("POST", "/wp/api/ai/describe", post_describe)
    add("POST", "/wp/api/ai/organize", post_organize)
    add("POST", "/wp/api/ai/chat", post_chat)
    add("GET", "/wp/api/ai/vision", get_vision)
    add("GET", "/wp/api/ai/progress/{pid}", get_progress, cut_short=False)
    add("GET", "/wp/api/ai/chats", get_chats, cut_short=False)
    add("GET", "/wp/api/ai/chats/{chat_id}", get_chat, cut_short=False)
    add("PATCH", "/wp/api/ai/chats/{chat_id}", patch_chat, cut_short=False)
    add("DELETE", "/wp/api/ai/chats/{chat_id}", delete_chat, cut_short=False)
    add("POST", "/wp/api/ai/chats/{chat_id}/compact", post_compact)
    add("POST", "/wp/api/ai/pack/plan", post_pack_plan)
    add("POST", "/wp/api/ai/pack/change", post_pack_change)
    add("POST", "/wp/api/ai/pack/search", post_pack_search)
    add("POST", "/wp/api/ai/pack/item", post_pack_item)
    add("POST", "/wp/api/ai/pack/check", post_pack_check)
    # Writes, so never cut short.
    add("POST", "/wp/api/ai/pack/install", post_pack_install, cut_short=False)
