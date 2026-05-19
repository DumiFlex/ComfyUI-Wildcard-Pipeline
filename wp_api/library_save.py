"""PUT /wp/api/modules/{id}/payload — save-to-library round-trip.

Used by the ContextWidget's save-to-library actions. Body shape:

    {
      "payload": { ... },                  // required, validated
      "meta": {                            // optional
        "name": "string",
        "description": "string",
        "tags": ["string", ...]
      },
      "propagate_to_bundles": true         // optional, default true
    }

Validation runs through the module type's registered ``ModuleHandler``
via ``get_handler(type).validate_payload(payload)``. Unknown types pass
validation (the base-class no-op applies).

When ``meta`` is present the listed fields are persisted alongside the
payload — earlier versions of this endpoint silently dropped meta,
which broke the save-to-library round-trip whenever the user renamed
a module in the modal. The PUT /wp/api/modules/{id} canonical endpoint
exposes the same superset directly; this route stays as a convenience
alias so existing SPA bundles keep working.

When ``propagate_to_bundles`` is true (default), saved bundles whose
``children[]`` reference this module id get their child snapshots
rewritten with the new payload + meta in the same transaction so
follow-on bundle inserts use the updated copy.

Response shape on success:
  {
    "ok": true,
    "new_hash": "<sha256 hex of new payload>",
    "bundles_updated": ["bundle_id_1", ...]
  }
"""
from __future__ import annotations

from aiohttp import web

from engine.db.repositories import ModuleNotFound, ModuleRepository
from engine.modules.dispatcher import get_handler
from engine.modules.snapshot import payload_hash
from wp_api._helpers import db_session, json_error, json_ok
from wp_api.modules import _propagate_module_to_bundles


async def save_payload(request: web.Request) -> web.Response:
    """PUT /wp/api/modules/{id}/payload."""
    mid = request.match_info["id"]

    # --- Parse body -----------------------------------------------------------
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    if "payload" not in body:
        return json_error("missing field: payload", status=400)
    new_payload = body["payload"]
    if not isinstance(new_payload, dict):
        return json_error("payload must be a JSON object", status=400)

    # Optional meta — name/description/tags only. Anything else is
    # ignored so the surface doesn't drift from `_UPDATABLE_FIELDS`
    # on the canonical PUT route.
    meta = body.get("meta") or {}
    if not isinstance(meta, dict):
        return json_error("meta must be a JSON object when provided", status=400)
    update_kwargs: dict = {"payload": new_payload}
    if "name" in meta:
        if not isinstance(meta["name"], str):
            return json_error("meta.name must be a string", status=400)
        update_kwargs["name"] = meta["name"]
    if "description" in meta:
        if not isinstance(meta["description"], str):
            return json_error("meta.description must be a string", status=400)
        update_kwargs["description"] = meta["description"]
    if "tags" in meta:
        tags = meta["tags"]
        if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
            return json_error("meta.tags must be a list of strings", status=400)
        update_kwargs["tags"] = tags

    propagate = bool(body.get("propagate_to_bundles", True))

    # --- Load existing + validate + persist ----------------------------------
    bundles_updated: list[str] = []
    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        try:
            row = repo.get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)

        handler = get_handler(row["type"])
        if handler is not None:
            try:
                handler.validate_payload(new_payload)
            except ValueError as exc:
                return json_error(str(exc), status=400)

        updated = repo.update(mid, **update_kwargs)
        if propagate:
            bundles_updated = _propagate_module_to_bundles(conn, updated)

    new_hash = payload_hash(new_payload)
    return json_ok({
        "ok": True,
        "new_hash": new_hash,
        "bundles_updated": bundles_updated,
    })


def register(router) -> None:
    router.add_put("/wp/api/modules/{id}/payload", save_payload)
