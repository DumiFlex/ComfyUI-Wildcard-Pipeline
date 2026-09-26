"""Test Runner scenarios CRUD — saved stacks the runner re-runs on demand.

A scenario stores what to run (`stack`, `pins`, `seeds`, `output_var`) plus
two opaque JSON blobs the Test Runner writes: `baseline` (a run to compare
against) and `last_run` (the latest summary). Running happens in
wp_api/test_runner.py (`/wp/api/test/run`); nothing here touches the engine.
See engine/db/migrations_sql/018_test_scenarios.sql.
"""
from __future__ import annotations

from typing import Any

from aiohttp import web

from engine.db.repositories import ScenarioNotFound, ScenarioRepository
from engine.scenario import ScenarioError, resolve_seeds
from wp_api._helpers import db_session, json_error, json_ok
from wp_api._validators import validate_body_size

_UPDATABLE_FIELDS = ScenarioRepository._UPDATABLE
_MAX_STACK = 200


def _validate(body: dict[str, Any], *, partial: bool) -> str | None:
    """Return an error message, or None when every present field is valid."""
    if not partial or "name" in body:
        name = body.get("name")
        if not isinstance(name, str) or not name.strip():
            return "name must be a non-empty string"
    if "description" in body and not isinstance(body["description"], str):
        return "description must be a string"
    if "is_pinned" in body and not isinstance(body["is_pinned"], bool):
        return "is_pinned must be a boolean"
    if "stack" in body:
        stack = body["stack"]
        if not isinstance(stack, list) or len(stack) > _MAX_STACK:
            return f"stack must be a list of at most {_MAX_STACK} items"
        for i, item in enumerate(stack):
            if not isinstance(item, dict):
                return f"stack[{i}] must be an object"
            if not isinstance(item.get("module"), str) and not isinstance(item.get("bundle"), str):
                return f"stack[{i}] needs a 'module' or 'bundle' id"
            if "enabled" in item and not isinstance(item["enabled"], bool):
                return f"stack[{i}].enabled must be a boolean"
            if "instance" in item and not isinstance(item["instance"], dict):
                return f"stack[{i}].instance must be an object"
    if "pins" in body:
        pins = body["pins"]
        if not isinstance(pins, dict) or not all(
            isinstance(k, str) and k and isinstance(v, str) for k, v in pins.items()
        ):
            return "pins must be an object of $var name to string value"
    if "seeds" in body:
        try:
            resolve_seeds(body["seeds"])
        except ScenarioError as exc:
            return str(exc)
    if "output_var" in body and body["output_var"] is not None and not isinstance(
        body["output_var"], str,
    ):
        return "output_var must be a string or null"
    for key in ("baseline", "last_run"):
        if key in body and body[key] is not None and not isinstance(body[key], dict):
            return f"{key} must be an object or null"
    return None


async def _read_body(request: web.Request) -> tuple[dict[str, Any] | None, str | None]:
    err = validate_body_size(request.content_length)
    if err is not None:
        return None, err
    try:
        body = await request.json()
    except Exception:
        return None, "invalid JSON body"
    if not isinstance(body, dict):
        return None, "body must be a JSON object"
    return body, None


async def list_scenarios(request: web.Request) -> web.Response:
    module_id = request.query.get("module")
    bundle_id = request.query.get("bundle")
    with db_session(request) as conn:
        repo = ScenarioRepository(conn)
        items = repo.list(query=request.query.get("q"))
        if module_id or bundle_id:
            wanted = set(repo.using(module_id=module_id, bundle_id=bundle_id))
            items = [s for s in items if s["id"] in wanted]
    return json_ok({"items": items, "total": len(items)})


async def create_scenario(request: web.Request) -> web.Response:
    body, err = await _read_body(request)
    if err is not None or body is None:
        return json_error(err or "invalid body", status=400)
    err = _validate(body, partial=False)
    if err is not None:
        return json_error(err, status=400)
    with db_session(request) as conn:
        row = ScenarioRepository(conn).create(
            name=body["name"].strip(),
            **{k: body[k] for k in _UPDATABLE_FIELDS if k in body and k != "name"},
        )
    return json_ok(row, status=201)


async def get_scenario(request: web.Request) -> web.Response:
    sid = request.match_info["id"]
    with db_session(request) as conn:
        try:
            row = ScenarioRepository(conn).get(sid)
        except ScenarioNotFound:
            return json_error(f"scenario {sid!r} not found", status=404)
    return json_ok(row)


async def update_scenario(request: web.Request) -> web.Response:
    sid = request.match_info["id"]
    body, err = await _read_body(request)
    if err is not None or body is None:
        return json_error(err or "invalid body", status=400)
    err = _validate(body, partial=True)
    if err is not None:
        return json_error(err, status=400)
    patch = {k: body[k] for k in _UPDATABLE_FIELDS if k in body}
    if isinstance(patch.get("name"), str):
        patch["name"] = patch["name"].strip()
    with db_session(request) as conn:
        try:
            row = ScenarioRepository(conn).update(sid, **patch)
        except ScenarioNotFound:
            return json_error(f"scenario {sid!r} not found", status=404)
    return json_ok(row)


async def delete_scenario(request: web.Request) -> web.Response:
    sid = request.match_info["id"]
    with db_session(request) as conn:
        try:
            ScenarioRepository(conn).delete(sid)
        except ScenarioNotFound:
            return json_error(f"scenario {sid!r} not found", status=404)
    return json_ok({"deleted": sid})


def register(router) -> None:
    router.add_get("/wp/api/test/scenarios", list_scenarios)
    router.add_post("/wp/api/test/scenarios", create_scenario)
    router.add_get("/wp/api/test/scenarios/{id}", get_scenario)
    router.add_put("/wp/api/test/scenarios/{id}", update_scenario)
    router.add_delete("/wp/api/test/scenarios/{id}", delete_scenario)
