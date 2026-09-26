"""Test Runner routes.

``/wp/api/test/run`` runs a scenario — a stack of library modules and bundles,
optional pinned ``$var`` values and a seed spec — through the real
``PipelineEngine`` once per seed (see ``engine/scenario.py``).
"""
from __future__ import annotations

import asyncio
from typing import Any

from aiohttp import web

from engine.db.repositories import (
    BundleNotFound,
    BundleRepository,
    ModuleNotFound,
    ModuleRepository,
)
from engine.modules.snapshot import ref_seed_uuids, walk_transitive_refs
from engine.scenario import (
    DEFAULT_SAMPLE_LIMIT,
    DEFAULT_VALUE_LIMIT,
    ScenarioError,
    resolve_seeds,
    run_scenario,
)
from wp_api._helpers import db_session, json_error, json_ok

_MAX_SAMPLE_LIMIT = 1000
_MAX_VALUE_LIMIT = 5000


def _module_entry(row: dict[str, Any], uid: str, item: dict[str, Any]) -> dict[str, Any]:
    """A library row in the list shape a WP_Context node hands the engine."""
    instance = item.get("instance")
    return {
        "id": row["id"],
        "_uid": uid,
        "type": row["type"],
        "enabled": bool(item.get("enabled", True)),
        "name": row.get("name", ""),
        "meta": {"name": row.get("name", "")},
        "payload": row.get("payload") or {},
        "payload_hash": row.get("payload_hash", ""),
        "instance": dict(instance) if isinstance(instance, dict) else {},
    }


def _bundle_entries(
    bundle: dict[str, Any], uid: str, item: dict[str, Any], repo: BundleRepository,
) -> list[dict[str, Any]]:
    """A bundle's children, stamped the way inserting it on the canvas does:
    each child gets its own `_uid` and a `bundle_origin`, so a constraint
    inside the bundle binds to its own copy's source pick.

    A nested bundle is stored as an id reference; like the canvas insert, it
    expands inline to the referenced bundle's current children with their own
    `bundle_origin`. The tier-2 nesting cap means those are leaves. A missing
    reference is dropped."""
    bundle_on = bool(item.get("enabled", True))
    out: list[dict[str, Any]] = []

    def stamp(child: dict[str, Any], child_uid: str, origin: str, on: bool) -> None:
        entry = dict(child)
        meta = entry.get("meta") if isinstance(entry.get("meta"), dict) else {}
        entry["_uid"] = child_uid
        entry["bundle_origin"] = origin
        entry["enabled"] = on and bool(entry.get("enabled", True))
        entry.setdefault("name", meta.get("name", ""))
        entry.setdefault("instance", {})
        out.append(entry)

    for j, child in enumerate(bundle.get("children") or []):
        if not isinstance(child, dict):
            continue
        if child.get("type") != "bundle":
            stamp(child, f"{uid}.{j}", uid, bundle_on)
            continue
        ref_id = child.get("id")
        try:
            inner = repo.get(ref_id) if isinstance(ref_id, str) else None
        except BundleNotFound:
            inner = None
        if inner is None:
            continue
        inner_uid = f"{uid}.{j}"
        inner_on = bundle_on and bool(child.get("enabled", True))
        for k, grandchild in enumerate(inner.get("children") or []):
            if isinstance(grandchild, dict) and grandchild.get("type") != "bundle":
                stamp(grandchild, f"{inner_uid}.{k}", inner_uid, inner_on)
    return out


_Stack = tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, str]]]


def _build_stack(conn, stack: list[Any]) -> _Stack:
    """Resolve stack items against the library.

    Returns ``(modules, layout, missing)``: the flat module list the engine
    runs, one layout row per stack item (which `_uid`s it expanded to, so a UI
    can map trace rows back to what the user added), and the items whose
    module or bundle no longer exists — those are skipped, not fatal, so a
    saved scenario still runs after a module it used is deleted.
    """
    modules_repo = ModuleRepository(conn)
    bundles_repo = BundleRepository(conn)
    modules: list[dict[str, Any]] = []
    layout: list[dict[str, Any]] = []
    missing: list[dict[str, str]] = []
    for i, item in enumerate(stack):
        if not isinstance(item, dict):
            raise ScenarioError(f"stack[{i}] must be an object")
        uid = f"s{i}"
        if isinstance(item.get("module"), str):
            try:
                row = modules_repo.get(item["module"])
            except ModuleNotFound:
                missing.append({"kind": "module", "id": item["module"]})
                continue
            modules.append(_module_entry(row, uid, item))
            layout.append({
                "index": i, "kind": "module", "id": row["id"],
                "name": row.get("name", ""), "type": row["type"], "uids": [uid],
            })
        elif isinstance(item.get("bundle"), str):
            try:
                bundle = bundles_repo.get(item["bundle"])
            except BundleNotFound:
                missing.append({"kind": "bundle", "id": item["bundle"]})
                continue
            children = _bundle_entries(bundle, uid, item, bundles_repo)
            modules.extend(children)
            layout.append({
                "index": i, "kind": "bundle", "id": bundle["id"],
                "name": bundle.get("name", ""), "type": "bundle",
                "uids": [c["_uid"] for c in children],
            })
        else:
            raise ScenarioError(f"stack[{i}] needs a 'module' or 'bundle' id")
    return modules, layout, missing


def _build_catalog(conn, modules: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The `@{uuid}` catalog for a stack: its own wildcards (as the stack
    carries them) plus every transitive ref, fetched from the live library —
    the same seeding a WP_Context node uses (`ref_seed_uuids` covers refs on
    derivation actions and instance overrides, not only wildcard options)."""
    embedded = {
        m["id"]: m for m in modules
        if m.get("type") == "wildcard" and isinstance(m.get("id"), str)
    }
    repo = ModuleRepository(conn)

    def _fetch(uuid: str) -> dict[str, Any] | None:
        m = embedded.get(uuid)
        if m is not None:
            return {"id": uuid, "type": "wildcard", "name": m.get("name", ""),
                    "payload": m.get("payload") or {}, "payload_hash": m.get("payload_hash", "")}
        try:
            return repo.get(uuid)
        except ModuleNotFound:
            return None

    roots = list(embedded) + sorted(u for u in ref_seed_uuids(modules) if u not in embedded)
    if not roots:
        return {}
    return walk_transitive_refs(roots, fetch_module=_fetch).snapshots


def _bounded_int(body: dict, key: str, default: int, upper: int) -> int:
    raw = body.get(key, default)
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ScenarioError(f"{key} must be an integer") from exc
    if value < 0 or value > upper:
        raise ScenarioError(f"{key} must be 0..{upper}")
    return value


async def run_scenario_route(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)

    stack = body.get("stack")
    if not isinstance(stack, list) or not stack:
        return json_error("stack must be a non-empty list", status=400)
    pins = body.get("pins") or {}
    if not isinstance(pins, dict) or not all(isinstance(k, str) and k for k in pins):
        return json_error("pins must be an object of $var name to value", status=400)
    pins = {k.lstrip("$"): "" if v is None else str(v) for k, v in pins.items()}

    try:
        seeds = resolve_seeds(body.get("seeds", {"random": True, "count": 100}))
        sample_limit = _bounded_int(body, "sample_limit", DEFAULT_SAMPLE_LIMIT, _MAX_SAMPLE_LIMIT)
        value_limit = _bounded_int(body, "value_limit", DEFAULT_VALUE_LIMIT, _MAX_VALUE_LIMIT)
        with db_session(request) as conn:
            modules, layout, missing = _build_stack(conn, stack)
            catalog = _build_catalog(conn, modules)
    except ScenarioError as exc:
        return json_error(str(exc), status=400)

    # Up to thousands of engine runs: keep them off the event loop so
    # ComfyUI's websocket and other routes stay responsive meanwhile.
    result = await asyncio.to_thread(
        run_scenario,
        modules, seeds=seeds, catalog=catalog, pins=pins,
        sample_limit=sample_limit, value_limit=value_limit,
    )
    result["stack"] = layout
    result["missing"] = missing
    result["pins"] = pins
    return json_ok(result)


def register(router) -> None:
    router.add_post("/wp/api/test/run", run_scenario_route)
