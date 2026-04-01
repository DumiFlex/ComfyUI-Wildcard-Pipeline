"""CRUD route handlers for wildcard, constraint, and pipeline resources.

All handlers follow the same pattern:
  - Read JSON body with ``request.json()``
  - Delegate to :class:`FileStore` for persistence
  - Return ``web.json_response`` with appropriate status codes
"""

from __future__ import annotations

import json
from typing import Any, Callable

from aiohttp import web

from ..models.schemas import validate_constraint, validate_pipeline, validate_wildcard
from ..services.file_store import FileStore


def _make_crud_routes(
    prefix: str,
    store: FileStore,
    validator: Callable[[dict[str, Any]], list[str]],
) -> web.RouteTableDef:
    """Build a standard set of CRUD routes for a resource type.

    Routes created:

    - ``GET  {prefix}``        → list all
    - ``GET  {prefix}/{name}`` → get one
    - ``POST {prefix}``        → create
    - ``PUT  {prefix}/{name}`` → update
    - ``DELETE {prefix}/{name}`` → delete
    """
    routes = web.RouteTableDef()

    @routes.get(prefix)
    async def list_all(request: web.Request) -> web.Response:
        items = store.list_all()
        return web.json_response(items)

    @routes.get(f"{prefix}/{{name}}")
    async def get_one(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        item = store.get(name)
        if item is None:
            raise web.HTTPNotFound(
                text=json.dumps({"error": f"'{name}' not found"}),
                content_type="application/json",
            )
        return web.json_response(item)

    @routes.post(prefix)
    async def create(request: web.Request) -> web.Response:
        data = await _parse_json_body(request)
        errors = validator(data)
        if errors:
            raise web.HTTPBadRequest(
                text=json.dumps({"errors": errors}),
                content_type="application/json",
            )
        try:
            store.create(data)
        except FileExistsError as exc:
            raise web.HTTPConflict(
                text=json.dumps({"error": str(exc)}),
                content_type="application/json",
            )
        return web.json_response(data, status=201)

    @routes.put(f"{prefix}/{{name}}")
    async def update(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        data = await _parse_json_body(request)
        errors = validator(data)
        if errors:
            raise web.HTTPBadRequest(
                text=json.dumps({"errors": errors}),
                content_type="application/json",
            )
        try:
            store.update(name, data)
        except FileNotFoundError as exc:
            raise web.HTTPNotFound(
                text=json.dumps({"error": str(exc)}),
                content_type="application/json",
            )
        except FileExistsError as exc:
            raise web.HTTPConflict(
                text=json.dumps({"error": str(exc)}),
                content_type="application/json",
            )
        return web.json_response(data)

    @routes.delete(f"{prefix}/{{name}}")
    async def delete(request: web.Request) -> web.Response:
        name = request.match_info["name"]
        try:
            store.delete(name)
        except FileNotFoundError as exc:
            raise web.HTTPNotFound(
                text=json.dumps({"error": str(exc)}),
                content_type="application/json",
            )
        return web.json_response({"deleted": name})

    return routes


async def _parse_json_body(request: web.Request) -> dict[str, Any]:
    """Parse JSON body from request, raising 400 on failure."""
    try:
        data = await request.json()
    except (json.JSONDecodeError, ValueError):
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "Invalid JSON body"}),
            content_type="application/json",
        )
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "Request body must be a JSON object"}),
            content_type="application/json",
        )
    return data


def create_wildcard_routes(store: FileStore) -> web.RouteTableDef:
    """Create CRUD routes for wildcards at ``/wp/api/wildcards``."""
    return _make_crud_routes("/wp/api/wildcards", store, validate_wildcard)


def create_constraint_routes(store: FileStore) -> web.RouteTableDef:
    """Create CRUD routes for constraints at ``/wp/api/constraints``."""
    return _make_crud_routes("/wp/api/constraints", store, validate_constraint)


def create_pipeline_routes(store: FileStore) -> web.RouteTableDef:
    """Create CRUD routes for pipelines at ``/wp/api/pipelines``."""
    return _make_crud_routes("/wp/api/pipelines", store, validate_pipeline)
