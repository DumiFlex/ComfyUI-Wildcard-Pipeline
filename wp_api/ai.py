"""/wp/api/ai/* — the AI assistant.

    GET  /wp/api/ai/config          settings without the key (+ key_set)
    PUT  /wp/api/ai/config          partial update; `api_key` is write-only
    POST /wp/api/ai/models          list the server's models (uses saved config)
    POST /wp/api/ai/test            Test connection: models + a tiny JSON call
    POST /wp/api/ai/wildcard/draft  new options for a wildcard (not saved)

Off by default: every route except the config pair answers 403 until the user
turns the assistant on. Nothing here writes to the library. Drafts come back
to the editor, which inserts them like any pasted option and saves only when
the user does. See `_ai_client.py` for the threat model.
"""
from __future__ import annotations

import json as _json
from typing import Any

from aiohttp import web

from engine.ai import config as ai_config
from engine.ai import wildcard as ai_wildcard
from wp_api import _ai_client
from wp_api._helpers import json_error, json_ok

_MAX_BODY_BYTES = 512 * 1024


async def _body(request: web.Request) -> dict[str, Any] | web.Response:
    if request.content_length is not None and request.content_length > _MAX_BODY_BYTES:
        return json_error("request too large", status=413)
    try:
        raw = await request.read()
    except web.HTTPRequestEntityTooLarge:
        return json_error("request too large", status=413)
    if len(raw) > _MAX_BODY_BYTES:
        return json_error("request too large", status=413)
    if not raw:
        return {}
    try:
        body = _json.loads(raw)
    except ValueError:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be an object", status=400)
    return body


def _enabled_cfg() -> dict[str, Any] | web.Response:
    cfg = ai_config.load_effective()
    if not cfg["enabled"]:
        return json_error(
            "the AI assistant is off. Turn it on in Settings › AI assistant.", status=403,
        )
    return cfg


async def get_config(request: web.Request) -> web.Response:
    return json_ok(ai_config.public_view())


async def put_config(request: web.Request) -> web.Response:
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    try:
        return json_ok(ai_config.update(body))
    except ai_config.ConfigError as e:
        return json_error(str(e), status=400)
    except OSError as e:
        return json_error(f"could not save AI settings: {e}", status=500)


async def post_models(request: web.Request) -> web.Response:
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    try:
        return json_ok({"models": await _ai_client.list_models(cfg)})
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)


async def post_test(request: web.Request) -> web.Response:
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    return json_ok(await _ai_client.probe(cfg))


def _str_list(value: Any, *, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [v for v in value if isinstance(v, str)][:limit]


async def post_wildcard_draft(request: web.Request) -> web.Response:
    """Body: {instruction, count?, wildcard: {name?, var_binding?, payload}}.

    `payload` is the editor's current draft (options, sub_categories,
    tag_groups), so the model sees unsaved edits too.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body

    instruction = body.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        return json_error("say what to add", status=400)
    if len(instruction) > ai_wildcard.MAX_INSTRUCTION_LEN:
        return json_error("that request is too long", status=400)
    count = body.get("count", 10)
    if isinstance(count, bool) or not isinstance(count, int):
        return json_error("count must be a whole number", status=400)
    count = max(1, min(ai_wildcard.MAX_COUNT, count))

    wc = body.get("wildcard") if isinstance(body.get("wildcard"), dict) else {}
    payload = wc.get("payload") if isinstance(wc.get("payload"), dict) else {}
    options = payload.get("options") if isinstance(payload.get("options"), list) else []
    existing_texts = [
        o["value"].strip() for o in options
        if isinstance(o, dict) and isinstance(o.get("value"), str) and o["value"].strip()
    ][:5000]
    tags = _str_list(payload.get("sub_categories"), limit=500)
    raw_groups = payload.get("tag_groups") if isinstance(payload.get("tag_groups"), dict) else {}
    axes = {
        str(k): _str_list(v, limit=200) for k, v in list(raw_groups.items())[:50]
    }
    name = wc.get("name") if isinstance(wc.get("name"), str) else ""
    var = wc.get("var_binding") if isinstance(wc.get("var_binding"), str) else ""

    user = ai_wildcard.build_user_prompt(
        instruction=instruction, count=count, name=name[:200], var_binding=var[:100],
        existing_options=existing_texts, tags=tags, axes=axes,
    )
    try:
        answer = await _ai_client.complete_json(
            cfg, system=ai_wildcard.SYSTEM_PROMPT, user=user,
            schema=ai_wildcard.OPTIONS_SCHEMA, schema_name="wildcard_options",
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)

    try:
        result = ai_wildcard.compile_options(
            answer,
            existing_payload={
                "options": [o for o in options if isinstance(o, dict)][:5000],
                "sub_categories": tags,
            },
            limit=count,
        )
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    result["model"] = cfg["model"]
    return json_ok(result)


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/ai/config", get_config)
    router.add_put("/wp/api/ai/config", put_config)
    router.add_post("/wp/api/ai/models", post_models)
    router.add_post("/wp/api/ai/test", post_test)
    router.add_post("/wp/api/ai/wildcard/draft", post_wildcard_draft)
