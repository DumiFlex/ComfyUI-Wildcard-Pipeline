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

import asyncio
import functools
import json
import threading
from pathlib import Path
from typing import Any

from aiohttp import web

from engine.db.connection import wp_data_dir
from wp_api._helpers import json_error, json_ok
from wp_api._tag_download import TAG_LIST_URL, DownloadError, download_tag_list
from wp_api._tag_index import CATEGORY_NAMES, TagIndex, load_index

#: One filename, in a directory we own. Not the package folder: a reinstall
#: replaces that, and the asset pruner walks it.
#:
#: Also mirrored in `engine/db/relocate.py`, which moves a pre-existing file in
#: from the old loose-in-`user/` location. The engine cannot import this module
#: (it would drag aiohttp into a package the directory contract keeps free of
#: ComfyUI-facing imports), so the constant is duplicated there deliberately.
TAG_FILE_NAME = "wildcard-pipeline-tags.csv"

#: Beside the list: its row count and whether it has categories, keyed by the
#: list's size + mtime, so the Settings panel's status check never parses the
#: file again after the first build (parsing ~290k rows takes ~2 s).
STATUS_SUFFIX = ".status.json"

_index: TagIndex | None = None
_resolved_path: Path | None = None
#: Held while a build runs, so threads asking at once share one build.
_build_lock = threading.Lock()
#: The build the event loop is waiting on, shared by every request that
#: arrives while it runs (single flight: one parse, not one per keystroke).
_inflight: asyncio.Future | None = None


def tag_file_path() -> Path | None:
    """Where the tag list lives, or None when the user dir is undetectable."""
    data_dir = wp_data_dir()
    return (data_dir / TAG_FILE_NAME) if data_dir else None


def _fresh(path: Path) -> bool:
    return _index is not None and _resolved_path == path and not _index.is_stale()


def _get_index() -> TagIndex | None:
    """The current index, building or rebuilding it as needed.

    Rebuilds when the file's mtime moves, so replacing the list takes effect
    without restarting ComfyUI. Blocking (a build parses the whole file): on
    the event loop use `get_index`.
    """
    global _index, _resolved_path
    path = tag_file_path()
    if path is None:
        return None
    if _fresh(path):
        return _index
    with _build_lock:
        if _fresh(path):  # built by the thread we waited for
            return _index
        index = load_index(path)
        _index, _resolved_path = index, path
        _write_status(path, index)
        return index


async def get_index() -> TagIndex | None:
    """`_get_index` without blocking the event loop: a build runs in a worker
    thread, and requests that arrive during it wait for that same build."""
    global _inflight
    path = tag_file_path()
    if path is None:
        return None
    if _fresh(path):
        return _index
    loop = asyncio.get_running_loop()
    if _inflight is None or _inflight.done() or _inflight.get_loop() is not loop:
        _inflight = asyncio.ensure_future(asyncio.to_thread(_get_index))
    # Shielded: one caller going away must not cancel the others' build.
    return await asyncio.shield(_inflight)


def _status_path(path: Path) -> Path:
    return path.with_name(path.name + STATUS_SUFFIX)


def _stat_key(path: Path) -> list[int] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return [st.st_size, st.st_mtime_ns]


def _write_status(path: Path, index: TagIndex | None) -> None:
    """Remember what a build found, for `_cached_status`. Best effort."""
    key = _stat_key(path)
    if key is None:
        return
    data = {"key": key, "tag_count": len(index) if index else 0,
            "has_categories": index.has_categories if index else False}
    try:
        _status_path(path).write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass


def _cached_status(path: Path) -> dict[str, Any] | None:
    """What the last build of this exact file found, or None."""
    key = _stat_key(path)
    if key is None:
        return {"tag_count": 0, "has_categories": False}  # no file: nothing to parse
    try:
        data = json.loads(_status_path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("key") != key:
        return None
    count, cats = data.get("tag_count"), data.get("has_categories")
    if not isinstance(count, int) or not isinstance(cats, bool):
        return None
    return {"tag_count": count, "has_categories": cats}


def reset_cache() -> None:
    """Drop the cached index. For tests, and after a fresh download."""
    global _index, _resolved_path, _inflight
    _index = None
    _resolved_path = None
    _inflight = None


async def get_status(request: web.Request) -> web.Response:
    """Whether autocomplete can work, and what it would use.

    Drives the Settings panel: the toggle is meaningless without a file, so the
    UI needs to distinguish "off" from "impossible". Answers from the built
    index or the status file beside the list; only a list never built before
    is parsed (in a worker thread).
    """
    path = tag_file_path()
    if path is None:
        return json_ok({"available": False, "path": None, "tag_count": 0,
                        "has_categories": False})
    if _fresh(path):
        status = {"tag_count": len(_index) if _index else 0,
                  "has_categories": _index.has_categories if _index else False}
    else:
        status = await asyncio.to_thread(_cached_status, path)
        if status is None:
            index = await get_index()
            status = {"tag_count": len(index) if index else 0,
                      "has_categories": index.has_categories if index else False}
    return json_ok({
        "available": status["tag_count"] > 0,
        "path": str(path),
        **status,
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

    index = await get_index()
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


async def download(request: web.Request) -> web.Response:
    """POST /wp/api/tags/download — fetch the list from our GitHub release.

    Runs only on an explicit click (every outbound request is listed in
    docs/network-access.md). **The request body is ignored entirely**: there is no URL parameter
    and no destination parameter, so a caller cannot steer either. See
    `_tag_download.py` for the reasoning behind each restriction.

    Runs in a thread — it is a multi-megabyte download and must not block the
    event loop that is also serving ComfyUI itself.
    """
    destination = tag_file_path()
    if destination is None:
        return json_error(
            "ComfyUI's user directory could not be found, so there is nowhere "
            "to save the tag list.",
            status=409,
        )
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            None, functools.partial(download_tag_list, destination),
        )
    except DownloadError as err:
        return json_error(str(err), status=502)

    # Force a rebuild so the new list is live without a restart.
    reset_cache()
    index = await get_index()
    return json_ok({
        "path": str(result.path),
        "bytes": result.bytes_written,
        "tag_count": len(index) if index else 0,
        "has_categories": index.has_categories if index else False,
        "source": TAG_LIST_URL,
    })


async def remove(request: web.Request) -> web.Response:
    """DELETE /wp/api/tags — delete the installed list.

    Same shape as the download: the path is computed server-side from a fixed
    filename, so there is nothing a caller can point this at. A symlink there
    is refused rather than followed, which would otherwise let this unlink
    whatever it points to.
    """
    path = tag_file_path()
    if path is None:
        return json_error("ComfyUI's user directory could not be found.", status=409)
    if path.is_symlink():
        return json_error(
            f"{path.name} is a symlink; refusing to delete through it.", status=409,
        )
    try:
        existed = path.is_file()
        path.unlink(missing_ok=True)
    except OSError as err:
        return json_error(f"could not delete the tag list: {err}", status=500)
    status_file = _status_path(path)
    if not status_file.is_symlink():
        try:
            status_file.unlink(missing_ok=True)
        except OSError:
            pass  # keyed by the list's size + mtime, so a leftover is never read
    reset_cache()
    return json_ok({"removed": existed, "path": str(path)})


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/tags/status", get_status)
    router.add_get("/wp/api/tags/suggest", suggest)
    router.add_post("/wp/api/tags/download", download)
    router.add_delete("/wp/api/tags", remove)
