"""Preview route — dry-run a pipeline with a fixed seed and return resolved variables."""

from __future__ import annotations

import random
from typing import Any

from aiohttp import web


def _import_engine():
    try:
        from ...engine.pipeline import PipelineEngine
        from ...nodes.sources import resolve_sources
    except (ImportError, ValueError):
        from engine.pipeline import PipelineEngine
        from nodes.sources import resolve_sources
    return PipelineEngine, resolve_sources


async def preview_handler(request: web.Request) -> web.Response:
    PipelineEngine, resolve_sources = _import_engine()

    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    modules = body.get("modules", [])
    seed = body.get("seed", 42)

    if not isinstance(modules, list):
        return web.json_response({"error": "'modules' must be a list"}, status=400)
    if not isinstance(seed, int):
        return web.json_response({"error": "'seed' must be an integer"}, status=400)

    resolved_modules = resolve_sources(modules)

    rng = random.Random(seed)
    engine = PipelineEngine()
    ctx = engine.run(resolved_modules, {}, rng=rng)

    variables = {k: v for k, v in ctx.items() if not k.startswith("__")}

    return web.json_response({"variables": variables})


def create_preview_routes() -> web.RouteTableDef:
    routes = web.RouteTableDef()

    @routes.post("/wp/api/preview")
    async def _preview(request: web.Request) -> web.Response:
        return await preview_handler(request)

    return routes
