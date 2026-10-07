"""`/wp/api/image-filter/*` — the picker's answer channel for WP_ImageFilter.

The node announces a pick request over ComfyUI's websocket and waits; the
canvas picker answers here. `pending` lets a page that was reloaded (or opened
late) show requests that are still waiting.
"""
from __future__ import annotations

from aiohttp import web

from engine import image_filter as _f
from wp_api._helpers import json_error, json_ok


async def post_answer(request: web.Request) -> web.Response:
    """POST /wp/api/image-filter/answer

    Body: ``{token, action: "picks"|"keep_all"|"stop", picks?: [[frame, image], …]}``.
    The node validates the picks against its frames; here we only route the
    answer to the waiting request. 404 when nothing waits on ``token`` (already
    answered, timed out, or the run was cancelled).
    """
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - any parse failure is a bad request
        return json_error("Body must be JSON.", status=400)
    if not isinstance(body, dict):
        return json_error("Body must be an object.", status=400)
    token = body.get("token")
    if not isinstance(token, str) or not token:
        return json_error("Missing token.", status=400)
    if body.get("action") not in ("picks", "keep_all", "stop"):
        return json_error("Unknown action.", status=400)
    if not _f.PENDING.answer(token, body):
        return json_error("Nothing is waiting for this answer.", status=404)
    return json_ok({"accepted": True})


async def get_pending(_request: web.Request) -> web.Response:
    """GET /wp/api/image-filter/pending — requests still waiting for a pick."""
    return json_ok({"pending": _f.PENDING.pending()})


def register(router: web.UrlDispatcher) -> None:
    router.add_post("/wp/api/image-filter/answer", post_answer)
    router.add_get("/wp/api/image-filter/pending", get_pending)
