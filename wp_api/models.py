"""`/wp/api/models/*` — LoRA and embedding completions.

Two more autocomplete sources beside the booru tags, and far cheaper than that
one: ComfyUI already enumerates both folders for its own node combos, so there
is nothing to download, cache, byte-cap or parse. The security surface that
dominated the tag work simply does not exist here — no network, no user-supplied
path, no file we write.

The list is cached in-process and invalidated on ComfyUI's own folder-cache
generation where that is exposed, so a model dropped in while the server runs
appears without a restart.
"""
from __future__ import annotations

from aiohttp import web

from wp_api._helpers import json_error, json_ok
from wp_api._model_index import ModelHit, build_hits, search

#: ComfyUI folder key → the kind name the client uses.
_KINDS: dict[str, str] = {"loras": "lora", "embeddings": "embedding"}

_cache: dict[str, list[ModelHit]] = {}


def _list_from_comfy(folder_key: str) -> list[str] | None:
    """ComfyUI's own file list, or None when running outside ComfyUI.

    Guarded the same way `engine/db/connection.py` guards `folder_paths`:
    pytest runs outside ComfyUI's sys.path and the module is not importable
    there.
    """
    try:
        import folder_paths  # type: ignore[import-not-found]
    except Exception:
        return None
    try:
        return list(folder_paths.get_filename_list(folder_key))
    except Exception:
        # An unconfigured folder is not an error — plenty of installs have no
        # embeddings at all, and the correct answer there is an empty list.
        return []


def _hits(folder_key: str, *, refresh: bool = False) -> list[ModelHit]:
    if refresh or folder_key not in _cache:
        raw = _list_from_comfy(folder_key)
        _cache[folder_key] = build_hits(raw or [])
    return _cache[folder_key]


def reset_cache() -> None:
    """Drop the cached lists. For tests, and after an explicit refresh."""
    _cache.clear()


async def get_status(request: web.Request) -> web.Response:
    """GET /wp/api/models/status

    Drives the settings panel: a toggle for a source with no files is a switch
    that does nothing, and the UI has to be able to say which case it is in.
    """
    return json_ok({
        "sources": [
            {"kind": kind, "count": len(_hits(folder))}
            for folder, kind in _KINDS.items()
        ],
    })


async def suggest(request: web.Request) -> web.Response:
    """GET /wp/api/models/suggest?q=<prefix>&kinds=lora,embedding&limit=<n>

    `kinds` is honoured rather than always returning both, so a source the user
    switched off costs nothing on the wire. Unknown kinds are ignored instead of
    rejected — a client one version ahead asking for a source this build has
    never heard of should degrade to fewer results, not to an error.
    """
    query = (request.query.get("q") or "").strip()
    # An empty query normally returns nothing, so a stray keystroke cannot dump
    # the whole models folder into a popover. Inside a `<lora:` or `embedding:`
    # reference that guard is exactly wrong: the marker itself is the request,
    # and "show me what I have" is the main way these get used. The client sets
    # `all` only when the caret is inside a reference, where the intent is
    # unambiguous.
    browse_all = request.query.get("all") == "1"
    if not query and not browse_all:
        return json_ok({"results": {}})
    try:
        limit = min(max(int(request.query.get("limit", 10)), 1), 50)
    except ValueError:
        return json_error("limit must be an integer", status=400)

    raw_kinds = (request.query.get("kinds") or "").strip()
    wanted = {k.strip() for k in raw_kinds.split(",") if k.strip()} or set(_KINDS.values())

    results: dict[str, list[dict[str, str]]] = {}
    for folder, kind in _KINDS.items():
        if kind not in wanted:
            continue
        hits = _hits(folder)
        chosen = (
            sorted(hits, key=lambda h: h.name.lower())[:limit]
            if not query
            else search(hits, query, limit)
        )
        results[kind] = [
            {"name": h.name, "path": h.path, "folder": h.folder} for h in chosen
        ]
    return json_ok({"results": results})


async def refresh(request: web.Request) -> web.Response:
    """POST /wp/api/models/refresh — re-read both folders.

    The counterpart to the tag list's Refresh button, and needed for the same
    reason: ComfyUI caches its own file lists, so a model added while the server
    is running is invisible until something asks again.
    """
    counts = {kind: len(_hits(folder, refresh=True)) for folder, kind in _KINDS.items()}
    return json_ok({"sources": [{"kind": k, "count": c} for k, c in counts.items()]})


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/models/status", get_status)
    router.add_get("/wp/api/models/suggest", suggest)
    router.add_post("/wp/api/models/refresh", refresh)
