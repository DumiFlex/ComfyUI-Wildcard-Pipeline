"""/wp/api/test — runs N samples of the resolver against an ad-hoc snapshot."""
from __future__ import annotations

from collections import Counter

from aiohttp import web

from engine.modules.dispatcher import UnknownModuleType, resolve_module
from engine.modules.wildcard_handler import RecursionLimitExceeded
from wp_api._helpers import json_error, json_ok

_MAX_SAMPLES = 10000


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
    try:
        for _ in range(samples):
            results.append(resolve_module(snap, ctx=None))
    except UnknownModuleType as e:
        return json_error(f"unknown module type: {e.args[0]!r}", status=400)
    except RecursionLimitExceeded as e:
        return json_error(f"circular @{{ref}} reference: {e}", status=400)

    histogram: Counter[str] = Counter()
    for r in results:
        for v in r.values():
            histogram[v] += 1

    return json_ok({"results": results, "histogram": dict(histogram)})


def register(router) -> None:
    router.add_post("/wp/api/test", run_test)
