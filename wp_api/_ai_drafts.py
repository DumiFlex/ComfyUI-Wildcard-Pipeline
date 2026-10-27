"""Editor panels: wildcard draft + edit, derivation, text and constraint
drafts, describe and organize. Nothing here writes to the library."""
from __future__ import annotations

from typing import Any

from aiohttp import web

from engine.ai import about as ai_about
from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import describe as ai_describe
from engine.ai import followup as ai_followup
from engine.ai import lang as ai_lang
from engine.ai import library_vars, text_items
from engine.ai import organize as ai_organize
from engine.ai import refs as ai_refs
from engine.ai import wildcard as ai_wildcard
from engine.ai import wildcard_edit as ai_edit
from engine.db.repositories import (
    BundleRepository,
    CategoryRepository,
    ModuleNotFound,
    ModuleRepository,
    TemplateRepository,
)
from wp_api import (
    _ai_client,
    _ai_lang,
)
from wp_api._ai_common import (
    _MAX_IMAGE_BODY_BYTES,
    _ask,
    _body,
    _enabled_cfg,
    _instruction,
    _ref_index,
    _request_images,
    _str_list,
    _turns,
    _Web,
    _wildcards,
)
from wp_api._helpers import db_session, json_error, json_ok


async def post_wildcard_draft(request: web.Request) -> web.Response:
    """Body: {instruction, count?, wildcard: {name?, var_binding?, payload}}.

    `payload` is the editor's current draft (options, sub_categories,
    tag_groups), so the model sees unsaved edits too.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request, limit=_MAX_IMAGE_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    images = await _request_images(cfg, body)
    if isinstance(images, web.Response):
        return images
    webs = _Web(cfg, body)

    instruction = body.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        return json_error("say what to add", status=400)
    if len(instruction) > ai_wildcard.MAX_INSTRUCTION_LEN:
        return json_error("that request is too long", status=400)
    count = body.get("count", 10)
    if isinstance(count, bool) or not isinstance(count, int):
        return json_error("count must be a whole number", status=400)
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    # A request in another language: the checks read its English
    # restatement, and with `count_auto` (the panel's How many box is
    # neither set by hand nor read from English words) its count.
    frame = await _ai_lang.frame(cfg, ai_followup.first_instruction(turns, instruction))
    if body.get("count_auto") is True and not turns and ai_lang.count(frame):
        count = ai_lang.count(frame)
    count = max(1, min(ai_wildcard.MAX_COUNT, count))
    check = ai_lang.check_text(frame, ai_followup.first_instruction(turns, instruction))
    # A few more than wanted: some come back as repeats of the list (or of
    # each other) and are dropped, and "3 options" should still land 3.
    asked = ai_wildcard.over_ask(count)

    wc = _got if isinstance(_got := body.get("wildcard"), dict) else {}
    payload = _got if isinstance(_got := wc.get("payload"), dict) else {}
    options = _got if isinstance(_got := payload.get("options"), list) else []
    existing_texts = [
        o["value"].strip() for o in options
        if isinstance(o, dict) and isinstance(o.get("value"), str) and o["value"].strip()
    ][:5000]
    tags = _str_list(payload.get("sub_categories"), limit=500)
    raw_groups = _got if isinstance(_got := payload.get("tag_groups"), dict) else {}
    axes = {
        str(k): _str_list(v, limit=200) for k, v in list(raw_groups.items())[:50]
    }
    raw_kinds = payload.get("tag_group_kinds") \
        if isinstance(payload.get("tag_group_kinds"), dict) else {}
    kinds = {str(k): "accepts" for k, v in raw_kinds.items() if v == "accepts" and k in axes}
    name = _got if isinstance(_got := wc.get("name"), str) else ""
    var = _got if isinstance(_got := wc.get("var_binding"), str) else ""

    description, labels = ai_about.clean(wc.get("description"), wc.get("tags"))
    self_id = _got if isinstance(_got := wc.get("id"), str) else None
    refs = _ref_index(_wildcards(request), self_id, payload, name)
    existing_texts = [ai_refs.display_text(t, refs) for t in existing_texts]
    # Each with its tags, so the model tags new options the same way
    # instead of inventing its own scheme (bench W3: three runs, three).
    tagged = [
        _str_list(o.get("sub_categories"), limit=20) for o in options
        if isinstance(o, dict) and isinstance(o.get("value"), str) and o["value"].strip()
    ][:5000]
    existing_texts = [t + (f"  [tags {', '.join(g)}]" if g else "")
                      for t, g in zip(existing_texts, tagged, strict=True)]
    first = ai_wildcard.build_user_prompt(kinds=kinds,
        instruction=ai_followup.first_instruction(turns, instruction), count=asked,
        name=name[:200], var_binding=var[:100],
        existing_options=existing_texts, tags=tags, axes=axes,
        description=description, labels=labels, refs_text=refs.describe(exclude=self_id),
    )
    ask: dict[str, Any] = dict(
        cfg=cfg, first=first, turns=turns, instruction=instruction,
        system=webs.system(ai_wildcard.draft_prompt()),
        schema=webs.schema(ai_wildcard.DRAFT_SCHEMA),
        schema_name="wildcard_options",
        images=images or None,
        quick=True, max_tokens=ai_wildcard.answer_tokens(asked),
    )

    def compiled(raw: Any) -> dict[str, Any]:
        return ai_wildcard.compile_options(
            raw,
            existing_payload={
                "options": [o for o in options if isinstance(o, dict)][:5000],
                "sub_categories": tags,
            },
            limit=count, refs=refs, self_id=self_id,
            # A refine is held to the first request too ("with negatives"),
            # and one in another language to its restatement as well.
            request=" ".join(dict.fromkeys(
                (ai_followup.first_instruction(turns, instruction), instruction, check))),
            labels=labels, own_name=f"{name} {var}",
        )

    try:
        answer = await _ask(extra=webs.note, **ask)
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    answer, research = webs.take(answer)

    try:
        result = compiled(answer)
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    asked_words = " ".join(dict.fromkeys((instruction, check)))
    asked_first = " ".join(dict.fromkeys(
        (ai_followup.first_instruction(turns, instruction), check)))
    real_opts = [o for o in options if isinstance(o, dict)]

    def problems(res: dict[str, Any]) -> list[str]:
        return [x for x in (
            ai_wildcard.bleed_note(name, var, res["options"], asked_words),
            ai_wildcard.untagged_note(asked_first, res["options"], real_opts)) if x]

    notes = problems(result)
    if notes:
        # One re-ask with what the code found; the first answer stands when
        # the second is no better.
        try:
            again, _ = webs.take(await _ask(extra="\n\n".join(
                x for x in (webs.note, *notes) if x), **ask))
            better = compiled(again)
            if len(better["options"]) >= len(result["options"]) and \
                    len(problems(better)) < len(notes):
                answer, result = again, better
        except (_ai_client.AIError, ValueError):
            pass
    if ai_wildcard.untagged_note(asked_first, result["options"], real_opts):
        result.setdefault("warnings", []).append(
            "You asked for tags, but no option came back tagged; tag them, or Try again")
    groups, group_notes = ai_wildcard.new_groups(
        answer.get("axes") if isinstance(answer, dict) else None,
        existing_payload={"sub_categories": tags, "tag_groups": axes, "tag_group_kinds": kinds},
        new_tags=result["new_tags"], options=result["options"],
    )
    result["groups"] = groups
    result["skipped"] += [{"text": "tag groups", "reason": n} for n in group_notes]
    result["model"] = cfg["model"]
    result["answer"] = answer
    result["research"] = research
    result["count"] = count
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
    body = await _body(request, limit=_MAX_IMAGE_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    images = await _request_images(cfg, body)
    if isinstance(images, web.Response):
        return images
    webs = _Web(cfg, body)

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
    # A request in another language: the checks read its restatement.
    frame = await _ai_lang.frame(cfg, instruction)
    check = ai_lang.check_text(frame, instruction)

    wc = _got if isinstance(_got := body.get("wildcard"), dict) else {}
    payload = _got if isinstance(_got := wc.get("payload"), dict) else {}
    raw_opts = _got if isinstance(_got := payload.get("options"), list) else []
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
    raw_groups = _got if isinstance(_got := payload.get("tag_groups"), dict) else {}
    axes = {str(k): _str_list(v, limit=200) for k, v in list(raw_groups.items())[:50]}
    name = _got if isinstance(_got := wc.get("name"), str) else ""
    var = _got if isinstance(_got := wc.get("var_binding"), str) else ""

    description, labels = ai_about.clean(wc.get("description"), wc.get("tags"))
    self_id = _got if isinstance(_got := wc.get("id"), str) else None
    refs = _ref_index(_wildcards(request), self_id, payload, name)
    known_tag = _known_tag() if action == "rewrite" and ai_edit.wants_booru(check) \
        else None
    first = ai_edit.build_edit_prompt(
        action=action, instruction=ai_followup.first_instruction(turns, instruction),
        name=name[:200], var_binding=var[:100],
        options=rows, tags=tags, axes=axes, description=description, labels=labels,
        refs=refs,
    )
    ask: dict[str, Any] = dict(
        cfg=cfg, first=first, turns=turns, instruction=instruction,
        system=webs.system(ai_edit.system_prompt(action)),
        schema=webs.schema(ai_edit.schema_for(action, [r["id"] for r in rows])),
        schema_name=f"wildcard_{action}",
        # Edits should be faithful to the request, not creative.
        temperature=0.3,
        images=images or None,
        quick=True, max_tokens=ai_edit.answer_tokens(action, len(rows)),
    )
    try:
        answer = await _ask(extra=webs.note, **ask)
        nudged = ai_edit.answered_nothing(action, answer, check)
        if nudged:
            # The base 9B answered "tag each by …" with an empty list every
            # time (panel eval 2026-10-21): the system prompt's "only list
            # the options you change" read as "change nothing". One re-ask.
            answer = await _ask(extra="\n\n".join(x for x in (webs.note, ai_edit.EMPTY_NUDGE)
                                                  if x), **ask)
        missing = [] if nudged else ai_edit.left_out(action, answer, check,
                                                     [r["id"] for r in rows])
        if missing:
            # One re-ask in all: the empty answer's, or this one.
            again = await _ask(extra="\n\n".join(
                x for x in (webs.note, ai_edit.left_out_nudge(missing)) if x), **ask)
            # The second answer stands only when it covers more.
            if isinstance(again, dict) and again.get("options") and len(ai_edit.left_out(
                    action, again, check, [r["id"] for r in rows])) < len(missing):
                answer = again
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    answer, research = webs.take(answer)
    try:
        result = ai_edit.compile_edit(action, answer, options=rows, registry=tags,
                                      refs=refs, self_id=self_id, labels=labels,
                                      instruction=check, frame=frame, known_tag=known_tag)
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    if action == "remove" and len(rows) >= 3 and len(result["changes"]) == len(rows):
        # Bench W8: "drop anything that could not exist before 1900" removed
        # all 12 outfits. One re-ask; the second answer stands when it keeps
        # some, else the draft says so.
        try:
            again, _ = webs.take(await _ask(extra="\n\n".join(
                x for x in (webs.note, ai_edit.ALL_REMOVED_NUDGE) if x), **ask))
            retry = ai_edit.compile_edit(action, again, options=rows, registry=tags,
                                         refs=refs, self_id=self_id, labels=labels,
                                         instruction=check, frame=frame)
            if 0 < len(retry["changes"]) < len(rows):
                answer, result = again, retry
        except (_ai_client.AIError, ValueError):
            pass
        if len(result["changes"]) == len(rows):
            result["warnings"] = ["This removes every option; check the reasons before "
                                  "you apply it"]
    if not result["changes"] and result["skipped"] and all(
            x["reason"] == "not an option in the list" for x in result["skipped"]):
        # Small models write prose where the option number goes: every change
        # is dropped, which used to come back as a silent empty list.
        return json_error(
            "the model's answer couldn't be used (it named no option by its number). "
            "Try again, or a larger model.", status=502)
    for c in result["changes"]:
        c["option_id"] = real_ids[c.pop("id")]
    result["action"] = action
    result["model"] = cfg["model"]
    result["answer"] = answer
    result["research"] = research
    return json_ok(result)


def _known_tag() -> Any:
    """The installed tag list's exact lookup, or None when there is none."""
    from wp_api import tags as _tags

    idx = _tags._get_index()
    return idx.has if idx is not None else None


async def post_derivation_draft(request: web.Request) -> web.Response:
    """Body: {instruction, derivation: {name?, rules?}}.

    `rules` are the editor's current rules (unsaved edits included); the
    model is told not to repeat them, and new rule ids avoid theirs. The
    variables it may use come from the library.
    """
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request, limit=_MAX_IMAGE_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    images = await _request_images(cfg, body)
    if isinstance(images, web.Response):
        return images
    instruction = _instruction(body, "say what the rules should do")
    if isinstance(instruction, web.Response):
        return instruction
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    drv = _got if isinstance(_got := body.get("derivation"), dict) else {}
    rules = [r for r in drv.get("rules") or [] if isinstance(r, dict)][:200]
    name = _got if isinstance(_got := drv.get("name"), str) else ""

    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
        templates = TemplateRepository(conn).list()
    catalog = library_vars.build_catalog(modules)
    drv_id = _got if isinstance(_got := drv.get("id"), str) else None
    reads = library_vars.read_vars([m for m in modules if m.get("id") != drv_id], templates) \
        | library_vars.read_vars([{"type": "derivation", "payload": {"rules": rules}}])
    refs = ai_refs.RefIndex([m for m in modules if m.get("type") == "wildcard"])
    focus = [
        n for line in (ai_derivation.describe_rule(r) for r in rules)
        for n in library_vars.var_names_in(line)
    ]
    description, labels = ai_about.clean(drv.get("description"), drv.get("tags"))
    first = ai_derivation.build_prompt(
        instruction=ai_followup.first_instruction(turns, instruction), name=name[:200],
        description=description, labels=labels,
        catalog_text=library_vars.describe_for(
            # The first request only: follow-ups replay this prompt as it was.
            catalog, " ".join([ai_followup.first_instruction(turns, instruction), name,
                               description]), focus=focus),
        existing_rules=[ai_derivation.describe_rule(r) for r in rules],
        refs_text=refs.describe(), numbered=bool(rules),
    )
    try:
        answer = await _ask(
            cfg, first=first, turns=turns, instruction=instruction,
            system=ai_derivation.SYSTEM_PROMPT + (
                "\n\n" + ai_derivation.EDIT_NOTE if rules else ""),
            schema=ai_derivation.EDIT_SCHEMA if rules else ai_derivation.SCHEMA,
            schema_name="derivation_rules", temperature=0.3,
            images=images or None, quick=True,
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    asked = ai_followup.first_instruction(turns, instruction)
    try:
        result = ai_derivation.compile_rules(
            answer, catalog=catalog,
            taken_ids={r["id"] for r in rules if isinstance(r.get("id"), str)}, refs=refs,
            existing=rules, request=" ".join(dict.fromkeys((asked, instruction))),
            read_vars=reads,
        )
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    rules_out = [x["rule"] for x in result["rules"]]
    gone = ai_derivation.missing_else(await _ai_lang.check_text(cfg, instruction), rules_out)
    if gone:
        # Re-test on d6ac847 (9B): the catch-all was dropped in 2 of 3 drafts.
        # One short second ask for the ELSE alone (verify, then repair).
        added = await _repair_else(cfg, instruction, result, catalog, refs)
        if added:
            for x in result["rules"]:
                if isinstance(x["rule"].get("else"), dict):
                    x["summary"] = ai_derivation.describe_rule(x["rule"])
            result["warnings"] = [*result.get("warnings", []),
                                  f"Added the catch-all from your request: else {added}"]
        else:
            result["skipped"] = [*result["skipped"], {"text": "a catch-all", "reason": gone}]
    result["model"] = cfg["model"]
    result["answer"] = answer
    return json_ok(result)


async def _repair_else(cfg: dict[str, Any], instruction: str, result: dict[str, Any],
                       catalog: dict[str, Any], refs: Any) -> str:
    """Ask the model for the missing ELSE only and attach it; "" when that
    fails too (the draft then carries the warning)."""
    rules = [x["rule"] for x in result["rules"]]
    targets = sorted({str(a.get("target_var")) for r in rules
                      for c in [*(r.get("branches") or []), r.get("else")] if isinstance(c, dict)
                      for a in [c.get("action"), *(c.get("extra_actions") or [])]
                      if isinstance(a, dict) and isinstance(a.get("target_var"), str)})
    if not targets:
        return ""
    try:
        answer = await _ai_client.complete_json(
            cfg, system=ai_derivation.ELSE_SYSTEM,
            user=ai_derivation.else_prompt(instruction, rules),
            schema=ai_derivation.else_schema(targets), schema_name="derivation_else",
            temperature=0.2, max_tokens=512, quick=True)
    except _ai_client.AIError:
        return ""
    return ai_derivation.attach_else(answer, rules, catalog, refs)


def _catalog_size(kind: str) -> tuple[int, int]:
    """How much of the library a text panel sees, (variables in full,
    values each): fixed values read no variable, so a few for the style and
    the rest by name."""
    if kind == "fixed_values":
        return text_items.FIXED_CATALOG_VARS, text_items.FIXED_CATALOG_VALUES
    return library_vars.MAX_VARS_FOCUSED, library_vars.MAX_VALUES_SHOWN


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
    body = await _body(request, limit=_MAX_IMAGE_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    images = await _request_images(cfg, body)
    if isinstance(images, web.Response):
        return images
    webs = _Web(cfg, body)
    kind = body.get("kind")
    if kind not in _TEXT_KINDS:
        return json_error("kind must be fixed_values, combine or template", status=400)
    instruction = _instruction(body, "say what to write")
    if isinstance(instruction, web.Response):
        return instruction
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    item = _got if isinstance(_got := body.get("item"), dict) else {}
    payload = _got if isinstance(_got := item.get("payload"), dict) else {}
    name = _got if isinstance(_got := item.get("name"), str) else ""
    out_var = ""
    if kind == "fixed_values":
        current = "\n".join(
            f"${v.get('name')} = {v.get('value')}"
            + (f"  (negative: {v['negative']})" if v.get("negative") else "")
            for v in payload.get("values") or [] if isinstance(v, dict))
    elif kind == "combine":
        out_var = _got if isinstance(_got := payload.get("output_var"), str) else ""
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
    item_id = _got if isinstance(_got := item.get("id"), str) else None
    catalog = library_vars.build_catalog([m for m in modules if m.get("id") != item_id])
    description, labels = ai_about.clean(item.get("description"), item.get("tags"))
    asked = ai_followup.first_instruction(turns, instruction)
    # Both asks: a refine is held to the first request too.
    # A request in another language: the checks read its restatement.
    check = await _ai_lang.check_text(cfg, instruction)
    held_to = " ".join(dict.fromkeys((asked, instruction, check)))
    first = text_items.build_prompt(
        kind=kind, instruction=asked,
        name=name[:200], description=description,
        catalog_text=library_vars.describe_for(
            text_items.prompt_catalog(kind, catalog, asked),
            " ".join([asked, name, description, current[:2000], out_var]),
            keep=_catalog_size(kind)[0], values=_catalog_size(kind)[1]),
        labels=labels, current=current[:4000], out_var=out_var,
    )
    system, schema, schema_name = _TEXT_KINDS[kind]
    ask: dict[str, Any] = dict(
        cfg=cfg, first=first, turns=turns, instruction=instruction,
        system=webs.system(system), schema=webs.schema(schema), schema_name=schema_name,
        temperature=0.5, images=images or None, quick=True,
        max_tokens=text_items.answer_tokens(kind))
    try:
        try:
            answer = await _ask(extra=webs.note, **ask)
        except _ai_client.AIError as e:
            # A model that loops on the same words hits the limit; one more
            # sample usually doesn't.
            if e.message != _ai_client.CUT_OFF_MESSAGE:
                raise
            answer = await _ask(extra=webs.note, **ask)
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    answer, research = webs.take(answer)

    def problems(raw: Any) -> list[str]:
        unset = text_items.left_out(kind, raw, check)
        names = ", ".join(f"${v}" for v in unset)
        notes = [(f"Set {names} too: the request asks for it. Answer with the whole list again."
                  if kind == "fixed_values" else
                  f"Read {names} too: the request asks for it. Answer with the whole text "
                  "again.")] if unset else []
        return notes + text_items.recheck_notes(kind, raw, held_to)

    notes = problems(answer)
    if notes:
        # One re-ask naming what the code found; the first answer stands
        # when the second misses no less of the request.
        try:
            again, _ = webs.take(await _ask(
                extra="\n\n".join(x for x in (webs.note, *notes) if x), **ask))
            if len(problems(again)) < len(notes):
                answer = again
        except _ai_client.AIError:
            pass
    had = text_items.reads(str(payload.get("template") or "") if kind == "combine"
                           else str(item.get("template_string") or ""))
    try:
        if kind == "fixed_values":
            result = text_items.compile_fixed(answer, existing=payload, request=held_to)
        elif kind == "combine":
            result = text_items.compile_combine(answer, out_var=out_var, catalog=catalog,
                                                existing=payload, request=held_to)
        else:
            result = text_items.compile_template(answer, catalog=catalog, request=held_to)
        if kind != "fixed_values":
            body = result["payload"].get("template") or result["payload"].get("template_string")
            gone = text_items.missing_asked(str(body or ""), check)
            if gone:
                result["warnings"] = [*result["warnings"], gone]
            extra = text_items.unasked(str(body or ""), check,
                                       text_items.reads(str(body or "")), had)
            if extra:
                result["warnings"] = [*result["warnings"], extra]
            result["samples"] = text_items.samples(str(body or ""), catalog,
                                                   seed=f"{name}:{instruction}",
                                                   texts=text_items.sample_texts(modules, item_id))
            result["before"] = {
                "template": str(payload.get("template") or "") if kind == "combine"
                else str(item.get("template_string") or ""),
                "negative": str(payload.get("negative") or "") if kind == "combine"
                else str(item.get("negative_template") or ""),
            }
    except ValueError as e:
        return json_error(
            f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
            status=502,
        )
    result["model"] = cfg["model"]
    result["answer"] = answer
    result["research"] = research
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
    body = await _body(request, limit=_MAX_IMAGE_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    images = await _request_images(cfg, body)
    if isinstance(images, web.Response):
        return images
    instruction = _instruction(body, "say what the rules should do")
    if isinstance(instruction, web.Response):
        return instruction
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    cons = _got if isinstance(_got := body.get("constraint"), dict) else {}
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
        "matrix": _got if isinstance(_got := cons.get("matrix"), dict) else {},
        "exceptions": [e for e in cons.get("exceptions") or [] if isinstance(e, dict)][:2000],
    }
    description, labels = ai_about.clean(cons.get("description"), cons.get("tags"))
    cname = _got if isinstance(_got := cons.get("name"), str) else ""
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
            images=images or None, quick=True,
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
    name = _got if isinstance(_got := body.get("name"), str) else ""
    description, tags = ai_about.clean(body.get("description"), body.get("tags"))
    hint = _got if isinstance(_got := body.get("hint"), str) else ""
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
            quick=True,
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
    hint = _got if isinstance(_got := body.get("instruction"), str) else ""
    if len(hint) > ai_wildcard.MAX_INSTRUCTION_LEN:
        return json_error("that request is too long", status=400)
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    wanted = _got if isinstance(_got := body.get("items"), list) else []
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
            system=ai_organize.SYSTEM_PROMPT,
            schema=ai_organize.schema_for([it["id"] for it in items]),
            schema_name="organize", temperature=0.3, quick=True,
        )
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    try:
        result = ai_organize.compile_answer(
            answer, items=items, categories=categories, library=library,
            request=" ".join(dict.fromkeys((ai_followup.first_instruction(turns, hint), hint))),
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
