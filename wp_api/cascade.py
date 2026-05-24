"""HTTP routes for cascade-edit mutations.

POST /wp/api/cascade/apply  → engine.cascade.orchestrator.apply_cascade
POST /wp/api/cascade/undo   → engine.cascade.undo.undo_cascade
"""
from __future__ import annotations

from aiohttp import web

from engine.cascade.orchestrator import apply_cascade as _apply
from engine.cascade.undo import undo_cascade as _undo
from wp_api._helpers import db_session, json_error, json_ok


async def cascade_apply(request: web.Request) -> web.Response:
    """POST /wp/api/cascade/apply — apply cascade-edit mutations.

    Body shape::

        {
            "kind": str,  # "wildcard", "category", etc.
            "id": str,    # target entity UUID
            "action": str,  # "delete", "rename", etc.
            "dry_run": bool,  # optional, default False
            "cascade_refs": bool,  # optional, default True
            "new_name": str,  # optional, for rename actions
            "extra": dict,  # optional, for subcategory/combine_var ops
        }

    On success: ``{"ok": True, "undo_entry_id": str, "affected_count": int, "diff": list}``
    (dry_run mode returns ``affected_count`` and ``affected_entities`` instead of ``diff``).
    On error: ``{"error": str}`` with status 400.
    """
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)

    with db_session(request) as conn:
        result = _apply(conn, body)

    if not result.get("ok"):
        return json_error(result.get("error", "apply failed"), status=400)
    return json_ok(result)


async def cascade_undo(request: web.Request) -> web.Response:
    """POST /wp/api/cascade/undo — reverse a previous cascade-edit apply.

    Body shape::

        {"undo_entry_id": str}

    On success: ``{"ok": True}`` (200).
    Missing or non-string ``undo_entry_id`` → 400.
    Unknown ``undo_entry_id`` → **404** (engine returns "not found" in error).
    Other failures → 400.
    """
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)

    undo_id = body.get("undo_entry_id")
    if not isinstance(undo_id, str) or not undo_id:
        return json_error("undo_entry_id required", status=400)

    with db_session(request) as conn:
        result = _undo(conn, undo_id)

    if not result.get("ok"):
        error = result.get("error", "undo failed")
        # Engine returns "undo entry not found" for missing entries;
        # map to 404 for clean distinction from other errors.
        status = 404 if "not found" in error.lower() else 400
        return json_error(error, status=status)
    return json_ok(result)


def register(router) -> None:
    """Register cascade routes on the given aiohttp router."""
    router.add_post("/wp/api/cascade/apply", cascade_apply)
    router.add_post("/wp/api/cascade/undo", cascade_undo)
