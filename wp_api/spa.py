"""/wp + /wp/{path:.*} — static asset server with SPA fallback.

Looks up the requested path inside ``WEB_DIR``. If a file exists, serves it.
Otherwise serves ``index.html`` so the SPA router can take over (any
``/wp/<route>`` path resolves to the SPA shell).

Exception: paths under ``/wp/api/`` that fell through every registered
API route are returned as JSON 404, not the SPA shell. Without this
guard a client typo like ``/wp/api/moduels`` returned 200 ``text/html``
(the SPA index), making API debugging hostile — the JSON.parse failure
on the client masked the real "no such endpoint" error.
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
    path = request.match_info["path"]
    # `/wp/api/...` is reserved for the JSON API. Any request reaching
    # this handler under that prefix means no specific API route
    # matched — return a real 404 instead of the SPA shell so the
    # client gets a useful error.
    if path.startswith("api/") or path == "api":
        return web.json_response({"error": f"no such API route: /wp/{path}"}, status=404)
    return await _serve(path)


def register(router) -> None:
    router.add_get("/wp", serve_root)
    router.add_get("/wp/{path:.*}", serve_path)
