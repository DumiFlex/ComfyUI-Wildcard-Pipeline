"""PUT /wp/api/modules/{id}/payload — save-to-library payload round-trip.

Used by the ContextWidget's "Save to library" action to push an updated
payload back into the library for an existing module. The caller supplies
only the new `payload` (and optional `meta`); all other module fields
(name, description, tags, category, etc.) are left unchanged.

Validation is delegated to the module type's registered ``ModuleHandler``
via ``get_handler(type).validate_payload(payload)``. Unknown types pass
validation (the base-class no-op applies).

Response shape on success:
  {"ok": true, "new_hash": "<sha256 hex of new payload>"}
"""
from __future__ import annotations

from aiohttp import web

from engine.db.repositories import ModuleNotFound, ModuleRepository
from engine.modules.dispatcher import get_handler
from engine.modules.snapshot import payload_hash
from wp_api._helpers import db_session, json_error, json_ok


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

    # --- Load existing module -------------------------------------------------
    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        try:
            row = repo.get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)

        # --- Validate payload via handler -------------------------------------
        handler = get_handler(row["type"])
        if handler is not None:
            try:
                handler.validate_payload(new_payload)
            except ValueError as exc:
                return json_error(str(exc), status=400)

        # --- Persist ----------------------------------------------------------
        repo.update(mid, payload=new_payload)

    new_hash = payload_hash(new_payload)
    return json_ok({"ok": True, "new_hash": new_hash})


def register(router) -> None:
    router.add_put("/wp/api/modules/{id}/payload", save_payload)
