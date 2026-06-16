"""POST /wp/api/preview/resolve — assembler-preview RNG-faithful resolve.

Frontend assembler widget calls this to get the same `(name → value)`
map a real WP_Context chain would produce at run time when every node
is seeded with the supplied seed (default 42). Returning ground truth
from the engine guarantees the preview matches what the user sees on
queue without porting Python's MT19937 to JS.

Body shape:
    {
      "chain": [<modules-list-step-1>, <modules-list-step-2>, ...],
      "seed": <int, default 42>
    }

Each `modules-list-step-N` is the same list shape ContextWidget
serialises into a node's `modules` widget value: list of module dicts
with `id`, `type`, `enabled`, `payload`, `entries`, `instance`, ...

Returns:
    {"resolved": {<name>: <value>, ...}}

Empty chain or any malformed step → empty resolved map (never 500).
"""
from __future__ import annotations

import logging
from typing import Any

from aiohttp import web

from engine.context import strip_internals
from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.repositories import ModuleNotFound, ModuleRepository
from engine.modules.snapshot import walk_transitive_refs
from engine.pipeline import PipelineEngine
from engine.syntax.types import ListVar
from wp_api._helpers import json_error, json_ok

logger = logging.getLogger(__name__)


def _build_catalog(modules: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Wildcard subset → SnapshotEntry-shaped catalog keyed by uuid.

    Mirrors `wp_nodes/types.py:deserialize_node_input` so the engine
    sees the same shape it gets at run time.
    """
    catalog: dict[str, dict[str, Any]] = {}
    for m in modules:
        if not isinstance(m, dict) or m.get("type") != "wildcard":
            continue
        mid = m.get("id")
        if not isinstance(mid, str):
            continue
        payload = m.get("payload")
        if not isinstance(payload, dict):
            continue
        meta = m.get("meta") if isinstance(m.get("meta"), dict) else {}
        catalog[mid] = {
            "snapshot_version": 1,
            "uuid": mid,
            "type": "wildcard",
            "name": meta.get("name", "") if isinstance(meta, dict) else "",
            "payload": payload,
            "payload_hash": m.get("payload_hash") or "",
            "source": {"kind": "user"},
        }
    return catalog


def _expand_with_db(catalog: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Pull in nested `@{uuid}` refs from the live DB so preview can
    resolve them — mirrors `wp_nodes/context_node.py:_expand_catalog_via_live_db`.

    Failure-tolerant: any DB hiccup returns the embedded catalog
    unchanged and the resolver falls back to the standard
    "unknown ref" warning at expand time.
    """
    if not catalog:
        return catalog
    try:
        conn = get_connection()
        migrate(conn)
        repo = ModuleRepository(conn)
    except Exception:
        return catalog

    def _fetch(uuid: str) -> dict[str, Any] | None:
        embedded = catalog.get(uuid)
        if embedded is not None:
            return {
                "id": uuid,
                "type": embedded["type"],
                "name": embedded.get("name", ""),
                "payload": embedded["payload"],
                "payload_hash": embedded.get("payload_hash", ""),
            }
        try:
            return repo.get(uuid)
        except ModuleNotFound:
            return None
        except Exception:
            return None

    walk = walk_transitive_refs(list(catalog.keys()), fetch_module=_fetch)
    return walk.snapshots


def _jsonify_resolved(resolved: dict[str, Any]) -> dict[str, Any]:
    """Make a resolved ctx map JSON-serialisable. A multi-pick var is a
    `ListVar` dataclass (engine/syntax/types.py) that aiohttp's JSON encoder
    can't handle — without this the endpoint 500s. Emit it as
    ``{"items": [...], "sep": ...}`` so the TS preview can join (bare $name)
    or index ($name.K) it, matching the engine's resolution exactly."""
    out: dict[str, Any] = {}
    for k, v in resolved.items():
        out[k] = {"items": list(v.items), "sep": v.sep} if isinstance(v, ListVar) else v
    return out


async def resolve_preview(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)

    chain = body.get("chain")
    if not isinstance(chain, list):
        return json_error("chain must be a list", status=400)

    try:
        seed = int(body.get("seed", 42))
    except (TypeError, ValueError):
        return json_error("seed must be an integer", status=400)

    # Walk chain steps upstream → downstream; each step's modules run
    # in their own PipelineEngine.run() with the supplied seed. Earlier
    # ctx feeds the next step as upstream. Catalog accumulates wildcards
    # from every step + their nested refs from the live DB.
    ctx: dict[str, Any] = {}
    accum_catalog: dict[str, dict[str, Any]] = {}
    for step in chain:
        if not isinstance(step, list):
            continue
        modules = [m for m in step if isinstance(m, dict)]
        accum_catalog.update(_build_catalog(modules))
        # Re-expand each step so newly-introduced wildcards pull their
        # nested deps too. walk_transitive_refs is idempotent.
        accum_catalog = _expand_with_db(accum_catalog)
        ctx["__wp_catalog__"] = accum_catalog
        try:
            ctx = PipelineEngine().run(modules, ctx=ctx, seed=seed)
        except Exception:
            logger.exception("preview resolve: pipeline run failed")
            # Don't return 500 — the user is just typing. Surface
            # whatever we resolved up to this point.
            break

    return json_ok({"resolved": _jsonify_resolved(strip_internals(ctx))})


def register(router) -> None:
    router.add_post("/wp/api/preview/resolve", resolve_preview)
