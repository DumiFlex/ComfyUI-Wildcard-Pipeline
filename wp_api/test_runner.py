"""Test Runner routes.

``/wp/api/test/run`` runs a scenario — a stack of library modules and bundles,
optional pinned ``$var`` values and a seed spec — through the real
``PipelineEngine`` once per seed (see ``engine/scenario.py``).

``/wp/api/test`` is the older single-snapshot sampler; it predates seeded
runs and is kept only until the new Test Runner page replaces its last caller.
"""
from __future__ import annotations

import random
from collections import Counter
from typing import Any

from aiohttp import web

from engine.db.repositories import (
    BundleNotFound,
    BundleRepository,
    ModuleNotFound,
    ModuleRepository,
)
from engine.modules.dispatcher import UnknownModuleType, resolve_module
from engine.modules.snapshot import ref_seed_uuids, walk_transitive_refs
from engine.scenario import (
    DEFAULT_SAMPLE_LIMIT,
    DEFAULT_VALUE_LIMIT,
    ScenarioError,
    resolve_seeds,
    run_scenario,
)
from wp_api._helpers import db_session, extract_referenced_uuids, json_error, json_ok

_MAX_SAMPLE_LIMIT = 1000
_MAX_VALUE_LIMIT = 5000

_MAX_SAMPLES = 10000


def _build_request_catalog(request: web.Request, body: dict) -> dict[str, dict]:
    """Lazy-walk the request body for `@{8hex}` refs and load just the
    referenced wildcards (plus transitive deps) from the DB.

    Spec §2.10 — never the full library. Run ONCE per request; the catalog
    is stable across all sample iterations within the same `run_test` call,
    so callers should hoist this above their per-sample loop and reuse the
    returned dict for every `__wp_catalog__` injection."""
    roots = extract_referenced_uuids(body.get("payload"))
    roots |= extract_referenced_uuids(body.get("instance"))
    if not roots:
        return {}
    with db_session(request) as conn:
        repo = ModuleRepository(conn)

        def _fetch(uuid: str) -> dict | None:
            try:
                return repo.get_by_uuid(uuid)
            except Exception:
                return None

        return walk_transitive_refs(roots, fetch_module=_fetch).snapshots


def _make_sample_ctx(catalog: dict[str, dict]) -> dict:
    """Per-sample ctx — fresh `__wp_rng__` and `__wp_warnings__`, but the
    `__wp_catalog__` reference is shared across all samples (the resolver
    treats it as read-only)."""
    return {
        "__wp_rng__": random.Random(),
        "__wp_warnings__": [],
        "__wp_catalog__": catalog,
    }


async def run_test(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)

    required = {"type", "payload", "instance", "samples"}
    missing = required - body.keys()
    if missing:
        return json_error(f"missing fields: {sorted(missing)}", status=400)

    try:
        samples = int(body["samples"])
    except (TypeError, ValueError):
        return json_error("samples must be an integer", status=400)
    if samples < 1 or samples > _MAX_SAMPLES:
        return json_error(f"samples must be 1..{_MAX_SAMPLES}", status=400)

    snap = {
        "type": body["type"],
        "payload": body["payload"],
        "instance": body["instance"],
    }
    # Build the runtime catalog ONCE per request (§2.10 lazy walk). The
    # walked dict is stable across all sample iterations — only the rng
    # and warnings list need to be fresh per sample.
    catalog = _build_request_catalog(request, body)
    results: list[dict[str, str]] = []
    all_warnings: list[dict] = []
    try:
        for _ in range(samples):
            ctx = _make_sample_ctx(catalog)
            results.append(resolve_module(snap, ctx=ctx))
            all_warnings.extend(ctx["__wp_warnings__"])
    except UnknownModuleType as e:
        return json_error(f"unknown module type: {e.args[0]!r}", status=400)

    histogram: Counter[str] = Counter()
    for r in results:
        for v in r.values():
            histogram[v] += 1

    # Deduplicate warnings by (type, message) to avoid N*samples noise.
    seen: set[tuple] = set()
    deduped_warnings: list[dict] = []
    for w in all_warnings:
        key = (w.get("type"), w.get("message"))
        if key not in seen:
            seen.add(key)
            deduped_warnings.append(w)

    # Extract flat sample values for the SPA Test Runner display. Each
    # resolve_module call returns {binding: value}; we surface the values.
    sample_values: list[str] = []
    for r in results:
        for v in r.values():
            sample_values.append(v)
        if not r:
            sample_values.append("")

    return json_ok({
        "results": results,
        "histogram": dict(histogram),
        "samples": sample_values,        # NEW: additive top-level
        "warnings": deduped_warnings,    # NEW: additive top-level
    })


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


def _bundle_entries(bundle: dict[str, Any], uid: str, item: dict[str, Any]) -> list[dict[str, Any]]:
    """A bundle's children, stamped the way inserting it on the canvas does:
    each child gets its own `_uid` and the bundle's `bundle_origin`, so a
    constraint inside the bundle binds to its own copy's source pick."""
    bundle_on = bool(item.get("enabled", True))
    out: list[dict[str, Any]] = []
    for j, child in enumerate(bundle.get("children") or []):
        if not isinstance(child, dict):
            continue
        entry = dict(child)
        meta = entry.get("meta") if isinstance(entry.get("meta"), dict) else {}
        entry["_uid"] = f"{uid}.{j}"
        entry["bundle_origin"] = uid
        entry["enabled"] = bundle_on and bool(entry.get("enabled", True))
        entry.setdefault("name", meta.get("name", ""))
        entry.setdefault("instance", {})
        out.append(entry)
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
            children = _bundle_entries(bundle, uid, item)
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

    result = run_scenario(
        modules, seeds=seeds, catalog=catalog, pins=pins,
        sample_limit=sample_limit, value_limit=value_limit,
    )
    result["stack"] = layout
    result["missing"] = missing
    result["pins"] = pins
    return json_ok(result)


def register(router) -> None:
    router.add_post("/wp/api/test", run_test)
    router.add_post("/wp/api/test/run", run_scenario_route)
