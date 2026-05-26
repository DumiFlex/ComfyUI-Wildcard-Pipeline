"""Templates CRUD — reusable PromptAssembler template strings.

Mirrors wp_api/bundles.py. A template is a plain ``template_string``
($var tokens) plus library metadata (name/description/category/tags/
favorite). No children/color/payload_hash/version (templates can't
drift — see engine/db/migrations_sql/012_templates.sql).
"""
from __future__ import annotations

import sqlite3

from aiohttp import web

from engine.db.repositories import TemplateNotFound, TemplateRepository
from wp_api._helpers import db_session, json_error, json_ok
from wp_api._validators import validate_body_size, validate_meta

_UPDATABLE_FIELDS = (
    "name", "description", "category_id", "tags",
    "template_string", "is_favorite",
)


def _auto_suffix_template_name(repo: TemplateRepository, name: str) -> str:
    existing = {t["name"] for t in repo.list()}
    if name not in existing:
        return name
    candidate = f"{name} (copy)"
    i = 2
    while candidate in existing:
        candidate = f"{name} (copy {i})"
        i += 1
    return candidate


async def list_templates(request: web.Request) -> web.Response:
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
        repo = TemplateRepository(conn)
        items = repo.list(
            category_id=category_id, query=query,
            favorites_only=favorites, limit=limit, offset=offset,
        )
        total = repo.count(
            category_id=category_id, query=query, favorites_only=favorites,
        )
    return json_ok({"items": items, "total": total})


async def create_template(request: web.Request) -> web.Response:
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    if "name" not in body or not str(body.get("name", "")).strip():
        return json_error("missing field: name", status=400)
    err = validate_meta(body)
    if err is not None:
        return json_error(err, status=400)
    try:
        with db_session(request) as conn:
            repo = TemplateRepository(conn)
            unique_name = _auto_suffix_template_name(repo, body["name"])
            row = repo.create(
                name=unique_name,
                template_string=body.get("template_string", ""),
                description=body.get("description", ""),
                category_id=body.get("category_id"),
                tags=body.get("tags", []),
                is_favorite=bool(body.get("is_favorite", False)),
            )
    except ValueError as e:
        return json_error(str(e), status=400)
    except sqlite3.IntegrityError as e:
        return json_error(f"foreign-key constraint failed: {e}", status=400)
    return json_ok(row, status=201)


async def get_template(request: web.Request) -> web.Response:
    template_id = request.match_info["id"]
    with db_session(request) as conn:
        try:
            row = TemplateRepository(conn).get(template_id)
        except TemplateNotFound:
            return json_error(f"template {template_id!r} not found", status=404)
    return json_ok(row)


async def update_template(request: web.Request) -> web.Response:
    template_id = request.match_info["id"]
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    err = validate_meta(body)
    if err is not None:
        return json_error(err, status=400)
    patch = {k: body[k] for k in _UPDATABLE_FIELDS if k in body}
    with db_session(request) as conn:
        repo = TemplateRepository(conn)
        if "name" in patch and isinstance(patch["name"], str):
            others = {t["name"] for t in repo.list() if t["id"] != template_id}
            if patch["name"] in others:
                patch["name"] = _auto_suffix_template_name(repo, patch["name"])
        try:
            row = repo.update(template_id, **patch)
        except TemplateNotFound:
            return json_error(f"template {template_id!r} not found", status=404)
        except sqlite3.IntegrityError as e:
            return json_error(f"foreign-key constraint failed: {e}", status=400)
    return json_ok(row)


async def delete_template(request: web.Request) -> web.Response:
    template_id = request.match_info["id"]
    with db_session(request) as conn:
        try:
            TemplateRepository(conn).delete(template_id)
        except TemplateNotFound:
            return json_error(f"template {template_id!r} not found", status=404)
    return json_ok({"deleted": template_id})


async def toggle_favorite(request: web.Request) -> web.Response:
    template_id = request.match_info["id"]
    explicit: bool | None = None
    if request.body_exists:
        try:
            body = await request.json()
            if isinstance(body, dict) and "is_favorite" in body:
                explicit = bool(body["is_favorite"])
        except Exception:
            pass
    with db_session(request) as conn:
        repo = TemplateRepository(conn)
        try:
            cur = repo.get(template_id)
        except TemplateNotFound:
            return json_error(f"template {template_id!r} not found", status=404)
        new_state = explicit if explicit is not None else not bool(cur["is_favorite"])
        row = repo.update(template_id, is_favorite=new_state)
    return json_ok(row)


def register(router) -> None:
    router.add_get("/wp/api/templates", list_templates)
    router.add_post("/wp/api/templates", create_template)
    router.add_get("/wp/api/templates/{id}", get_template)
    router.add_put("/wp/api/templates/{id}", update_template)
    router.add_delete("/wp/api/templates/{id}", delete_template)
    router.add_post("/wp/api/templates/{id}/favorite", toggle_favorite)
