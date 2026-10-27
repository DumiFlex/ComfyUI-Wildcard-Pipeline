"""Pack builder routes: plan, change, search, review, item, check,
install, and bundle split."""
from __future__ import annotations

import asyncio
import json as _json
import re
from typing import Any

from aiohttp import web

from engine.ai import adult as ai_adult
from engine.ai import budget as ai_budget
from engine.ai import bundle_split as ai_split
from engine.ai import followup as ai_followup
from engine.ai import lang as ai_lang
from engine.ai import pack as ai_pack
from engine.ai import pack_tidy
from engine.ai import patterns as ai_patterns
from engine.ai import safety as ai_safety
from engine.ai import vocab as ai_vocab
from engine.ai import wildcard as ai_wildcard
from engine.ai.pack import recommend as pack_recommend
from engine.db.repositories import (
    BundleRepository,
    ModuleRepository,
    TemplateRepository,
)
from engine.importer import commit_import
from wp_api import (
    _ai_client,
    _ai_lang,
    _ai_search,
    _ai_vocab,
)
from wp_api._ai_common import (
    _MAX_IMAGE_BODY_BYTES,
    _MAX_PACK_BODY_BYTES,
    _ask,
    _body,
    _enabled_cfg,
    _instruction,
    _request_images,
    _turns,
)
from wp_api._ai_context import (
    _vocab_kinds,
    _window,
)
from wp_api._helpers import db_session, json_error, json_ok
from wp_api._validators import validate_wildcard_name


def _reusable(request: web.Request) -> list[dict[str, Any]]:
    """Library rows a pack may reuse or point at: wildcards and fixed values."""
    with db_session(request) as conn:
        return [m for m in ModuleRepository(conn).list()
                if m.get("type") in ai_pack.REUSABLE]


def _pack_base(request: web.Request, body: dict[str, Any],
               library: list[dict[str, Any]]) -> dict[str, Any] | None | web.Response:
    """"Extend with AI": the bundle named by ``bundle_id``, read fresh on
    every request (None without one)."""
    bid = body.get("bundle_id")
    if bid is None:
        return None
    if not isinstance(bid, str) or not bid:
        return json_error("bundle_id must be a bundle id", status=400)
    with db_session(request) as conn:
        bundles = BundleRepository(conn).list()
    bundle = next((b for b in bundles if b["id"] == bid), None)
    if bundle is None:
        return json_error("that bundle no longer exists", status=404)
    return ai_pack.bundle_base(bundle, bundles, library)


def _canvas(body: dict[str, Any]) -> list[dict[str, Any]] | None:
    """The canvas variables the manager sent (``canvas``), or None when it
    sent none (a plan sent back keeps the ones it had)."""
    raw = body.get("canvas")
    return raw if isinstance(raw, list) else None


async def _check_request(cfg: dict[str, Any], body: dict[str, Any]) -> None:
    """The request the manager sends back with a plan, as the code checks
    read it: a request in another language becomes its English
    restatement (`engine/ai/lang.py`, asked once and kept) when the plan
    itself is written in English, so its words are matched against the
    plan's."""
    raw = body.get("request")
    if not isinstance(raw, str) or not raw.strip():
        return
    english = await _ai_lang.check_text(cfg, raw)
    body["request"] = ai_lang.for_content(raw, english, body.get("plan"))


async def _english_parts(cfg: dict[str, Any], *parts: str) -> str:
    """``parts`` joined, each in its English restatement when it isn't
    English."""
    return " ".join([await _ai_lang.check_text(cfg, p) if p else p for p in parts])


def _pack_body(
    body: dict[str, Any], library: list[dict[str, Any]] | None = None,
    base: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]] | web.Response:
    """The plan and built items the manager sends back, checked again."""
    raw = body.get("plan")
    try:
        if isinstance(raw, dict) and isinstance(raw.get("graph"), dict):
            # A graph plan: its items are compiled from the graph again, and
            # keep their keys and ids through ``previous``.
            asked = _got if isinstance(_got := body.get("request"), str) else ""
            plan = ai_pack.compile_graph_plan(raw, library=library, base=base,
                                              canvas=_canvas(body), previous=raw,
                                              settings=raw.get("settings"), request=asked)
        else:
            plan = ai_pack.compile_plan(raw, library=library, base=base, canvas=_canvas(body))
    except ai_pack.PlanError as e:
        return json_error(f"the plan can't be used: {e}", status=400)
    return plan, ai_pack.parse_built(plan, body.get("built"))


async def _repair_refs(cfg: dict[str, Any], plan: dict[str, Any], **kw: Any) -> dict[str, Any]:
    """One repair call for the relations a graph plan dropped, on an enum
    of what the graph declares; a failed call keeps the plan as it is."""
    g = {**plan["graph"], "bad_refs": plan["bad_refs"]}
    try:
        fix = await _ai_client.complete_json(
            cfg, system=ai_pack.GRAPH_SYSTEM, user=ai_pack.refs_prompt(g),
            schema=ai_pack.refs_schema(g), schema_name="pack_refs", temperature=0.2)
        return ai_pack.compile_graph_plan(ai_pack.with_refs(g, fix), previous=plan, **kw)
    except (_ai_client.AIError, ai_pack.PlanError):
        return plan


async def post_pack_plan(request: web.Request) -> web.Response:
    """Body: {instruction, history?, sample?, settings?, decisions?,
    previous?, images?}. An outline of the pack: title, questions,
    assumptions, sections and the items to build, each with a reserved
    module id. ``decisions`` are questions already answered (never asked
    again); ``previous`` is the plan being refined (its items keep their
    keys and ids, and hand edits replace the model's last answer)."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request, limit=_MAX_IMAGE_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    instruction = _instruction(body, "describe the pack first")
    if isinstance(instruction, web.Response):
        return instruction
    refused = ai_adult.refused_request(instruction)
    if refused:
        return json_error(refused, status=400)
    turns = _turns(body)
    if isinstance(turns, web.Response):
        return turns
    images = await _request_images(cfg, body)
    if isinstance(images, web.Response):
        return images
    sample = _got if isinstance(_got := body.get("sample"), str) else ""
    settings = ai_pack.parse_settings(body.get("settings"))
    decisions = ai_pack.parse_decisions(body.get("decisions"))
    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
        lib_note = ai_patterns.note(ai_patterns.summarize(
            modules, BundleRepository(conn).list(), TemplateRepository(conn).list()),
            reuse=False)
    library = [m for m in modules if m.get("type") in ai_pack.REUSABLE]
    base = _pack_base(request, body, library)
    if isinstance(base, web.Response):
        return base
    previous = _got if isinstance(_got := body.get("previous"), dict) else None
    canvas = _canvas(body) or []
    if turns and previous is not None:
        # The user may have edited the plan by hand: the model's last answer
        # is replayed as the plan they see now.
        try:
            if isinstance(previous.get("graph"), dict):
                shown = ai_pack.compile_graph_plan(previous, library=library, base=base,
                                                   canvas=canvas, previous=previous,
                                                   settings=settings)
                turns[-1]["answer"] = ai_pack.graph_answer(shown)
            else:
                shown = ai_pack.compile_plan(previous, library=library, base=base,
                                             canvas=canvas)
                turns[-1]["answer"] = ai_pack.plan_answer(shown)
        except ai_pack.PlanError:
            previous = None
    web_on = _ai_search.enabled(cfg)
    searched = [q for q in (body.get("searched") or []) if isinstance(q, str)][:12] \
        if isinstance(body.get("searched"), list) else []
    # A follow-up sends the images again only when they changed (or the
    # user asked), so the first request's prompt keeps the count it had.
    first_images = len(images)
    if turns and isinstance(body.get("image_count"), int) \
            and not isinstance(body.get("image_count"), bool):
        first_images = max(0, min(int(body["image_count"]), 8))
    kinds = await _vocab_kinds(body)
    first_text = ai_followup.first_instruction(turns, instruction)
    loras = ai_vocab.loras_note(_ai_vocab.lookup, kinds,
                                re.findall(r"[a-z]{3,}", f"{first_text} {sample}".lower()))
    graph = settings["planner"] == "graph"
    first = ai_pack.plan_prompt(
        first_text, library_note=lib_note,
        sample=sample, settings=settings, decisions=[] if turns else decisions,
        library=library, images=first_images, web=web_on, loras=loras, graph=graph)
    if base is not None:
        first = ai_pack.base_note(base) + "\n\n" + first
    follow = ai_pack.refine_text(instruction, decisions, settings, body.get("web"),
                                 searched, graph=graph) if turns else instruction
    canvas_line = ai_pack.canvas_note(ai_pack.canvas_vars(canvas))
    if canvas_line:
        if turns:
            follow += "\n\n" + canvas_line
        else:
            first += "\n\n" + canvas_line
    if turns and first_images and not images:
        follow += ("\n\nThe reference images aren't attached again; keep what you took "
                   "from them unless asked otherwise.")
    if turns and previous is not None and ai_pack.locks_note(previous):
        follow += "\n\n" + ai_pack.locks_note(previous)
    answer: Any = None
    plan: Any = None  # set by the loop, which returns when it can't
    retry = ""
    # The user's own words. A decision's answer is not one of them: picked
    # from the planner's own choices, it reads "a woman", "Generic big city"
    # or "your call", and those came back as request gaps at fix level in
    # every flow of the Sonnet walkthrough (2026-10-21), costing a Fix all
    # round each. The planner reads the decisions in every request anyway.
    raw_asked = " ".join([first_text, ai_pack.own_request(instruction), sample])
    asked = raw_asked
    # A request in another language: its English restatement, for a plan
    # the planner writes in English (`_asked_for`).
    english = await _english_parts(cfg, first_text, ai_pack.own_request(instruction))
    english = f"{english} {sample}" if sample else english

    def _asked_for(answer: Any) -> str:
        return ai_lang.for_content(raw_asked, english, answer)

    for attempt in range(2):
        try:
            answer = await _ask(
                cfg, first=first, turns=turns, instruction=follow, extra=retry,
                system=ai_pack.GRAPH_SYSTEM if graph else ai_pack.PLAN_SYSTEM,
                schema=ai_pack.GRAPH_SCHEMA if graph else ai_pack.PLAN_SCHEMA,
                schema_name="pack_graph" if graph else "pack_plan",
                temperature=0.4 if not retry else 0.2,
                images=images or None,
                image_note=False,  # plan_prompt says how to use them
                partial=True,  # a cut-off plan keeps the items it finished
            )
            asked = _asked_for(answer)
            if graph:
                plan = ai_pack.compile_graph_plan(answer, library=library, previous=previous,
                                                  decisions=decisions, settings=settings,
                                                  base=base, canvas=canvas, request=asked)
                if plan["bad_refs"]:
                    plan = await _repair_refs(cfg, plan, library=library, decisions=decisions,
                                              settings=settings, base=base, canvas=canvas,
                                              request=asked)
            else:
                plan = ai_pack.compile_plan(answer, library=library, previous=previous,
                                            decisions=decisions, settings=settings, base=base,
                                            canvas=canvas, request=asked)
            break
        except _ai_client.AIError as e:
            return json_error(e.message, status=e.status)
        except ai_pack.PlanError as e:
            if isinstance(answer, dict) and answer.get(_ai_client.CUT_OFF):
                if attempt:
                    return json_error(_ai_client.CUT_OFF_MESSAGE, status=502)
                # A plan that ran into the output limit is most often a
                # model repeating itself: one more sample, asked for less.
                retry = ai_pack.CUT_OFF_NOTE
                continue
            if attempt:
                return json_error(
                    f"the model's plan couldn't be used ({e}). Try again, or a larger model.",
                    status=502,
                )
            # A small model now and then answers a plan with no wildcards
            # or no template: asked once more with what was wrong.
            retry = ai_pack.plan_retry_note(str(e))
    temps = ai_pack.extra_temperatures(settings["drafts"], plan, asked, library) \
        if graph and not turns else ()
    if temps:
        # More drafts of the first plan (always two with "three", one when
        # the first scores below 0 with "auto"): the code keeps the draft
        # that fits the request best (`drafts.pick_draft`); a failed draft
        # is skipped.
        drafts = [(answer, plan)]
        # The images went once: the other drafts read what the first took
        # from them instead of reading the images again.
        seen = ai_pack.images_seen(plan) if images else ""
        for t in temps:
            try:
                a = await _ask(cfg, first=first, turns=turns, instruction=follow, extra=seen,
                               system=ai_pack.GRAPH_SYSTEM, schema=ai_pack.GRAPH_SCHEMA,
                               schema_name="pack_graph", temperature=t,
                               images=None, image_note=False, partial=True)
                if isinstance(a, dict) and a.get(_ai_client.CUT_OFF):
                    continue
                p = ai_pack.compile_graph_plan(a, library=library, previous=previous,
                                               decisions=decisions, settings=settings,
                                               base=base, canvas=canvas, request=asked)
                if p["bad_refs"]:
                    p = await _repair_refs(cfg, p, library=library, decisions=decisions,
                                           settings=settings, base=base, canvas=canvas,
                                           request=asked)
                drafts.append((a, p))
            except (_ai_client.AIError, ai_pack.PlanError):
                continue
        best, scores = ai_pack.pick_draft([p for _, p in drafts], asked, library)
        answer, plan = drafts[best]
        line = ai_pack.draft_line(best, scores)
        if line:
            plan["applied"] = [*plan.get("applied", []), line]
    if not web_on:
        plan["research"] = []
    plan["research"] = [q for q in plan["research"]
                        if not any(q.lower() == s.lower() for s in searched)]
    if not images and not first_images:
        plan["from_images"] = []
    if isinstance(answer, dict):
        answer.pop(_ai_client.CUT_OFF, None)  # never replayed to the model
    thought = _ai_client.last_thinking()
    return json_ok({"plan": plan, "model": cfg["model"], "answer": answer,
                    **({"thinking": thought} if thought else {}),
                    "review": ai_pack.review_plan(plan, library, request=asked),
                    "web": web_on,
                    "context": await _plan_context(cfg, first, turns, follow, answer,
                                                   len(images), graph=graph)})


async def _plan_context(cfg: dict[str, Any], first: str, turns: list[dict[str, Any]],
                        follow: str, answer: Any, images: int, *,
                        graph: bool = False) -> dict[str, Any]:
    """The pack plan's meter, like the chat's: about how much of the model's
    window the last request and its answer took (every refine sends the
    whole conversation again, so it grows)."""
    history, user = ai_followup.conversation(first, turns, follow)
    chars = ai_budget.prompt_chars(ai_pack.GRAPH_SYSTEM if graph else ai_pack.PLAN_SYSTEM,
                                   history, user,
                                   ai_pack.GRAPH_SCHEMA if graph else ai_pack.PLAN_SCHEMA)
    chars += len(_json.dumps(answer, ensure_ascii=False)) if answer is not None else 0
    return {"used": ai_budget.tokens(chars) + 1000 * images,
            "window": await _window(cfg, {}), "estimated": True,
            "about": not cfg.get("local")}


async def post_pack_search(request: web.Request) -> web.Response:
    """Body: {queries}. Runs the searches the pack planner or a Draft with
    AI panel asked for, after the user allowed them. Returns {results: [{query,
    text, rows: [{title, url, snippet}], error?}]}; the text is labelled as
    untrusted for the model, the rows are what the Pack builder lets the user
    pick from."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    if not _ai_search.enabled(cfg):
        return json_error("web search is off (Settings › AI assistant › Web search)",
                          status=400)
    raw = body.get("queries")
    queries = [q.strip()[:120] for q in raw if isinstance(q, str) and q.strip()] \
        if isinstance(raw, list) else []
    if not queries or len(queries) > ai_pack.MAX_RESEARCH:
        return json_error(f"send 1 to {ai_pack.MAX_RESEARCH} searches", status=400)
    results = []
    for q in queries:
        # The rows let the page show what each search found and let the
        # user pick what goes to the planner (Dumi 2026-10-21: "use what
        # the searches found" trusted results nobody had seen).
        try:
            rows = await _ai_search.search_rows(cfg, q)
            results.append({"query": q, "text": "web_search: " + _ai_search.rows_text(q, rows),
                            "rows": rows})
        except _ai_client.AIError as e:
            results.append({"query": q, "text": f"web_search: error: {e.message}", "rows": [],
                            "error": e.message})
    return json_ok({"results": results})


async def post_pack_recommend(request: web.Request) -> web.Response:
    """Body: {request, suggested?}. The pack settings the request, the
    assistant's model and the chat's suggestion (``suggested``, from a plan
    card) point to: ``{settings, reasons}``. No model call, unless the request isn't
    in English (`engine/ai/lang.py`)."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    text = body.get("request")
    text = text[:ai_wildcard.MAX_INSTRUCTION_LEN] if isinstance(text, str) else ""
    # A request in another language: read in its English restatement (one
    # small model call, kept for the plan that follows).
    text = await _ai_lang.check_text(cfg, text)
    return json_ok(pack_recommend.recommend(text, cfg, body.get("suggested")))


async def post_pack_change(request: web.Request) -> web.Response:
    """Body: {plan, key?, instruction}. One item rewritten by the model as
    the user asks (or, with no key, items added); the rest of the plan
    stays as it is. Returns {plan, review}."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request, limit=_MAX_PACK_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    await _check_request(cfg, body)
    instruction = _instruction(body, "say what to change")
    if isinstance(instruction, web.Response):
        return instruction
    refused = ai_adult.refused_request(instruction)
    if refused:
        return json_error(refused, status=400)
    library = _reusable(request)
    base = _pack_base(request, body, library)
    if isinstance(base, web.Response):
        return base
    parsed = _pack_body(body, library, base)
    if isinstance(parsed, web.Response):
        return parsed
    plan, _built = parsed
    key = _got if isinstance(_got := body.get("key"), str) else ""
    if key and key not in {i["key"] for i in plan["items"]}:
        return json_error("no such item in the plan", status=400)
    asked = _got if isinstance(_got := body.get("request"), str) else ""
    try:
        if isinstance(plan.get("graph"), dict):
            # A graph plan: one part on its own schema, merged by the code.
            answer = await _ai_client.complete_json(
                cfg, system=ai_pack.GRAPH_CHANGE_SYSTEM,
                user=ai_pack.graph_change_prompt(plan, key, instruction),
                schema=ai_pack.change_schema(plan, key), schema_name="pack_graph_change",
                temperature=0.4,
            )
            new = ai_pack.apply_graph_change(plan, key, answer, library=library, base=base,
                                             canvas=_canvas(body), request=asked)
            if new["bad_refs"]:
                new = await _repair_refs(cfg, new, library=library, base=base,
                                         canvas=_canvas(body), request=asked)
        else:
            answer = await _ai_client.complete_json(
                cfg, system=ai_pack.CHANGE_SYSTEM,
                user=ai_pack.change_prompt(plan, key, instruction),
                schema=ai_pack.CHANGE_SCHEMA, schema_name="pack_change", temperature=0.4,
            )
            new = ai_pack.apply_change(plan, key, answer, library, base)
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    except ai_pack.PlanError as e:
        return json_error(f"the model's change couldn't be used ({e}). Try again.",
                          status=502)
    return json_ok({"plan": new, "answer": answer, "model": cfg["model"],
                    "review": ai_pack.review_plan(new, library, request=asked)})


async def post_pack_images(request: web.Request) -> web.Response:
    """Body: {plan, images, note?, request?}. Reference images added to a
    graph plan after it was made: one narrow call says what they add
    (slots, fixed values, from_images lines), merged into the graph by the
    code instead of a whole re-plan. Returns {plan, answer, model, review}."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request, limit=_MAX_PACK_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    await _check_request(cfg, body)
    images = await _request_images(cfg, body)
    if isinstance(images, web.Response):
        return images
    if not images:
        return json_error("no images were sent", status=400)
    library = _reusable(request)
    base = _pack_base(request, body, library)
    if isinstance(base, web.Response):
        return base
    parsed = _pack_body(body, library, base)
    if isinstance(parsed, web.Response):
        return parsed
    plan, _built = parsed
    if not isinstance(plan.get("graph"), dict):
        return json_error("only a graph plan reads images this way", status=400)
    note = _got if isinstance(_got := body.get("note"), str) else ""
    asked = _got if isinstance(_got := body.get("request"), str) else ""
    try:
        answer = await _ai_client.complete_json(
            cfg, system=ai_pack.IMAGES_SYSTEM, user=ai_pack.images_prompt(plan, note),
            schema=ai_pack.IMAGES_SCHEMA, schema_name="pack_images", temperature=0.3,
            images=images,
        )
        new = ai_pack.apply_images(plan, answer, library=library, base=base,
                                   canvas=_canvas(body), request=asked)
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    except ai_pack.PlanError as e:
        return json_error(f"the model's answer couldn't be used ({e}). Try again.",
                          status=502)
    return json_ok({"plan": new, "answer": answer, "model": cfg["model"],
                    "review": ai_pack.review_plan(new, library, request=asked)})


async def post_pack_review(request: web.Request) -> web.Response:
    """Body: {plan, ai?, request?}. The plan checked against the guide
    before it is built; with ``ai`` the model reviews it too. Returns
    {findings, note, plan}: ``plan`` is the plan as the server reads it
    (hand-added items get their keys and reserved ids)."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request, limit=_MAX_PACK_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    await _check_request(cfg, body)
    library = _reusable(request)
    base = _pack_base(request, body, library)
    if isinstance(base, web.Response):
        return base
    parsed = _pack_body(body, library, base)
    if isinstance(parsed, web.Response):
        return parsed
    plan, _built = parsed
    asked = _got if isinstance(_got := body.get("request"), str) else ""
    findings = ai_pack.review_plan(plan, library, request=asked)
    if body.get("ai") is True:
        raw = body.get("recheck")
        recheck = [ai_safety.strip_invisible(t).strip()[:300] for t in raw[:ai_pack.MAX_RECHECK]
                   if isinstance(t, str) and t.strip()] if isinstance(raw, list) else None
        try:
            answer = await _ai_client.complete_json(
                cfg, system=ai_pack.review_system(plan),
                user=ai_pack.review_prompt(plan, findings, asked, recheck),
                schema=ai_pack.review_schema(plan), schema_name="pack_review",
                temperature=0.3,
            )
        except _ai_client.AIError as e:
            return json_error(e.message, status=e.status)
        findings += ai_pack.compile_review(answer, plan, findings, recheck)
    return json_ok({"findings": findings, "note": ai_pack.review_note(findings),
                    "plan": plan})


async def post_pack_item(request: web.Request) -> web.Response:
    """Body: {plan, built, key, note?}. Builds one item with the model.
    A rebuild keeps the item's id, so constraints keep pointing at it."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request, limit=_MAX_PACK_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    await _check_request(cfg, body)
    library = _reusable(request)
    base = _pack_base(request, body, library)
    if isinstance(base, web.Response):
        return base
    parsed = _pack_body(body, library, base)
    if isinstance(parsed, web.Response):
        return parsed
    plan, built = parsed
    key = body.get("key")
    note = _got if isinstance(_got := body.get("note"), str) else ""
    if not isinstance(key, str) or key not in {i["key"] for i in plan["items"]}:
        return json_error("no such item in the plan", status=400)
    if next(i for i in plan["items"] if i["key"] == key)["kind"] == "library":
        try:
            out = ai_pack.library_item(plan, key, library)
        except ai_pack.PlanError as e:
            return json_error(str(e), status=400)
        return json_ok({**out, "repair": "", "model": cfg["model"]})
    if ai_pack.is_wired(plan, key):
        # The graph wires this item: no model call.
        try:
            wired = ai_pack.wired_payload(plan, key, built)
        except (ai_pack.PlanError, ValueError) as e:
            return json_error(str(e), status=400)
        item = next(i for i in plan["items"] if i["key"] == key)
        return json_ok({"key": key, "id": item["id"], "kind": wired["kind"],
                        "payload": wired["payload"], "preview": wired["preview"],
                        "warnings": wired["warnings"], "repair": "", "model": cfg["model"]})
    kinds = await _vocab_kinds(body)
    try:
        req = ai_pack.item_request(plan, key, built, note[:1500], library=library)
    except ai_pack.PlanError as e:
        return json_error(str(e), status=400)
    vocab_line = ai_pack.item_vocab_note(plan, key, _ai_vocab.lookup, kinds)
    if vocab_line:
        req["user"] += "\n\n" + vocab_line
    # The template's second try: when the model fails again, a plain one
    # (every pick in order) keeps the pack rendering.
    last_try = next(i for i in plan["items"] if i["key"] == key)["kind"] == "template" \
        and note.startswith("your last answer failed")
    old = built.get(key)
    try:
        answer = await _ai_client.complete_json(cfg, **req)
        out = ai_pack.compile_item(
            plan, key, built, answer, taken={b["id"] for b in built.values()},
            item_id=old["id"] if old else "", library=library,
        )
    except (_ai_client.AIError, ValueError) as e:
        why = e.message if isinstance(e, _ai_client.AIError) else str(e)
        if last_try:
            try:
                out = pack_tidy.fallback_item(plan, key, built, why, library=library)
            except ValueError as e2:
                return json_error(f"the model's answer couldn't be used ({e2})", status=502)
        elif isinstance(e, _ai_client.AIError):
            return json_error(e.message, status=e.status)
        else:
            return json_error(
                f"the model's answer couldn't be used ({e}). Try again, or a larger model.",
                status=502,
            )
    grounded, spelled = ai_pack.ground_item(plan, out["kind"], out["payload"],
                                            _ai_vocab.lookup, kinds)
    if spelled:
        out = {**out, "payload": grounded, "preview": ai_pack.item_preview(out["kind"], grounded),
               "warnings": [*out["warnings"], spelled]}
    checked = ai_pack.tag_check_note(plan, out["kind"], out["payload"], _ai_vocab.lookup,
                                     kinds)
    if checked:
        out["warnings"] = [*out["warnings"], checked]
    out["model"] = cfg["model"]
    thought = _ai_client.last_thinking()
    if thought:
        out["thinking"] = thought
    return json_ok(out)


async def post_pack_check(request: web.Request) -> web.Response:
    """Body: {plan, built}. Runs the pack on the engine; no model call."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request, limit=_MAX_PACK_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    await _check_request(cfg, body)
    library = _reusable(request)
    base = _pack_base(request, body, library)
    if isinstance(base, web.Response):
        return base
    parsed = _pack_body(body, library, base)
    if isinstance(parsed, web.Response):
        return parsed
    plan, built = parsed
    if not built:
        return json_error("nothing is built yet", status=400)
    loop = asyncio.get_running_loop()

    def run() -> dict[str, Any]:
        # Fixes that need no model (words said twice, picks another wildcard
        # makes) go back to the browser with the report checked on them.
        tidied_built, tidied = pack_tidy.tidy(plan, built, library=library, base=base)
        report = ai_pack.check_pack(plan, tidied_built, library=library, base=base)
        return {**report, "tidied": tidied}

    return json_ok(await loop.run_in_executor(None, run))


async def post_pack_install(request: web.Request) -> web.Response:
    """Body: {plan, built, bundle_id?}. One import commit: the modules, the
    template and a bundle, tagged as one collection; with ``bundle_id`` the
    new items go into that bundle instead (it is replaced, so the same undo
    puts it back). Returns the import's undo id."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request, limit=_MAX_PACK_BODY_BYTES)
    if isinstance(body, web.Response):
        return body
    await _check_request(cfg, body)
    library = _reusable(request)
    base = _pack_base(request, body, library)
    if isinstance(base, web.Response):
        return base
    parsed = _pack_body(body, library, base)
    if isinstance(parsed, web.Response):
        return parsed
    plan, built = parsed
    if not any(i["key"] in built for i in plan["items"]
               if i["kind"] != "template" and not i.get("existing")):
        return json_error("nothing is built yet", status=400)
    for i in plan["items"]:
        if i["kind"] == "wildcard" and i["key"] in built:
            err = validate_wildcard_name(i["name"])
            if err is not None:
                return json_error(f"{i['name']}: {err}", status=400)
    with db_session(request) as conn:
        def ids(table: str) -> set[str]:
            return {r[0] for r in conn.execute(f"SELECT id FROM {table};")}  # noqa: S608
        taken = ids("modules") | ids("bundles")
        if base is None:
            ops = ai_pack.install_ops(plan, built, taken=taken,
                                      template_ids=ids("templates"), bundle_ids=ids("bundles"))
        else:
            ops = ai_pack.extend_ops(plan, built, base, taken=taken,
                                     template_ids=ids("templates"), bundle_ids=ids("bundles"))
        result = commit_import(conn, {"adds": ops["adds"], "replaces": ops["replaces"]})
    if not result.get("ok"):
        return json_error(result.get("error", "install failed"), status=400)
    return json_ok({
        "undo_entry_id": result["undo_id"], "ids": ops["ids"],
        "bundle_id": ops["bundle_id"], "sub_bundles": ops["sub_bundles"],
        "template_id": ops["template_id"], "tag": ops["tag"], "notes": ops["notes"],
    })


async def post_bundle_split(request: web.Request) -> web.Response:
    """Body: {name, children, instruction?}. The bundle editor's children
    (unsaved edits included) grouped into sub-bundles by the model.
    Returns {groups: [{name, about, start, end}]}: runs of neighbouring
    children, so the run order never changes. Nothing is saved."""
    cfg = _enabled_cfg()
    if isinstance(cfg, web.Response):
        return cfg
    body = await _body(request)
    if isinstance(body, web.Response):
        return body
    children = body.get("children")
    if not isinstance(children, list) or not all(isinstance(c, dict) for c in children):
        return json_error("children must be a list", status=400)
    if len(children) < 3:
        return json_error("a bundle needs at least 3 children to split", status=400)
    if len(children) > ai_split.MAX_CHILDREN:
        return json_error(f"at most {ai_split.MAX_CHILDREN} children", status=400)
    name = _got if isinstance(_got := body.get("name"), str) else ""
    instruction = _got if isinstance(_got := body.get("instruction"), str) else ""
    try:
        answer = await _ai_client.complete_json(
            cfg, system=ai_split.SYSTEM,
            user=ai_split.prompt(name, children, instruction[:1000]),
            schema=ai_split.SCHEMA, schema_name="bundle_split", temperature=0.3,
        )
        groups = ai_split.compile_groups(answer, children)
    except _ai_client.AIError as e:
        return json_error(e.message, status=e.status)
    except ai_split.SplitError as e:
        return json_error(str(e), status=502)
    return json_ok({"groups": groups, "model": cfg["model"]})
