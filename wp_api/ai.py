"""/wp/api/ai/* — the AI assistant.

    GET  /wp/api/ai/config          settings without the key (+ key_set)
    PUT  /wp/api/ai/config          partial update; `api_key` is write-only
    POST /wp/api/ai/models          list the server's models (uses saved config)
    POST /wp/api/ai/test            Test connection: models + a tiny JSON call
    POST /wp/api/ai/wildcard/draft  new options for a wildcard (not saved)
    POST /wp/api/ai/wildcard/edit   remove / rewrite / retag / re-weight
                                    options (a before/after list, not saved)
    POST /wp/api/ai/derivation/draft  derivation rules from a description
    POST /wp/api/ai/constraint/draft  constraint cells + exceptions from a
                                      description

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
from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import library_vars
from engine.ai import wildcard as ai_wildcard
from engine.ai import wildcard_edit as ai_edit
from engine.db.repositories import ModuleNotFound, ModuleRepository
from wp_api import _ai_client
from wp_api._helpers import db_session, json_error, json_ok

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


async def post_wildcard_edit(request: web.Request) -> web.Response:
    """Body: {action, instruction, wildcard: {name?, var_binding?, payload}}.

    `payload.options` are the rows to edit (the whole list, or the editor's
    selection), each with its real `id`. The model sees them numbered 1..N
    and the answer is mapped back, so every change names a real option.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body

    action = body.get("action")
    if action not in ai_edit.ACTIONS:
        return json_error("action must be remove, rewrite, retag or reweight", status=400)
    instruction = body.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        return json_error("say what to change", status=400)
    if len(instruction) > ai_wildcard.MAX_INSTRUCTION_LEN:
        return json_error("that request is too long", status=400)

    wc = body.get("wildcard") if isinstance(body.get("wildcard"), dict) else {}
    payload = wc.get("payload") if isinstance(wc.get("payload"), dict) else {}
    raw_opts = payload.get("options") if isinstance(payload.get("options"), list) else []
    rows: list[dict] = []
    real_ids: dict[str, str] = {}
    for o in raw_opts:
        if not isinstance(o, dict) or o.get("is_null") is True:
            continue
        value = o.get("value")
        oid = o.get("id")
        if not isinstance(value, str) or not value.strip() or not isinstance(oid, str):
            continue
        short = str(len(rows) + 1)
        real_ids[short] = oid
        weight = o.get("weight", 1)
        if isinstance(weight, bool) or not isinstance(weight, (int, float)):
            weight = 1
        rows.append({
            "id": short,
            "value": value.strip(),
            "weight": weight,
            "sub_categories": _str_list(o.get("sub_categories"), limit=50),
        })
    if not rows:
        return json_error("there are no options to edit", status=400)
    if len(rows) > ai_edit.MAX_EDIT_OPTIONS:
        return json_error(
            f"that's {len(rows)} options; select up to {ai_edit.MAX_EDIT_OPTIONS} and try again",
            status=400,
        )
    tags = _str_list(payload.get("sub_categories"), limit=500)
    raw_groups = payload.get("tag_groups") if isinstance(payload.get("tag_groups"), dict) else {}
    axes = {str(k): _str_list(v, limit=200) for k, v in list(raw_groups.items())[:50]}
    name = wc.get("name") if isinstance(wc.get("name"), str) else ""
    var = wc.get("var_binding") if isinstance(wc.get("var_binding"), str) else ""

    user = ai_edit.build_edit_prompt(
        action=action, instruction=instruction, name=name[:200], var_binding=var[:100],
        options=rows, tags=tags, axes=axes,
    )
    try:
        answer = await _ai_client.complete_json(
            cfg, system=ai_edit.system_prompt(action), user=user,
            schema=ai_edit.SCHEMAS[action], schema_name=f"wildcard_{action}",
            # Edits should be faithful to the request, not creative.
            temperature=0.3,
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    try:
        result = ai_edit.compile_edit(action, answer, options=rows, registry=tags)
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    for c in result["changes"]:
        c["option_id"] = real_ids[c.pop("id")]
    result["action"] = action
    result["model"] = cfg["model"]
    return json_ok(result)


def _instruction(body: dict[str, Any], missing: str) -> str | web.Response:
    instruction = body.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        return json_error(missing, status=400)
    if len(instruction) > ai_wildcard.MAX_INSTRUCTION_LEN:
        return json_error("that request is too long", status=400)
    return instruction


async def post_derivation_draft(request: web.Request) -> web.Response:
    """Body: {instruction, derivation: {name?, rules?}}.

    `rules` are the editor's current rules (unsaved edits included); the
    model is told not to repeat them, and new rule ids avoid theirs. The
    variables it may use come from the library.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    instruction = _instruction(body, "say what the rules should do")
    if isinstance(instruction, web.Response):
        return instruction
    drv = body.get("derivation") if isinstance(body.get("derivation"), dict) else {}
    rules = [r for r in drv.get("rules") or [] if isinstance(r, dict)][:200]
    name = drv.get("name") if isinstance(drv.get("name"), str) else ""

    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
    catalog = library_vars.build_catalog(modules)
    focus = [
        n for line in (ai_derivation.describe_rule(r) for r in rules)
        for n in library_vars.var_names_in(line)
    ]
    user = ai_derivation.build_prompt(
        instruction=instruction, name=name[:200],
        catalog_text=library_vars.describe(catalog, focus=focus),
        existing_rules=[ai_derivation.describe_rule(r) for r in rules],
    )
    try:
        answer = await _ai_client.complete_json(
            cfg, system=ai_derivation.SYSTEM_PROMPT, user=user,
            schema=ai_derivation.SCHEMA, schema_name="derivation_rules", temperature=0.3,
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    try:
        result = ai_derivation.compile_rules(
            answer, catalog=catalog,
            taken_ids={r["id"] for r in rules if isinstance(r.get("id"), str)},
        )
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    result["model"] = cfg["model"]
    return json_ok(result)


async def post_constraint_draft(request: web.Request) -> web.Response:
    """Body: {instruction, constraint: {source_wildcard_id, target_wildcard_id,
    matrix?, exceptions?}}.

    Both wildcards are read from the library (the constraint editor links
    saved wildcards). `matrix` / `exceptions` are the editor's current rules,
    so the answer can say which pairs it would replace.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    instruction = _instruction(body, "say what the rules should do")
    if isinstance(instruction, web.Response):
        return instruction
    cons = body.get("constraint") if isinstance(body.get("constraint"), dict) else {}
    src_id, tgt_id = cons.get("source_wildcard_id"), cons.get("target_wildcard_id")
    if not isinstance(src_id, str) or not isinstance(tgt_id, str) or not src_id or not tgt_id:
        return json_error("pick the source and target wildcards first", status=400)
    try:
        with db_session(request) as conn:
            repo = ModuleRepository(conn)
            src_row, tgt_row = repo.get(src_id), repo.get(tgt_id)
    except ModuleNotFound:
        return json_error("one of the wildcards isn't in the library any more", status=404)
    if src_row.get("type") != "wildcard" or tgt_row.get("type") != "wildcard":
        return json_error("source and target must be wildcards", status=400)
    source = ai_constraint.side_view(src_row, "S")
    target = ai_constraint.side_view(tgt_row, "T")
    if not source["options"] or not target["options"]:
        return json_error("both wildcards need options first", status=400)
    existing = {
        "matrix": cons.get("matrix") if isinstance(cons.get("matrix"), dict) else {},
        "exceptions": [e for e in cons.get("exceptions") or [] if isinstance(e, dict)][:2000],
    }
    user = ai_constraint.build_prompt(
        instruction=instruction, source=source, target=target,
        existing=ai_constraint.describe_existing(existing),
    )
    try:
        answer = await _ai_client.complete_json(
            cfg, system=ai_constraint.SYSTEM_PROMPT, user=user,
            schema=ai_constraint.SCHEMA, schema_name="constraint_rules", temperature=0.3,
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    try:
        result = ai_constraint.compile_rules(
            answer, source=source, target=target, existing=existing,
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
    router.add_post("/wp/api/ai/wildcard/edit", post_wildcard_edit)
    router.add_post("/wp/api/ai/derivation/draft", post_derivation_draft)
    router.add_post("/wp/api/ai/constraint/draft", post_constraint_draft)
