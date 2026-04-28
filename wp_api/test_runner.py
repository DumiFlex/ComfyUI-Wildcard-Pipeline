"""/wp/api/test — runs N samples of the resolver against an ad-hoc snapshot."""
from __future__ import annotations

import random
from collections import Counter

from aiohttp import web

from engine.db.repositories import ModuleRepository
from engine.modules.dispatcher import UnknownModuleType, resolve_module
from engine.modules.snapshot import walk_transitive_refs
from wp_api._helpers import db_session, extract_referenced_uuids, json_error, json_ok

_MAX_SAMPLES = 10000


def _build_ctx_with_catalog(request: web.Request, body: dict) -> dict:
    """Build the runtime ctx for one Test Runner invocation.

    Walks the request payload + instance for `@{8hex}` refs, loads only
    those modules (and their transitive deps) from the DB, and seeds the
    catalog. Spec §2.10 — lazy walk, never the full library."""
    roots = extract_referenced_uuids(body.get("payload"))
    roots |= extract_referenced_uuids(body.get("instance"))

    catalog: dict[str, dict] = {}
    if roots:
        with db_session(request) as conn:
            repo = ModuleRepository(conn)

            def _fetch(uuid: str) -> dict | None:
                try:
                    return repo.get_by_uuid(uuid)
                except Exception:
                    return None

            walk = walk_transitive_refs(roots, fetch_module=_fetch)
            catalog = walk.snapshots

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
    results: list[dict[str, str]] = []
    all_warnings: list[dict] = []
    try:
        for _ in range(samples):
            ctx = _build_ctx_with_catalog(request, body)
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


def register(router) -> None:
    router.add_post("/wp/api/test", run_test)
