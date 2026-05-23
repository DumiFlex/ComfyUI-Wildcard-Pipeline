"""/wp/api/import/* + /wp/api/export/* — library bundle commit pipeline."""
from __future__ import annotations

from aiohttp import web

from engine.exporter import build_export_payload
from engine.importer import commit_import, get_undo_entry, undo_import
from wp_api._helpers import db_session, json_error, json_ok
from wp_api._validators import validate_body_size

# 7-bucket export request keys (Task 10). Each key, when present, must be
# a list of UUIDs; missing keys default to []. Mis-typed UUIDs (e.g. a
# wildcard id under combine_uuids) are silently dropped by the exporter.
_EXPORT_BUILD_KEYS = (
    "bundle_uuids",
    "wildcard_uuids",
    "fixed_values_uuids",
    "combine_uuids",
    "derivation_uuids",
    "constraint_uuids",
    "category_uuids",
)


async def export_build(request: web.Request) -> web.Response:
    """POST /wp/api/export/build — assemble a 7-bucket export payload.

    Body shape:
        {
            "bundle_uuids":      [...],
            "wildcard_uuids":    [...],
            "fixed_values_uuids":[...],
            "combine_uuids":     [...],
            "derivation_uuids":  [...],
            "constraint_uuids":  [...],
            "category_uuids":    [...],
        }

    Every key is optional and defaults to ``[]``. UUID format is NOT
    validated here: the exporter silently drops missing or cross-bucket
    UUIDs, which is the intended behavior for the picker UI's loose
    type tracking. Response is the exporter payload returned directly
    (no ``{"ok": true, ...}`` wrapper).
    """
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    for key in _EXPORT_BUILD_KEYS:
        if key in body and not isinstance(body[key], list):
            return json_error("uuid lists must be arrays", status=400)

    with db_session(request) as conn:
        payload = build_export_payload(
            conn,
            bundle_uuids=body.get("bundle_uuids", []),
            wildcard_uuids=body.get("wildcard_uuids", []),
            fixed_values_uuids=body.get("fixed_values_uuids", []),
            combine_uuids=body.get("combine_uuids", []),
            derivation_uuids=body.get("derivation_uuids", []),
            constraint_uuids=body.get("constraint_uuids", []),
            category_uuids=body.get("category_uuids", []),
        )
    return json_ok(payload)


async def import_commit(request: web.Request) -> web.Response:
    """POST /wp/api/import/commit — apply a classified commit payload.

    Body shape (produced by the SPA's client-side classifier, Task 15)::

        {
            "adds":     [{"kind": str, "entity":      {...}}, ...],
            "replaces": [{"kind": str, "id": str, "new_content": {...}}, ...],
            "renames":  [{"kind": str, "old_id": str, "new_id": str,
                          "content": {...}}, ...]
        }

    Every bucket is optional and defaults to ``[]``. ``kind`` must be one
    of the 7 buckets (``wildcard``, ``fixed_values``, ``combine``,
    ``derivation``, ``constraint``, ``bundle``, ``category``) — the engine
    rejects anything else as a contract violation.

    Response on success: ``{"ok": True, "undo_entry_id": str, "summary":
    {...}}`` (200). Contract violations and DB-layer errors return
    ``{"error": str}`` with status 400; the engine already wraps raw
    sqlite errors as ``"database integrity violation"`` so no internals
    leak. The 5 MB body cap is the same as every other write endpoint.
    """
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    # Each bucket must be a list when present. Mirrors the export_build
    # check at line 209 — the engine would crash with TypeError otherwise.
    for key in ("adds", "replaces", "renames"):
        if key in body and not isinstance(body[key], list):
            return json_error(f"{key} must be a list", status=400)

    with db_session(request) as conn:
        result = commit_import(conn, body)
    if not result.get("ok"):
        # commit_import returns {"ok": False, "error": str} for both
        # contract violations and wrapped DB errors. 400 covers both.
        return json_error(result.get("error", "import commit failed"), status=400)
    # Engine returns ``undo_id``; the locked HTTP contract uses
    # ``undo_entry_id``. Rename at the boundary so the engine field name
    # stays decoupled from the client-facing API.
    return json_ok({
        "ok": True,
        "undo_entry_id": result["undo_id"],
        "summary": result.get("summary", {}),
    })


async def import_undo(request: web.Request) -> web.Response:
    """POST /wp/api/import/undo — reverse a previous import/commit call.

    Body shape::

        {"undo_entry_id": str}

    Response on success: ``{"ok": True}`` (200). Missing or non-string
    ``undo_entry_id`` → 400. Unknown ``undo_entry_id`` → **404** (clean
    miss; the engine returns ``"undo entry ... not found"``). Other
    failures (corrupt undo blob, DB error) → 400.
    """
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    if "undo_entry_id" not in body:
        return json_error("undo_entry_id required", status=400)
    undo_entry_id = body["undo_entry_id"]
    if not isinstance(undo_entry_id, str):
        return json_error("undo_entry_id must be a string", status=400)

    with db_session(request) as conn:
        # Structural 404: existence check before attempting the undo.
        # Mirrors the typed-exception pattern used by ModuleNotFound /
        # BundleNotFound / CategoryNotFound elsewhere in wp_api — the
        # HTTP status is decided by row presence, not by parsing engine
        # error wording. Same connection drives both reads so we keep a
        # single transaction context.
        entry = get_undo_entry(conn, undo_entry_id)
        if entry is None:
            return json_error(
                f"undo entry {undo_entry_id!r} not found", status=404,
            )
        result = undo_import(conn, undo_entry_id)
    if not result.get("ok"):
        # Remaining failures (corrupt undo blob, IntegrityError during
        # restore) are all proper 400s — the 404 path is handled above.
        return json_error(result.get("error", "undo failed"), status=400)
    return json_ok({"ok": True})


def register(router) -> None:
    router.add_post("/wp/api/export/build", export_build)
    router.add_post("/wp/api/import/commit", import_commit)
    router.add_post("/wp/api/import/undo", import_undo)
