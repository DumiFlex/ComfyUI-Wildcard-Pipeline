"""/wp/api/categories CRUD endpoints."""
from __future__ import annotations

from aiohttp import web

from engine.db.repositories import CategoryNotFound, CategoryRepository
from wp_api._helpers import db_session, json_error, json_ok

_UPDATABLE_FIELDS = ("name", "color", "icon", "sort_order")


async def list_categories(request: web.Request) -> web.Response:
    with db_session(request) as conn:
        items = CategoryRepository(conn).list()
    return json_ok({"items": items})


async def create_category(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    if "name" not in body:
        return json_error("missing field: name", status=400)
    with db_session(request) as conn:
        try:
            row = CategoryRepository(conn).create(
                name=body["name"],
                color=body.get("color"),
                icon=body.get("icon"),
                sort_order=body.get("sort_order", 0),
            )
        except ValueError as e:
            return json_error(str(e), status=409)
    return json_ok(row, status=201)


async def update_category(request: web.Request) -> web.Response:
    cid = request.match_info["id"]
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    kwargs: dict = {k: body[k] for k in _UPDATABLE_FIELDS if k in body}
    with db_session(request) as conn:
        try:
            row = CategoryRepository(conn).update(cid, **kwargs)
        except CategoryNotFound:
            return json_error(f"category not found: {cid}", status=404)
    return json_ok(row)


async def delete_category(request: web.Request) -> web.Response:
    cid = request.match_info["id"]
    with db_session(request) as conn:
        try:
            CategoryRepository(conn).delete(cid)
        except CategoryNotFound:
            return json_error(f"category not found: {cid}", status=404)
    return web.Response(status=204)


def register(router) -> None:
    router.add_get("/wp/api/categories", list_categories)
    router.add_post("/wp/api/categories", create_category)
    router.add_put("/wp/api/categories/{id}", update_category)
    router.add_delete("/wp/api/categories/{id}", delete_category)
