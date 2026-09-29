"""/wp/api/library-tags — library-wide rename / merge / delete of row tags.

Row tags are the free-form labels on modules, bundles and templates (the
`tags` column, edited on the Identity card). They are the library's
many-to-many grouping, so renaming one has to touch every row that carries
it. Not to be confused with `/wp/api/tags`, which serves the prompt-tag
autocomplete list.

Counts are not served here: the SPA already holds all three catalogs and
counts client-side, which keeps the sidebar reactive without a poll.

Writes go through each repository's `update(tags=...)` so the fingerprint and
`version` move exactly as they do for a tag edit in the editor.
"""
from __future__ import annotations

from typing import Any

from aiohttp import web

from engine.db.repositories import (
    BundleRepository,
    ModuleRepository,
    TemplateRepository,
)
from wp_api._helpers import db_session, json_error, json_ok
from wp_api._validators import MAX_TAG_LEN


def replace_tag(tags: list[str], old: str, new: str | None) -> list[str]:
    """`tags` with `old` swapped for `new` (or dropped when `new` is None).

    Order is kept; `new` lands where `old` was. When the row already carries
    `new` (a merge), the duplicate is dropped so the row keeps one copy.
    """
    out: list[str] = []
    for t in tags:
        t2 = new if t == old else t
        if t2 is None or t2 in out:
            continue
        out.append(t2)
    return out


def _apply(conn: Any, old: str, new: str | None) -> dict[str, int]:
    counts = {"modules": 0, "bundles": 0, "templates": 0}
    repos = (
        ("modules", ModuleRepository(conn)),
        ("bundles", BundleRepository(conn)),
        ("templates", TemplateRepository(conn)),
    )
    for key, repo in repos:
        for row in repo.list():
            tags = row.get("tags") or []
            if old not in tags:
                continue
            repo.update(row["id"], tags=replace_tag(tags, old, new))
            counts[key] += 1
    return counts


async def _read_body(request: web.Request) -> dict[str, Any] | web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    return body


async def rename_tag(request: web.Request) -> web.Response:
    body = await _read_body(request)
    if isinstance(body, web.Response):
        return body
    old, new = body.get("from"), body.get("to")
    if not isinstance(old, str) or not old:
        return json_error("missing field: from", status=400)
    if not isinstance(new, str) or not new.strip():
        return json_error("missing field: to", status=400)
    new = new.strip()
    if len(new) > MAX_TAG_LEN:
        return json_error(f"to must be at most {MAX_TAG_LEN} chars", status=400)
    if new == old:
        return json_ok({"updated": {"modules": 0, "bundles": 0, "templates": 0}})
    with db_session(request) as conn:
        counts = _apply(conn, old, new)
    return json_ok({"updated": counts})


async def delete_tag(request: web.Request) -> web.Response:
    body = await _read_body(request)
    if isinstance(body, web.Response):
        return body
    tag = body.get("tag")
    if not isinstance(tag, str) or not tag:
        return json_error("missing field: tag", status=400)
    with db_session(request) as conn:
        counts = _apply(conn, tag, None)
    return json_ok({"updated": counts})


def register(router) -> None:
    router.add_post("/wp/api/library-tags/rename", rename_tag)
    router.add_post("/wp/api/library-tags/delete", delete_tag)
