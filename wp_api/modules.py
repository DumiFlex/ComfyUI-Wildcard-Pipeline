"""/wp/api/modules CRUD + list endpoints."""
from __future__ import annotations

from aiohttp import web

from engine.db.repositories import ModuleNotFound, ModuleRepository
from wp_api._helpers import db_conn, json_error, json_ok


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

    conn = db_conn(request)
    try:
        repo = ModuleRepository(conn)
        items = repo.list(
            type=type_, category_id=category_id, query=query,
            favorites_only=favorites, limit=limit, offset=offset,
        )
    finally:
        conn.close()
    return json_ok({"items": items, "total": len(items)})


async def create_module(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    required = {"type", "name", "payload"}
    missing = required - body.keys()
    if missing:
        return json_error(
            f"missing fields: {sorted(missing)}", status=400,
        )

    conn = db_conn(request)
    try:
        repo = ModuleRepository(conn)
        row = repo.create(
            type=body["type"], name=body["name"],
            description=body.get("description", ""),
            category_id=body.get("category_id"),
            tags=body.get("tags", []),
            payload=body["payload"],
            is_favorite=bool(body.get("is_favorite", False)),
        )
    finally:
        conn.close()
    return json_ok(row, status=201)


async def get_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    conn = db_conn(request)
    try:
        try:
            row = ModuleRepository(conn).get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
    finally:
        conn.close()
    return json_ok(row)


async def update_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    kwargs: dict = {}
    for key in ("name", "description", "tags", "payload", "is_favorite", "category_id"):
        if key in body:
            kwargs[key] = body[key]
    conn = db_conn(request)
    try:
        repo = ModuleRepository(conn)
        try:
            row = repo.update(mid, **kwargs)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
    finally:
        conn.close()
    return json_ok(row)


async def delete_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    conn = db_conn(request)
    try:
        try:
            ModuleRepository(conn).delete(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
    finally:
        conn.close()
    return web.Response(status=204)


def register(router) -> None:
    router.add_get("/wp/api/modules", list_modules)
    router.add_post("/wp/api/modules", create_module)
    router.add_get("/wp/api/modules/{id}", get_module)
    router.add_put("/wp/api/modules/{id}", update_module)
    router.add_delete("/wp/api/modules/{id}", delete_module)
