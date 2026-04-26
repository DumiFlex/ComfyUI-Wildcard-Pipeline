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

    with db_session(request) as conn:
        items = ModuleRepository(conn).list(
            type=type_, category_id=category_id, query=query,
            favorites_only=favorites, limit=limit, offset=offset,
        )
    return json_ok({"items": items, "total": len(items)})


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

    with db_session(request) as conn:
        row = ModuleRepository(conn).create(
            type=body["type"], name=body["name"],
            description=body.get("description", ""),
            category_id=body.get("category_id"),
            tags=body.get("tags", []),
            payload=body["payload"],
            is_favorite=bool(body.get("is_favorite", False)),
        )
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


def register(router) -> None:
    router.add_get("/wp/api/modules", list_modules)
    router.add_post("/wp/api/modules", create_module)
    router.add_post("/wp/api/modules/match", match_module)
    router.add_get("/wp/api/modules/{id}", get_module)
    router.add_put("/wp/api/modules/{id}", update_module)
    router.add_delete("/wp/api/modules/{id}", delete_module)
    router.add_post("/wp/api/modules/{id}/snapshot", snapshot_module)
    router.add_post("/wp/api/modules/{id}/duplicate", duplicate_module)
    router.add_post("/wp/api/modules/{id}/favorite", toggle_favorite)
