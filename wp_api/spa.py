"""/wp + /wp/{path:.*} — static asset server with SPA fallback.

Looks up the requested path inside ``WEB_DIR``. If a file exists, serves it.
Otherwise serves ``index.html`` so the SPA router can take over (any
``/wp/<route>`` path resolves to the SPA shell).
"""
from __future__ import annotations

from pathlib import Path

from aiohttp import web

WEB_DIR = Path(__file__).parent.parent / "web"


async def _serve(path: str) -> web.StreamResponse:
    if path:
        candidate = (WEB_DIR / path).resolve()
        try:
            candidate.relative_to(WEB_DIR.resolve())
        except ValueError:
            return web.Response(status=403)
        if candidate.is_file():
            return web.FileResponse(candidate)
    return web.FileResponse(WEB_DIR / "index.html")


async def serve_root(request: web.Request) -> web.StreamResponse:
    return await _serve("")


async def serve_path(request: web.Request) -> web.StreamResponse:
    return await _serve(request.match_info["path"])


def register(router) -> None:
    router.add_get("/wp", serve_root)
    router.add_get("/wp/{path:.*}", serve_path)
