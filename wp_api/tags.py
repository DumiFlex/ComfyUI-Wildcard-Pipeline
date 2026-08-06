"""/wp/api/tags/* — optional booru tag autocomplete.

The whole feature is opt-in and degrades to "absent". No tag file means the
status endpoint says so and the SPA never offers suggestions; nothing here can
break an editor that is not using it.

The index is built on the FIRST SUGGEST REQUEST, never at plugin import.
Loading a quarter of a million rows during ComfyUI startup would add latency to
every launch for a feature most users will not enable — and slow startup is the
exact problem this release cycle went and fixed.
"""
from __future__ import annotations

from pathlib import Path

from aiohttp import web

from engine.db.connection import comfyui_user_dir
from wp_api._helpers import json_error, json_ok
from wp_api._tag_index import CATEGORY_NAMES, TagIndex, load_index

#: One filename, in a directory we own. Not the package folder: a reinstall
#: replaces that, and the asset pruner walks it.
TAG_FILE_NAME = "wildcard-pipeline-tags.csv"

_index: TagIndex | None = None
_resolved_path: Path | None = None


def tag_file_path() -> Path | None:
    """Where the tag list lives, or None when the user dir is undetectable."""
    user_dir = comfyui_user_dir()
    return (user_dir / TAG_FILE_NAME) if user_dir else None


def _get_index() -> TagIndex | None:
    """The current index, building or rebuilding it as needed.

    Rebuilds when the file's mtime moves, so replacing the list takes effect
    without restarting ComfyUI.
    """
    global _index, _resolved_path
    path = tag_file_path()
    if path is None:
        return None
    if _index is not None and _resolved_path == path and not _index.is_stale():
        return _index
    _index = load_index(path)
    _resolved_path = path
    return _index


def reset_cache() -> None:
    """Drop the cached index. For tests, and after a fresh download."""
    global _index, _resolved_path
    _index = None
    _resolved_path = None


async def get_status(request: web.Request) -> web.Response:
    """Whether autocomplete can work, and what it would use.

    Drives the Settings panel: the toggle is meaningless without a file, so the
    UI needs to distinguish "off" from "impossible".
    """
    path = tag_file_path()
    index = _get_index()
    return json_ok({
        "available": index is not None,
        "path": str(path) if path else None,
        "tag_count": len(index) if index else 0,
        "has_categories": index.has_categories if index else False,
    })


async def suggest(request: web.Request) -> web.Response:
    """GET /wp/api/tags/suggest?q=<prefix>&limit=<n>

    Returns at most `limit` rows. The client never receives the file — a usable
    list is several megabytes and sending it per editor would repeat a mistake
    this project already made once with the drift poll.
    """
    query = (request.query.get("q") or "").strip()
    if not query:
        return json_ok({"tags": []})
    try:
        limit = min(max(int(request.query.get("limit", 20)), 1), 100)
    except ValueError:
        return json_error("limit must be an integer", status=400)

    index = _get_index()
    if index is None:
        # Not an error: the feature is optional and the client asks the status
        # endpoint when it wants to explain why nothing appears.
        return json_ok({"tags": [], "available": False})

    return json_ok({
        "available": True,
        "tags": [
            {
                "name": t.aliased_to or t.name,
                "matched": t.name,
                "count": t.count,
                "category": t.category,
                "category_name": CATEGORY_NAMES.get(t.category) if t.category is not None else None,
            }
            for t in index.search(query, limit)
        ],
    })


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/tags/status", get_status)
    router.add_get("/wp/api/tags/suggest", suggest)
