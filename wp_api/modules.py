"""/wp/api/modules CRUD + snapshot + match + duplicate + favorite endpoints."""
from __future__ import annotations

from aiohttp import web

from engine.db.repositories import ModuleNotFound, ModuleRepository
from engine.modules.snapshot import freeze_snapshot, payload_hash
from wp_api._helpers import db_session, json_error, json_ok

_UPDATABLE_FIELDS = (
    "name", "description", "tags", "payload", "is_favorite", "category_id",
)


async def list_modules(request: web.Request) -> web.Response:
    type_ = request.query.get("type")
    category_id = request.query.get("category")
    query = request.query.get("q")
    favorites = request.query.get("favorites") == "1"
    try:
        limit = int(request.query["limit"]) if "limit" in request.query else None
        offset = int(request.query.get("offset", 0))
    except ValueError:
        return json_error("limit/offset must be integers", status=400)
    if limit is not None and limit < 0:
        return json_error("limit must be non-negative", status=400)
    if offset < 0:
        return json_error("offset must be non-negative", status=400)

    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        items = repo.list(
            type=type_, category_id=category_id, query=query,
            favorites_only=favorites, limit=limit, offset=offset,
        )
        # `total` is the unpaginated count so the SPA Dashboard can show
        # "Wildcards: 15" even when limit=1 was passed for cheap polling.
        total = repo.count(
            type=type_, category_id=category_id, query=query,
            favorites_only=favorites,
        )
    return json_ok({"items": items, "total": total})


async def create_module(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    required = {"type", "name", "payload"}
    missing = required - body.keys()
    if missing:
        return json_error(f"missing fields: {sorted(missing)}", status=400)

    try:
        with db_session(request) as conn:
            row = ModuleRepository(conn).create(
                type=body["type"], name=body["name"],
                description=body.get("description", ""),
                category_id=body.get("category_id"),
                tags=body.get("tags", []),
                payload=body["payload"],
                is_favorite=bool(body.get("is_favorite", False)),
            )
    except ValueError as e:
        return json_error(str(e), status=400)
    return json_ok(row, status=201)


async def import_from_workflow(request: web.Request) -> web.Response:
    """Insert a workflow-resident module snapshot into the library at
    its existing 8-hex uuid. Used by the ContextWidget's
    "Save to library" action when a loaded workflow contains a module
    not present in this user's library.

    Differs from `create_module` in that the caller supplies the id;
    we preserve it so existing `@{uuid}` refs in other workflows /
    modules don't break. Returns 409 if the id is already taken
    (the indicator dot would already be cleared, so this should
    only fire on race).
    """
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    required = {"id", "type", "name", "payload"}
    missing = required - body.keys()
    if missing:
        return json_error(f"missing fields: {sorted(missing)}", status=400)

    try:
        with db_session(request) as conn:
            repo = ModuleRepository(conn)
            try:
                repo.get(body["id"])
                return json_error(f"module {body['id']} already exists", status=409)
            except ModuleNotFound:
                pass  # expected — that's the whole point of the endpoint
            row = repo.create(
                id=body["id"],
                type=body["type"], name=body["name"],
                description=body.get("description", ""),
                category_id=body.get("category_id"),
                tags=body.get("tags", []),
                payload=body["payload"],
                is_favorite=bool(body.get("is_favorite", False)),
            )
    except ValueError as e:
        return json_error(str(e), status=400)
    return json_ok(row, status=201)


async def get_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        try:
            row = ModuleRepository(conn).get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
    return json_ok(row)


async def update_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    kwargs: dict = {k: body[k] for k in _UPDATABLE_FIELDS if k in body}
    with db_session(request) as conn:
        try:
            row = ModuleRepository(conn).update(mid, **kwargs)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
    return json_ok(row)


async def delete_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        try:
            ModuleRepository(conn).delete(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
    return web.Response(status=204)


async def snapshot_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        try:
            row = ModuleRepository(conn).get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
    return json_ok(freeze_snapshot(row))


async def match_module(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    required = {"type", "name", "payload_hash"}
    missing = required - body.keys()
    if missing:
        return json_error(f"missing fields: {sorted(missing)}", status=400)

    with db_session(request) as conn:
        rows = ModuleRepository(conn).list(type=body["type"], query=body["name"])
        for row in rows:
            if row["name"] != body["name"]:
                continue
            if payload_hash(row["payload"]) == body["payload_hash"]:
                return json_ok({
                    "matched": True, "id": row["id"], "version": row["version"],
                })
    return json_ok({"matched": False})


async def duplicate_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        try:
            src = repo.get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
        copy = repo.create(
            type=src["type"], name=f"{src['name']} (copy)",
            description=src["description"], category_id=src["category_id"],
            tags=list(src["tags"]), payload=src["payload"],
            is_favorite=False,
        )
    return json_ok(copy, status=201)


async def toggle_favorite(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        try:
            row = repo.get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
        updated = repo.update(mid, is_favorite=not row["is_favorite"])
    return json_ok(updated)


async def list_hashes(request: web.Request) -> web.Response:
    """Lightweight bulk hash fetch for drift detection. Spec §4.2.

    Returns wildcards-only because catalog never contains other kinds
    (spec §2.7). Lightweight (no payload, no metadata) so the SPA can
    poll on every workflow load without measurable cost."""
    with db_session(request) as conn:
        rows = ModuleRepository(conn).list(type="wildcard")
    # Post-migration-004 the row's `id` IS the 8-hex uuid that the
    # tokenizer's `@{8hex}` ref captures; the published `hashes` map
    # keys remain `uuid`-named on the wire so existing SPA consumers
    # don't need to relabel.
    return json_ok({
        "hashes": {row["id"]: row["payload_hash"] for row in rows},
    })


async def embed_bundle(request: web.Request) -> web.Response:
    """Per-pick snapshot fetch for the SPA library picker.

    Body: {"uuids": [str, ...]}. Server returns one SnapshotEntry per
    picked uuid — NO transitive `@{}` walk. Nested wildcard refs
    inside an option value resolve at run time against the live
    library on the executing machine. The workflow JSON only
    embeds what the user explicitly picked; the referenced wildcards
    only enter the catalog if (and when) the picked option happens
    to surface them at run time.

    Trade-off: workflow JSON is no longer self-contained. Reproducing
    a graph on a different machine requires the same wildcard
    library (or at least the wildcards the picked options happen to
    resolve into). The user explicitly asked for this trim — it
    matches their mental model of "I picked outfit, I expect outfit
    to be embedded; color is a library detail".

    Response shape kept stable so the SPA client doesn't need to
    branch:
      - modules: list of picked payloads in input order (drops misses)
      - snapshots: dict[uuid, SnapshotEntry] of the picks (no deps)
      - pickOrder: input uuid list
      - walkOverflow: always [] (kept for shape compatibility)
    """
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)

    uuids = body.get("uuids")
    if not isinstance(uuids, list) or not all(isinstance(u, str) for u in uuids):
        return json_error("uuids must be a list of strings", status=400)

    snapshots: dict[str, dict] = {}
    picks: list[dict] = []
    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        for uuid in uuids:
            try:
                row = repo.get(uuid)
            except Exception:
                continue
            entry = {
                "snapshot_version": 1,
                "uuid": row["id"],
                "type": row["type"],
                "name": row["name"],
                "payload": row["payload"],
                "payload_hash": row["payload_hash"],
                "source": {"kind": "user"},
            }
            snapshots[row["id"]] = entry
            picks.append(row["payload"])

    return json_ok({
        "modules": picks,
        "snapshots": snapshots,
        "pickOrder": uuids,
        "walkOverflow": [],
    })


def register(router) -> None:
    router.add_get("/wp/api/modules", list_modules)
    router.add_post("/wp/api/modules", create_module)
    router.add_post("/wp/api/modules/import-from-workflow", import_from_workflow)
    router.add_get("/wp/api/modules/hashes", list_hashes)
    router.add_post("/wp/api/modules/match", match_module)
    router.add_post("/wp/api/modules/embed-bundle", embed_bundle)
    router.add_get("/wp/api/modules/{id}", get_module)
    router.add_put("/wp/api/modules/{id}", update_module)
    router.add_delete("/wp/api/modules/{id}", delete_module)
    router.add_post("/wp/api/modules/{id}/snapshot", snapshot_module)
    router.add_post("/wp/api/modules/{id}/duplicate", duplicate_module)
    router.add_post("/wp/api/modules/{id}/favorite", toggle_favorite)
