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
    POST /wp/api/ai/describe        a description + library tags for a
                                    module, bundle or template
    POST /wp/api/ai/organize        category, tags and rating for a batch
                                    of modules and bundles
    POST /wp/api/ai/chat            a chat turn: the model reads the library
                                    with tools and proposes changes; the
                                    server keeps the chat (`ai_chats`)
    POST /wp/api/ai/pack/plan       pack builder: an outline from a request
    POST /wp/api/ai/pack/review     check a plan against the guide (+ model review)
    POST /wp/api/ai/pack/item       build one planned item (not saved)
    POST /wp/api/ai/pack/check      run the built pack on the engine
    POST /wp/api/ai/pack/install    install the pack as one undoable import

Every drafting route also takes `history` (earlier turns of the same
conversation, see `engine/ai/followup.py`) and returns the model's raw
`answer`, so the editor can send a follow-up that refines the last answer.

Off by default: every route except the config pair answers 403 until the user
turns the assistant on. Nothing here writes to the library. Drafts come back
to the editor, which inserts them like any pasted option and saves only when
the user does. See `_ai_client.py` for the threat model.
"""
from __future__ import annotations

import asyncio
import json as _json
import sqlite3
from typing import Any

from aiohttp import web

from engine.ai import about as ai_about
from engine.ai import budget as ai_budget
from engine.ai import chat as ai_chat
from engine.ai import chatlog as ai_chatlog
from engine.ai import config as ai_config
from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import describe as ai_describe
from engine.ai import docs as ai_docs
from engine.ai import followup as ai_followup
from engine.ai import index as ai_index
from engine.ai import library_vars, text_items
from engine.ai import organize as ai_organize
from engine.ai import pack as ai_pack
from engine.ai import patterns as ai_patterns
from engine.ai import refs as ai_refs
from engine.ai import tools as ai_tools
from engine.ai import wildcard as ai_wildcard
from engine.ai import wildcard_edit as ai_edit
from engine.db.repositories import (
    BundleRepository,
    CategoryRepository,
    ChatNotFound,
    ChatRepository,
    ModuleNotFound,
    ModuleRepository,
    TemplateRepository,
)
from engine.importer import commit_import
from wp_api import _ai_chat, _ai_client, _ai_embed
from wp_api._helpers import cancel_on_disconnect, db_session, json_error, json_ok
from wp_api._validators import validate_wildcard_name

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
    result = await _ai_client.probe(cfg)
    result["embed"] = await _ai_embed.check(cfg) if result.get("ok") else None
    return json_ok(result)


def _turns(body: dict[str, Any]) -> list[dict[str, Any]] | web.Response:
    try:
        return ai_followup.parse_history(body.get("history"))
    except ai_followup.HistoryError as e:
        return json_error(str(e), status=400)


async def _ask(
    cfg: dict[str, Any], *, first: str, turns: list[dict[str, Any]], instruction: str,
    **kwargs: Any,
) -> Any:
    """`complete_json` with the conversation so far, when there is one."""
    history, user = ai_followup.conversation(first, turns, instruction)
    return await _ai_client.complete_json(cfg, user=user, history=history, **kwargs)


def _wildcards(request: web.Request) -> list[dict[str, Any]]:
    """The library's wildcards, for name refs (`@{Colors:warm}`)."""
    with db_session(request) as conn:
        return [m for m in ModuleRepository(conn).list() if m.get("type") == "wildcard"]


def _ref_index(rows: list[dict[str, Any]], editor_id: Any = None,
               editor_payload: Any = None, name: Any = None) -> ai_refs.RefIndex:
    """Library wildcards, with the open editor's version of its own."""
    idx = ai_refs.RefIndex(rows)
    if isinstance(editor_id, str) and isinstance(editor_payload, dict):
        saved = idx.rows.get(editor_id) or {}
        idx.add({"id": editor_id, "type": "wildcard",
                 "name": name if isinstance(name, str) and name else saved.get("name", ""),
                 "payload": editor_payload})
    return idx


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
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns

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

    description, labels = ai_about.clean(wc.get("description"), wc.get("tags"))
    self_id = wc.get("id") if isinstance(wc.get("id"), str) else None
    refs = _ref_index(_wildcards(request), self_id, payload, name)
    existing_texts = [ai_refs.display_text(t, refs) for t in existing_texts]
    first = ai_wildcard.build_user_prompt(
        instruction=ai_followup.first_instruction(turns, instruction), count=count,
        name=name[:200], var_binding=var[:100],
        existing_options=existing_texts, tags=tags, axes=axes,
        description=description, labels=labels, refs_text=refs.describe(exclude=self_id),
    )
    try:
        answer = await _ask(
            cfg, first=first, turns=turns, instruction=instruction,
            system=ai_wildcard.SYSTEM_PROMPT, schema=ai_wildcard.OPTIONS_SCHEMA,
            schema_name="wildcard_options",
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
            limit=count, refs=refs, self_id=self_id,
        )
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    result["model"] = cfg["model"]
    result["answer"] = answer
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
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns

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

    description, labels = ai_about.clean(wc.get("description"), wc.get("tags"))
    self_id = wc.get("id") if isinstance(wc.get("id"), str) else None
    refs = _ref_index(_wildcards(request), self_id, payload, name)
    first = ai_edit.build_edit_prompt(
        action=action, instruction=ai_followup.first_instruction(turns, instruction),
        name=name[:200], var_binding=var[:100],
        options=rows, tags=tags, axes=axes, description=description, labels=labels,
        refs=refs,
    )
    try:
        answer = await _ask(
            cfg, first=first, turns=turns, instruction=instruction,
            system=ai_edit.system_prompt(action),
            schema=ai_edit.SCHEMAS[action], schema_name=f"wildcard_{action}",
            # Edits should be faithful to the request, not creative.
            temperature=0.3,
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    try:
        result = ai_edit.compile_edit(action, answer, options=rows, registry=tags,
                                      refs=refs, self_id=self_id)
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    for c in result["changes"]:
        c["option_id"] = real_ids[c.pop("id")]
    result["action"] = action
    result["model"] = cfg["model"]
    result["answer"] = answer
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
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    drv = body.get("derivation") if isinstance(body.get("derivation"), dict) else {}
    rules = [r for r in drv.get("rules") or [] if isinstance(r, dict)][:200]
    name = drv.get("name") if isinstance(drv.get("name"), str) else ""

    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
    catalog = library_vars.build_catalog(modules)
    refs = ai_refs.RefIndex([m for m in modules if m.get("type") == "wildcard"])
    focus = [
        n for line in (ai_derivation.describe_rule(r) for r in rules)
        for n in library_vars.var_names_in(line)
    ]
    description, labels = ai_about.clean(drv.get("description"), drv.get("tags"))
    first = ai_derivation.build_prompt(
        instruction=ai_followup.first_instruction(turns, instruction), name=name[:200],
        description=description, labels=labels,
        catalog_text=library_vars.describe(catalog, focus=focus),
        existing_rules=[ai_derivation.describe_rule(r) for r in rules],
        refs_text=refs.describe(),
    )
    try:
        answer = await _ask(
            cfg, first=first, turns=turns, instruction=instruction,
            system=ai_derivation.SYSTEM_PROMPT,
            schema=ai_derivation.SCHEMA, schema_name="derivation_rules", temperature=0.3,
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    try:
        result = ai_derivation.compile_rules(
            answer, catalog=catalog,
            taken_ids={r["id"] for r in rules if isinstance(r.get("id"), str)}, refs=refs,
        )
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    result["model"] = cfg["model"]
    result["answer"] = answer
    return json_ok(result)


_TEXT_KINDS = {
    "fixed_values": (text_items.FIXED_SYSTEM, text_items.FIXED_SCHEMA, "fixed_values"),
    "combine": (text_items.COMBINE_SYSTEM, text_items.COMBINE_SCHEMA, "combine"),
    "template": (text_items.TEMPLATE_SYSTEM, text_items.TEMPLATE_SCHEMA, "prompt_template"),
}


async def post_text_draft(request: web.Request) -> web.Response:
    """Body: {kind: "fixed_values"|"combine"|"template", instruction,
    history?, item: {id?, name, description?, tags?, payload? (fixed values,
    combine), template_string?, negative_template? (template)}}.

    The editor panels for fixed values, combines and prompt templates. The
    answer is compiled against the editor's item as it stands: fixed values
    come back as the whole value list (a name that exists is rewritten in
    place), a combine or template as its new text.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    kind = body.get("kind")
    if kind not in _TEXT_KINDS:
        return json_error("kind must be fixed_values, combine or template", status=400)
    instruction = _instruction(body, "say what to write")
    if isinstance(instruction, web.Response):
        return instruction
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    item = body.get("item") if isinstance(body.get("item"), dict) else {}
    payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
    name = item.get("name") if isinstance(item.get("name"), str) else ""
    out_var = ""
    if kind == "fixed_values":
        current = "\n".join(
            f"${v.get('name')} = {v.get('value')}"
            + (f"  (negative: {v['negative']})" if v.get("negative") else "")
            for v in payload.get("values") or [] if isinstance(v, dict))
    elif kind == "combine":
        out_var = payload.get("output_var") if isinstance(payload.get("output_var"), str) else ""
        out_var = out_var.strip().lstrip("$")
        if not out_var:
            return json_error("name the variable the combine sets first", status=400)
        current = str(payload.get("template") or "")
        if payload.get("negative"):
            current += f"\nNegative: {payload['negative']}"
    else:
        current = str(item.get("template_string") or "")
        if item.get("negative_template"):
            current += f"\nNegative: {item['negative_template']}"

    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
    item_id = item.get("id") if isinstance(item.get("id"), str) else None
    catalog = library_vars.build_catalog([m for m in modules if m.get("id") != item_id])
    description, labels = ai_about.clean(item.get("description"), item.get("tags"))
    first = text_items.build_prompt(
        kind=kind, instruction=ai_followup.first_instruction(turns, instruction),
        name=name[:200], catalog_text=library_vars.describe(catalog), description=description,
        labels=labels, current=current[:4000], out_var=out_var,
    )
    system, schema, schema_name = _TEXT_KINDS[kind]
    try:
        answer = await _ask(cfg, first=first, turns=turns, instruction=instruction,
                            system=system, schema=schema, schema_name=schema_name,
                            temperature=0.5)
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    try:
        if kind == "fixed_values":
            result = text_items.compile_fixed(answer, existing=payload)
        elif kind == "combine":
            result = text_items.compile_combine(answer, out_var=out_var, catalog=catalog,
                                                existing=payload)
        else:
            result = text_items.compile_template(answer, catalog=catalog)
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    result["model"] = cfg["model"]
    result["answer"] = answer
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
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
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
    description, labels = ai_about.clean(cons.get("description"), cons.get("tags"))
    cname = cons.get("name") if isinstance(cons.get("name"), str) else ""
    first = ai_constraint.build_prompt(
        instruction=ai_followup.first_instruction(turns, instruction), source=source, target=target,
        name=cname[:200], description=description, labels=labels,
        existing=ai_constraint.describe_existing(existing),
    )
    try:
        answer = await _ask(
            cfg, first=first, turns=turns, instruction=instruction,
            system=ai_constraint.SYSTEM_PROMPT,
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
    result["answer"] = answer
    return json_ok(result)


async def post_describe(request: web.Request) -> web.Response:
    """Body: {kind, name?, description?, tags?, payload, hint?}.

    `payload` is what the editor holds now (a module payload, a bundle's
    children, a template's text). The model also sees the library's tags so
    it reuses them.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    kind = body.get("kind")
    if kind not in ai_describe.KINDS:
        return json_error("unknown kind", status=400)
    name = body.get("name") if isinstance(body.get("name"), str) else ""
    description, tags = ai_about.clean(body.get("description"), body.get("tags"))
    hint = body.get("hint") if isinstance(body.get("hint"), str) else ""
    if len(hint) > ai_wildcard.MAX_INSTRUCTION_LEN:
        return json_error("that request is too long", status=400)
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns

    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
        bundles = BundleRepository(conn).list()
    names = {m["id"]: m.get("name") or "" for m in modules if isinstance(m.get("id"), str)}
    library = ai_describe.library_tags([*modules, *bundles])
    first = ai_describe.build_prompt(
        kind=kind, name=name[:200], description=description, tags=tags,
        summary=ai_describe.summarize(kind, body.get("payload"), names=names),
        library=library, hint=ai_followup.first_instruction(turns, hint),
    )
    try:
        answer = await _ask(
            cfg, first=first, turns=turns, instruction=hint,
            system=ai_describe.SYSTEM_PROMPT,
            schema=ai_describe.SCHEMA, schema_name="describe", temperature=0.4,
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    try:
        result = ai_describe.compile_answer(answer, current=tags, library=library)
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    result["model"] = cfg["model"]
    result["answer"] = answer
    return json_ok(result)


async def post_organize(request: web.Request) -> web.Response:
    """Body: {items: [{kind: "module"|"bundle", id}], hint?, history?}.

    The items are read from the library, so the model sees what is saved.
    Changes come back keyed by kind + id for the manager to review.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    hint = body.get("instruction") if isinstance(body.get("instruction"), str) else ""
    if len(hint) > ai_wildcard.MAX_INSTRUCTION_LEN:
        return json_error("that request is too long", status=400)
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    wanted = body.get("items") if isinstance(body.get("items"), list) else []
    refs: list[tuple[str, str]] = []
    for w in wanted:
        if isinstance(w, dict) and w.get("kind") in ("module", "bundle") \
                and isinstance(w.get("id"), str) and (w["kind"], w["id"]) not in refs:
            refs.append((w["kind"], w["id"]))
    if not refs:
        return json_error("select some modules or bundles first", status=400)
    if len(refs) > ai_organize.MAX_ITEMS:
        return json_error(
            f"that's {len(refs)} items; select up to {ai_organize.MAX_ITEMS} and try again",
            status=400,
        )

    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
        bundles = BundleRepository(conn).list()
        cats = CategoryRepository(conn).list()
    by_ref = {("module", m["id"]): m for m in modules}
    by_ref.update({("bundle", b["id"]): b for b in bundles})
    cat_names = {c["id"]: c["name"] for c in cats}
    names = {m["id"]: m.get("name") or "" for m in modules if isinstance(m.get("id"), str)}
    items: list[dict[str, Any]] = []
    real: dict[str, tuple[str, str]] = {}
    for ref in refs:
        row = by_ref.get(ref)
        if row is None:
            continue
        short = str(len(items) + 1)
        real[short] = ref
        items.append(ai_organize.item_view(
            row, ref[0], short, category=cat_names.get(row.get("category_id") or "", ""),
            names=names,
        ))
    if not items:
        return json_error("none of those items are in the library any more", status=404)
    categories = ai_organize.library_categories(cats)
    library = ai_describe.library_tags([*modules, *bundles])
    first = ai_organize.build_prompt(
        items=items, categories=categories, library=library,
        hint=ai_followup.first_instruction(turns, hint),
    )
    try:
        answer = await _ask(
            cfg, first=first, turns=turns, instruction=hint,
            system=ai_organize.SYSTEM_PROMPT, schema=ai_organize.SCHEMA,
            schema_name="organize", temperature=0.3,
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    try:
        result = ai_organize.compile_answer(
            answer, items=items, categories=categories, library=library,
        )
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    cat_ids = {c["name"].lower(): c["id"] for c in cats}
    by_short = {it["id"]: it for it in items}
    for c in result["changes"]:
        it = by_short[c["id"]]
        c["kind"], c["id"] = real[c.pop("id")]
        c["name"] = it["name"]
        c["type"] = it["type"]
        c["before"] = {"category": it["category"], "tags": it["tags"], "rating": it["rating"]}
        if c["category"]:
            c["category"]["id"] = cat_ids.get(c["category"]["name"].lower())
    result["count"] = len(items)
    result["model"] = cfg["model"]
    result["answer"] = answer
    return json_ok(result)


def _results_tail(question: str, *, last: bool, native: bool) -> str:
    """What follows a step's results. The user's question goes with them:
    once a step's results are the newest message, small models forget what
    was asked and answer with a greeting."""
    asked = f"\n\nThe user's message you are answering: \"{ai_budget.clip(question, 600)}\"" \
        if question else ""
    done = ("answer in plain text without calling a tool" if native
            else "answer with \"calls\": [] and a message")
    if last:
        tail = (f"\n\nNo more tool calls. Answer the user's message now from these results: "
                f"{done} that gives the actual answer.")
    else:
        tail = (f"\n\nIf these results answer the user's message, {done} that gives the "
                "actual answer. Otherwise make the next calls. Never repeat a call you already "
                "made.")
    return asked + tail


async def _chat_step(
    cfg: dict[str, Any], *, system: str, log: list[dict[str, Any]], fmt: str,
    names: list[str], prof: dict[str, Any], num_ctx: int, cache_key: str,
) -> dict[str, Any]:
    """One model step, asked again once with the problem named when a
    JSON-mode answer isn't usable: small models usually fix a named error."""
    chosen = ai_tools.tools(names)
    native = ai_tools.native(chosen, cfg["api"])
    schema = ai_tools.step_schema(names)
    problem = ""
    for attempt in range(2):
        asked = log if not problem else [*log, {"role": "user", "content": (
            f"Your last answer couldn't be used ({problem}). Answer again with only the "
            "JSON object: plan, message, calls.")}]
        try:
            return await _ai_chat.step(
                cfg, system=system, log=asked, fmt=fmt, tools=native, names=names,
                schema=schema, temperature=prof["chat_temp"], num_ctx=num_ctx,
                cache_key=cache_key,
            )
        except _ai_chat.ToolsUnsupported:
            raise
        except _ai_client.AIError as e:
            if attempt or fmt != "json" or "JSON" not in e.message:
                raise
            problem = "it wasn't valid JSON"
        except ValueError as e:
            if attempt:
                raise _ai_client.AIError(
                    f"the model's answer couldn't be used ({e}). Try again, or a larger "
                    "model.") from e
            problem = str(e)
    raise _ai_client.AIError("the model's answer couldn't be used")


def _final_step(fmt: str, message: str) -> dict[str, Any]:
    """The reply the user saw, as a step that calls nothing, when the model's
    last step called tools: the turn must end on an answer so the next one
    reads like a conversation (and strict chat templates accept it)."""
    answer = {"calls": [], "message": message, "plan": ""} if fmt == "json" else None
    return ai_chatlog.step_entry(ai_chatlog.dumps(answer) if answer else message, [],
                                 answer=answer, synthetic=True)


def _more_tools(meta: dict[str, Any]) -> str:
    offered = set(meta.get("tools") or [])
    rest = [t for t in ai_tools.TOOLS if t.name not in offered]
    if not rest:
        return "every tool is already available"
    meta["tools"] = [t.name for t in ai_tools.TOOLS if t.name in offered or t in rest]
    return ("These tools are available now:\n" + ai_tools.prompt_lines(rest, "read")
            + "\n" + ai_tools.prompt_lines(rest, "change")).strip()


#: One library index per library database file (see `engine.ai.index`).
_INDEXES: dict[str, ai_index.Index | None] = {}
#: Ids and docs sections a chat remembers having handed the model.
MAX_SHOWN = 400


def _synced_index(conn: Any, lib: ai_chat.Library) -> ai_index.Index | None:
    """The library index, brought up to date with the saved rows; None when
    SQLite has no FTS5 or the index can't be used (search then scores rows
    in Python, as before)."""
    idx = _library_index_for(conn)
    if idx is None:
        return None
    key = str(ai_index.index_path(ai_index.library_path(conn)) or "")
    rows = [*lib.modules.values(), *lib.bundles.values(), *lib.templates.values()]
    try:
        idx.sync(rows, lib._kind)
    except sqlite3.Error:
        _INDEXES.pop(key, None)
        return None
    return idx


async def _query_vector(lib: ai_chat.Library, cfg: dict[str, Any],
                        text: str) -> list[float] | None:
    """The query's vector when meaning search is on and some items have
    vectors already; else None (keywords only)."""
    if lib.index is None or not lib.embed_model:
        return None
    try:
        if lib.index.vector_count(lib.embed_model) == 0:
            return None
    except sqlite3.Error:
        return None
    return await _ai_embed.query_vector(cfg, text)


def _library_index_for(conn: Any) -> ai_index.Index | None:
    path = ai_index.index_path(ai_index.library_path(conn))
    key = str(path or "")
    if key not in _INDEXES:
        _INDEXES[key] = ai_index.open_index(path)
    return _INDEXES[key]


async def _retrieval(lib: ai_chat.Library, text: str, meta: dict[str, Any],
                     prof: dict[str, Any], cfg: dict[str, Any]) -> str:
    """What the library index and the docs say this message is about, for
    the end of the message (never the system prompt: the request prefix
    stays the same). Gated; items and sections this chat already got are
    left out. Large models get names only: they search well, and every
    token here is paid on every later request of a cloud chat."""
    shown = set(meta.get("shown") or [])
    parts: list[str] = []
    new: list[str] = []
    if lib.index is not None:
        skip = shown | ({lib.editor_id} if lib.editor_id else set())
        qvec = await _query_vector(lib, cfg, text)
        try:
            block, ids = ai_index.retrieve(lib.index, text, seen=skip,
                                           limit=4 if prof["slim"] else 6,
                                           full=prof["size"] != "large",
                                           qvec=qvec, model=lib.embed_model)
        except sqlite3.Error:
            block, ids = "", []
        if block:
            parts.append(block)
            new.extend(ids)
    dblock, keys = ai_docs.retrieve(text, seen={k[4:] for k in shown if k.startswith("doc:")})
    if dblock:
        parts.append("Docs sections that may answer this (docs_read them before answering):\n"
                     + dblock)
        new.extend("doc:" + k for k in keys)
    if new:
        meta["shown"] = [*(meta.get("shown") or []), *new][-MAX_SHOWN:]
    return "\n\n".join(parts)


def _index_status(idx: ai_index.Index | None, cfg: dict[str, Any]) -> dict[str, Any]:
    model = cfg.get("embed_model") if _ai_embed.enabled(cfg) else ""
    if idx is None:
        return {"available": False, "items": 0, "embed_model": model or None,
                "vectors": 0, "filling": False}
    return {"available": True, "items": idx.count(), "embed_model": model or None,
            "vectors": idx.vector_count(model) if model else 0,
            "filling": _ai_embed.filling(idx)}


def _index_sync(request: web.Request) -> ai_index.Index | None:
    with db_session(request) as conn:
        lib = ai_chat.Library(
            ModuleRepository(conn).list(), BundleRepository(conn).list(),
            CategoryRepository(conn).list(), TemplateRepository(conn).list(),
        )
        return _synced_index(conn, lib)


async def get_index(request: web.Request) -> web.Response:
    """The chat's library index: how many items it holds and, with meaning
    search on, how many have vectors. Brings it up to date first."""
    cfg = ai_config.load_effective()
    idx = _index_sync(request)
    if idx is not None and cfg.get("enabled"):
        _ai_embed.fill_in_background(cfg, idx)
    return json_ok(_index_status(idx, cfg))


async def post_index_rebuild(request: web.Request) -> web.Response:
    """Throw the index away and build it again (vectors too)."""
    cfg = ai_config.load_effective()
    with db_session(request) as conn:
        idx = _library_index_for(conn)
    if idx is None:
        return json_error("this Python's SQLite has no full-text search (FTS5); "
                          "the chat searches without an index", status=409)
    if _ai_embed.filling(idx):
        return json_error("the library is being embedded; try again when it's done", status=409)
    idx.clear()
    idx = _index_sync(request)
    if idx is not None and cfg.get("enabled"):
        _ai_embed.fill_in_background(cfg, idx)
    return json_ok(_index_status(idx, cfg))


async def post_chat(request: web.Request) -> web.Response:
    """Body: {message, chat_id?, page?: {route, id?, doc?, note?, editor?},
    events?: [{pid, status}]}.

    The server keeps the chat (`ai_chats`), so the browser sends only the new
    message; without a `chat_id` (or with one that's gone) a new chat starts.
    `events` say what the user did with earlier proposal cards (applied,
    undone, dismissed, …). `editor` is the open editor's item as it stands,
    unsaved changes included; the chat reads and changes that version.

    Runs up to `chat.MAX_STEPS` model steps. Read tools run here and their
    results go back to the model; change tools become proposals the manager
    shows as cards. Nothing is written to the library. The turn is stored
    only once it finishes, so a failed turn leaves the chat as it was.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    text = body.get("message")
    if not isinstance(text, str) or not text.strip():
        return json_error("say something first", status=400)
    text = text.strip()
    if len(text) > ai_chat.MAX_TURN_CHARS:
        text = text[:ai_chat.MAX_TURN_CHARS] + " …"
    page = body.get("page") if isinstance(body.get("page"), dict) else None
    chat_id = body.get("chat_id") if isinstance(body.get("chat_id"), str) else None

    with db_session(request) as conn:
        lib = ai_chat.Library(
            ModuleRepository(conn).list(), BundleRepository(conn).list(),
            CategoryRepository(conn).list(), TemplateRepository(conn).list(),
        )
        lib.index = _synced_index(conn, lib)
        chat: dict[str, Any] | None = None
        log: list[dict[str, Any]] = []
        if chat_id:
            try:
                chat = ChatRepository(conn).get(chat_id)
                log = ChatRepository(conn).messages(chat_id)
            except ChatNotFound:
                chat = None
    if sum(1 for e in log if e.get("kind") == "user") >= ai_chat.MAX_TURNS:
        return json_error("this chat is long; start a new one to keep it focused", status=400)
    if lib.index is not None and _ai_embed.enabled(cfg):
        lib.embed_model = cfg["embed_model"]
        _ai_embed.fill_in_background(cfg, lib.index)
    prof = ai_budget.profile(cfg)
    rows = [*lib.modules.values(), *lib.bundles.values(), *lib.templates.values()]
    fp_now = ai_chatlog.fingerprint(rows, lib._kind)
    if chat is None:
        fmt = await _ai_chat.pick_format(cfg)
        meta: dict[str, Any] = {
            "format": fmt, "proposals": {}, "fingerprint": {},
            "tools": ai_tools.toolset(page.get("route") if page else None, scoped=prof["slim"]),
        }
        snapshot = lib.overview(limit=40 if prof["slim"] else None)
    else:
        meta = dict(chat["meta"])
        snapshot = chat["snapshot"]
        fmt = meta.get("format") if meta.get("format") in ("native", "json") else "json"
        if cfg.get("tool_format") in ("native", "json") and cfg["tool_format"] != fmt \
                and not any(e.get("kind") == "step" for e in log):
            fmt = cfg["tool_format"]
    if page:
        lib.use_editor(page.get("editor"))
    meta, since = ai_chatlog.apply_events(meta, body.get("events"))
    changes = ai_chatlog.library_changes(meta.get("fingerprint") or {}, fp_now)
    note = lib.page_note(page)
    if note and note == meta.get("page_note"):
        note = ""  # still on the same page: it is in the history already
    elif note:
        meta["page_note"] = note
    hints = await _retrieval(lib, text, meta, prof, cfg)
    sent = "\n\n".join(x for x in (since, changes, text, note, hints) if x)
    new: list[dict[str, Any]] = [ai_chatlog.user_entry(text, sent)]

    num_ctx = int(cfg.get("context_max") or ai_budget.CONTEXT_DEFAULT)
    cache_key = chat["id"] if chat else ""
    pids = [int(p[1:]) for p in meta.get("proposals") or {} if p[1:].isdigit()]
    lib._next_pid = max(pids, default=0)
    proposals: list[dict[str, Any]] = []
    steps: list[dict[str, Any]] = []
    message = ""
    interim = ""
    seen: set[str] = set()
    errors: dict[str, int] = {}
    forced = False
    checked = False
    nudged = False
    last_answer = ai_chatlog.last_reply(log)
    usage: dict[str, Any] = {}

    def system_for() -> str:
        return ai_chat.system_prompt(
            slim=prof["slim"], native=fmt == "native", tools=meta["tools"],
        ) + "\n\n" + snapshot

    step = 0
    while step < ai_chat.MAX_STEPS:
        meta = ai_chatlog.fit(log + new, meta, prof["history_chars"])
        rendered = ai_chatlog.render(log + new, meta)
        try:
            st = await _chat_step(cfg, system=system_for(), log=rendered, fmt=fmt,
                                  names=meta["tools"], prof=prof, num_ctx=num_ctx,
                                  cache_key=cache_key)
        except _ai_chat.ToolsUnsupported as e:
            if fmt == "native" and not any(x.get("kind") == "step" for x in log + new):
                fmt = "json"  # the server has no tool calling: use the JSON format
                continue
            if not steps:
                return json_error(e.message, status=e.status)
            message = f"(Stopped early: {e.message})"
            break
        except _ai_client.AIError as e:
            if not steps and not any(x.get("kind") == "step" for x in new):
                return json_error(e.message, status=e.status)
            message = f"(Stopped early: {e.message})"
            break
        step += 1
        usage = st["usage"]
        said = st["message"][:ai_chat.MAX_MESSAGE]
        calls = st["calls"][:ai_chat.MAX_CALLS_PER_STEP]
        new.append(ai_chatlog.step_entry(st["text"], calls, answer=st["answer"], usage=usage))
        # A message sent along with calls is usually "I'll search…": keep it
        # only as a fallback, so the answer is the step that stops calling.
        if said and not calls:
            message = said
        elif said:
            interim = said
        if forced and calls:
            # Told to answer and called again anyway: stop on what it said.
            message = message or (
                "I kept looking without getting to an answer. Try asking more specifically, "
                "or name the item.")
            break
        if any(c["tool"] == "run_test" for c in calls):
            checked = True
        items: list[dict[str, Any]] = []
        needs_reply = False
        repeats = 0
        for call in calls:
            tool = call["tool"]

            def result(out: str, call: dict[str, Any] = call,
                       items: list[dict[str, Any]] = items) -> None:
                items.append({"id": call["id"], "tool": call["tool"], "text": out})

            spec = ai_tools.BY_NAME.get(tool)
            if spec is None:
                needs_reply = True
                result(f"{tool}: error: there is no tool named {tool[:40]}")
                steps.append({"tool": "unknown", "note": f"Unknown tool {tool[:40]}",
                              "ok": False})
                continue
            try:
                raw = call["args"] if isinstance(call.get("args"), dict) else call["args_text"]
                args, arg_notes = ai_tools.check_args(spec, ai_chat.parse_args(raw))
                key = tool + _json.dumps(args, sort_keys=True, ensure_ascii=False)
                if tool not in ai_chat.CHANGE_TOOLS and key in seen:
                    # Small models re-run the same search every step.
                    repeats += 1
                    needs_reply = True
                    result(f"{tool}: you already made this exact call; its results are above. "
                           "Don't repeat it.")
                    continue
                seen.add(key)
                if errors.get(tool, 0) >= 3:
                    raise ValueError("this tool failed three times in this answer; stop "
                                     "calling it and tell the user what went wrong")
                if tool in ai_chat.CHANGE_TOOLS and len(proposals) >= ai_chat.MAX_PROPOSALS:
                    raise ValueError("too many changes in one answer; stop here")
                if tool == "more_tools":
                    out: Any = _more_tools(meta)
                else:
                    if tool == "search":
                        lib.qvec = await _query_vector(lib, cfg, str(args.get("query") or ""))
                    out = lib.run(tool, args)
            except ValueError as e:
                errors[tool] = errors.get(tool, 0) + 1
                needs_reply = True
                result(f"{tool}: error: {e}")
                steps.append({"tool": tool, "note": f"{tool}: {e}", "ok": False})
                continue
            extra = ("\n(" + "; ".join(arg_notes) + ")") if arg_notes else ""
            if isinstance(out, str):
                needs_reply = True
                result(f"{tool} {_json.dumps(args, ensure_ascii=False, sort_keys=True)[:200]}:\n"
                       + ai_budget.clip(out, prof["result_chars"]) + extra)
                steps.append({"tool": tool, "note": ai_chat.args_note(tool, args, lib),
                              "ok": True})
            else:
                proposals.append(out)
                meta.setdefault("proposals", {})[out["pid"]] = {
                    "title": out["title"], "status": None}
                result(f"{tool}: proposal {out['pid']} shown to the user: {out['title']}"
                       + extra)
                steps.append({"tool": tool, "note": out["title"], "ok": True})
        if not needs_reply:
            # Asked leave instead of proposing, or met "yes" with more talk:
            # tell it once to act. Small models loop on "Should I proceed?".
            if (not calls and not proposals and not nudged
                    and step < ai_chat.MAX_STEPS
                    and ai_chat.stalls(said, text, last_answer)):
                nudged = True
                message = ""  # the stalled question isn't the answer
                new.append(ai_chatlog.note_entry(ai_chat.GO_NUDGE))
                continue
            # Changes were proposed but never tried: ask for one check
            # before the answer stands, so "done" means it ran.
            if (not checked and step < ai_chat.MAX_STEPS
                    and any(p["tool"] in ai_chat.CHECKABLE_TOOLS for p in proposals)):
                checked = True
                tail = "\n\n" + ai_chat.CHECK_NUDGE
                if items:
                    new.append(ai_chatlog.results_entry(items, tail))
                else:
                    new.append(ai_chatlog.note_entry(ai_chat.CHECK_NUDGE))
                continue
            if items:
                new.append(ai_chatlog.results_entry(items, ""))
            break
        if step >= ai_chat.MAX_STEPS:
            new.append(ai_chatlog.results_entry(items, ""))
            message = (message or interim
                       or "I ran out of steps before finishing; ask me to continue.")
            break
        # Only repeats, or one step left: no more tools, answer now.
        forced = bool(calls and repeats == len(calls)) or step == ai_chat.MAX_STEPS - 1
        new.append(ai_chatlog.results_entry(
            items, _results_tail(text, last=forced, native=fmt == "native")))

    if not message:
        message = interim if interim and proposals else (
            "Here's what I'd change." if proposals else interim or "Done.")
    # Every call gets a result and the turn ends on an answer.
    last = new[-1]
    if last.get("kind") == "step" and last.get("calls"):
        new.append(ai_chatlog.results_entry(
            [{"id": c["id"], "tool": c["tool"], "text": f"{c['tool']}: not run"}
             for c in last["calls"]], ""))
    if new[-1].get("kind") != "step":
        new.append(_final_step(fmt, message))
    meta["format"] = fmt
    meta["fingerprint"] = fp_now
    meta["model"] = cfg.get("model")
    with db_session(request) as conn:
        repo = ChatRepository(conn)
        if chat is None:
            chat = repo.create(title=ai_chatlog.title_for(text), snapshot=snapshot, meta=meta)
        repo.append(chat["id"], new, meta=meta)
    return json_ok({
        "chat_id": chat["id"], "message": message, "proposals": proposals, "steps": steps,
        "model": cfg["model"], "format": fmt, "usage": usage,
        "refs": lib.message_refs(message),
    })


def _pack_body(
    body: dict[str, Any], library: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]] | web.Response:
    """The plan and built items the manager sends back, checked again."""
    try:
        plan = ai_pack.compile_plan(body.get("plan"), library=library)
    except ai_pack.PlanError as e:
        return json_error(f"the plan can't be used: {e}", status=400)
    return plan, ai_pack.parse_built(plan, body.get("built"))


async def post_pack_plan(request: web.Request) -> web.Response:
    """Body: {instruction, history?}. An outline of the pack: title, up to
    three questions and the items to build. Nothing is built yet."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    instruction = _instruction(body, "describe the pack first")
    if isinstance(instruction, web.Response):
        return instruction
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    sample = body.get("sample") if isinstance(body.get("sample"), str) else ""
    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
        lib_note = ai_patterns.note(ai_patterns.summarize(
            modules, BundleRepository(conn).list(), TemplateRepository(conn).list()))
    library = [m for m in modules if m.get("type") == "wildcard"]
    first = ai_pack.plan_prompt(ai_followup.first_instruction(turns, instruction),
                                library_note=lib_note, sample=sample)
    try:
        answer = await _ask(
            cfg, first=first, turns=turns, instruction=instruction,
            system=ai_pack.PLAN_SYSTEM, schema=ai_pack.PLAN_SCHEMA,
            schema_name="pack_plan", temperature=0.4,
        )
        plan = ai_pack.compile_plan(answer, library=library)
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    except ai_pack.PlanError as e:
        return json_error(
            f"the model's plan couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    return json_ok({"plan": plan, "model": cfg["model"], "answer": answer,
                    "review": ai_pack.review_plan(plan)})


async def post_pack_review(request: web.Request) -> web.Response:
    """Body: {plan, ai?}. The plan checked against the guide before it is
    built; with ``ai`` the model reviews it too. Returns {findings, note}."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    parsed = _pack_body(body, _wildcards(request))
    if isinstance(parsed, web.Response):
        return parsed
    plan, _built = parsed
    findings = ai_pack.review_plan(plan)
    if body.get("ai") is True:
        try:
            answer = await _ai_client.complete_json(
                cfg, system=ai_pack.REVIEW_SYSTEM, user=ai_pack.review_prompt(plan, findings),
                schema=ai_pack.REVIEW_SCHEMA, schema_name="pack_review", temperature=0.3,
            )
        except _ai_client.AIError as e:
            return json_error(e.message, status=e.status)
        findings += ai_pack.compile_review(answer, plan)
    return json_ok({"findings": findings, "note": ai_pack.review_note(findings)})


async def post_pack_item(request: web.Request) -> web.Response:
    """Body: {plan, built, key, note?}. Builds one item with the model.
    A rebuild keeps the item's id, so constraints keep pointing at it."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    library = _wildcards(request)
    parsed = _pack_body(body, library)
    if isinstance(parsed, web.Response):
        return parsed
    plan, built = parsed
    key = body.get("key")
    note = body.get("note") if isinstance(body.get("note"), str) else ""
    if not isinstance(key, str) or key not in {i["key"] for i in plan["items"]}:
        return json_error("no such item in the plan", status=400)
    if next(i for i in plan["items"] if i["key"] == key)["kind"] == "library":
        try:
            out = ai_pack.library_item(plan, key, library)
        except ai_pack.PlanError as e:
            return json_error(str(e), status=400)
        return json_ok({**out, "repair": "", "model": cfg["model"]})
    try:
        req = ai_pack.item_request(plan, key, built, note[:1500], library=library)
    except ai_pack.PlanError as e:
        return json_error(str(e), status=400)
    try:
        answer = await _ai_client.complete_json(cfg, **req)
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    old = built.get(key)
    try:
        out = ai_pack.compile_item(
            plan, key, built, answer, taken={b["id"] for b in built.values()},
            item_id=old["id"] if old else "", library=library,
        )
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    out["model"] = cfg["model"]
    return json_ok(out)


async def post_pack_check(request: web.Request) -> web.Response:
    """Body: {plan, built}. Runs the pack on the engine; no model call."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    library = _wildcards(request)
    parsed = _pack_body(body, library)
    if isinstance(parsed, web.Response):
        return parsed
    plan, built = parsed
    if not built:
        return json_error("nothing is built yet", status=400)
    loop = asyncio.get_running_loop()
    report = await loop.run_in_executor(
        None, lambda: ai_pack.check_pack(plan, built, library=library))
    return json_ok(report)


async def post_pack_install(request: web.Request) -> web.Response:
    """Body: {plan, built}. One import commit: the modules, the template and
    a bundle, tagged as one collection. Returns the import's undo id."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    parsed = _pack_body(body, _wildcards(request))
    if isinstance(parsed, web.Response):
        return parsed
    plan, built = parsed
    if not any(i["key"] in built for i in plan["items"] if i["kind"] != "template"):
        return json_error("nothing is built yet", status=400)
    for i in plan["items"]:
        if i["kind"] == "wildcard" and i["key"] in built:
            err = validate_wildcard_name(i["name"])
            if err is not None:
                return json_error(f"{i['name']}: {err}", status=400)
    with db_session(request) as conn:
        def ids(table: str) -> set[str]:
            return {r[0] for r in conn.execute(f"SELECT id FROM {table};")}  # noqa: S608
        ops = ai_pack.install_ops(
            plan, built, taken=ids("modules") | ids("bundles"),
            template_ids=ids("templates"), bundle_ids=ids("bundles"),
        )
        result = commit_import(conn, {"adds": ops["adds"]})
    if not result.get("ok"):
        return json_error(result.get("error", "install failed"), status=400)
    return json_ok({
        "undo_entry_id": result["undo_id"], "ids": ops["ids"],
        "bundle_id": ops["bundle_id"], "template_id": ops["template_id"], "tag": ops["tag"],
        "notes": ops["notes"],
    })


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/ai/config", get_config)
    router.add_get("/wp/api/ai/index", get_index)
    router.add_post("/wp/api/ai/index/rebuild", post_index_rebuild)
    router.add_put("/wp/api/ai/config", put_config)
    router.add_post("/wp/api/ai/models", cancel_on_disconnect(post_models))
    router.add_post("/wp/api/ai/test", cancel_on_disconnect(post_test))
    router.add_post("/wp/api/ai/wildcard/draft", cancel_on_disconnect(post_wildcard_draft))
    router.add_post("/wp/api/ai/pack/review", cancel_on_disconnect(post_pack_review))
    router.add_post("/wp/api/ai/wildcard/edit", cancel_on_disconnect(post_wildcard_edit))
    router.add_post("/wp/api/ai/derivation/draft", cancel_on_disconnect(post_derivation_draft))
    router.add_post("/wp/api/ai/constraint/draft", cancel_on_disconnect(post_constraint_draft))
    router.add_post("/wp/api/ai/text/draft", cancel_on_disconnect(post_text_draft))
    router.add_post("/wp/api/ai/describe", cancel_on_disconnect(post_describe))
    router.add_post("/wp/api/ai/organize", cancel_on_disconnect(post_organize))
    router.add_post("/wp/api/ai/chat", cancel_on_disconnect(post_chat))
    router.add_post("/wp/api/ai/pack/plan", cancel_on_disconnect(post_pack_plan))
    router.add_post("/wp/api/ai/pack/item", cancel_on_disconnect(post_pack_item))
    router.add_post("/wp/api/ai/pack/check", cancel_on_disconnect(post_pack_check))
    router.add_post("/wp/api/ai/pack/install", post_pack_install)  # writes; never cut short
