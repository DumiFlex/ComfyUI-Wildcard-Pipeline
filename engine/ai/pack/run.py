"""Pack builder whole run (evals): `run_pack` plans, builds, checks and
repairs a pack the way the manager does."""
from __future__ import annotations

from typing import Any

from engine.ai import patterns as ai_patterns
from engine.ai.pack._common import PLAN_SCHEMA, PlanError, _item
from engine.ai.pack.build import item_request, library_item
from engine.ai.pack.check import check_pack
from engine.ai.pack.compile_item import compile_item
from engine.ai.pack.drafts import DRAFT_TEMPERATURES, draft_line, pick_draft
from engine.ai.pack.graph import (
    GRAPH_SCHEMA,
    GRAPH_SYSTEM,
    compile_graph_plan,
    is_wired,
    refs_prompt,
    refs_schema,
    wired_payload,
    with_refs,
)
from engine.ai.pack.plan import build_order, compile_plan
from engine.ai.pack.prompts import plan_prompt, refine_text
from engine.ai.pack.review import review_note, review_plan
from engine.ai.pack.settings import PLAN_SYSTEM, parse_settings

#: ``await complete(system=, user=, schema=, schema_name=, temperature=)``
#: returns the model's JSON answer; raises on a failed call.
Complete = Any


#: What the manager sends for a question the user leaves to the model
#: (`usePackBuilder.ts:DECIDE_ANSWER`).
DECIDE_ANSWER = "Your call (decide for me)"


def plan_retry_note(error: str) -> str:
    """Sent with a plan request asked again after the answer couldn't be used."""
    return (f"Your last plan couldn't be used: {error}. Write the whole plan again with "
            "that fixed: wildcards for what varies, then the rest, and a template.")


async def run_pack(
    complete: Complete, instruction: str, *, seeds: int = 100, repairs: int = 2,
    library: list[dict[str, Any]] | None = None, settings: Any = None,
) -> dict[str, Any]:
    """Plan, build, check and repair a pack the way the manager does, for
    the eval script. Questions in the first plan are all left to the model
    ("Decide for me") and the plan is refined once, as a user who clicks
    "Decide the rest" would. Returns ``{plan, built, check, log, failed}``;
    ``failed`` lists the items that never built. Raises PlanError when the
    plan fails."""
    log: list[str] = []
    cfg = parse_settings(settings)
    graph = cfg["planner"] == "graph"
    system = GRAPH_SYSTEM if graph else PLAN_SYSTEM
    schema = GRAPH_SCHEMA if graph else PLAN_SCHEMA
    schema_name = "pack_graph" if graph else "pack_plan"

    async def compiled(answer: Any, previous: Any = None,
                       decisions: Any = None) -> dict[str, Any]:
        if not graph:
            return compile_plan(answer, library=library, previous=previous,
                                decisions=decisions, settings=cfg, request=instruction)
        plan = compile_graph_plan(answer, library=library, previous=previous,
                                  decisions=decisions, settings=cfg)
        if plan["bad_refs"]:
            # One repair call, on an enum of what the graph declares.
            log.append(f"plan: {len(plan['bad_refs'])} relation(s) named nothing; asked again")
            g = {**plan["graph"], "bad_refs": plan["bad_refs"]}
            fix = await complete(system=GRAPH_SYSTEM, user=refs_prompt(g), schema=refs_schema(g),
                                 schema_name="pack_refs", temperature=0.2)
            plan = compile_graph_plan(with_refs(g, fix), library=library, previous=plan,
                                      decisions=decisions, settings=cfg)
        return plan

    lib_note = ai_patterns.note(ai_patterns.summarize(library or []))
    first = plan_prompt(instruction, library_note=lib_note, settings=cfg, library=library)
    answer = await complete(system=system, user=first,
                            schema=schema, schema_name=schema_name, temperature=0.4)
    try:
        plan = await compiled(answer)
    except PlanError as e:  # once more with what was wrong, as the route does
        log.append(f"plan: {e}; asked again")
        answer = await complete(system=system, user=first + "\n\n" + plan_retry_note(str(e)),
                                schema=schema, schema_name=schema_name, temperature=0.2)
        plan = await compiled(answer)
    if graph and cfg["drafts"] == "three":
        drafts = [(answer, plan)]
        for t in DRAFT_TEMPERATURES[1:]:
            try:
                a = await complete(system=system, user=first, schema=schema,
                                   schema_name=schema_name, temperature=t)
                drafts.append((a, await compiled(a)))
            except Exception as e:  # noqa: BLE001 - a failed draft is skipped
                log.append(f"plan: a draft failed ({type(e).__name__}: {e})")
        best, scores = pick_draft([p for _, p in drafts], instruction, library)
        answer, plan = drafts[best]
        line = draft_line(best, scores)
        if line:
            plan["applied"] = [*plan.get("applied", []), line]
            log.append(f"plan: {line}")
    history = [(first, answer)]
    decisions: list[dict[str, str]] = []
    if plan["questions"]:
        decisions = [{"question": q["question"], "answer": DECIDE_ANSWER}
                     for q in plan["questions"]]
        log.append(f"plan: left {len(decisions)} question(s) to the model")
        follow = refine_text("I answered your questions.", decisions, cfg)
        answer = await complete(system=system, user=follow, history=history,
                                schema=schema, schema_name=schema_name,
                                temperature=0.4)
        history = [*history, (follow, answer)]
        plan = await compiled(answer, previous=plan, decisions=decisions)
    # The plan review's fixes, as a user pressing "Fix all" would send them.
    fixes = [f for f in review_plan(plan, library, request=instruction)
             if f["level"] == "fix"]
    if fixes:
        log.append(f"plan: fixing {len(fixes)} review finding(s)")
        note = review_note(fixes)
        try:
            answer = await complete(system=system, user=note, history=history,
                                    schema=schema, schema_name=schema_name,
                                    temperature=0.4)
            plan = await compiled(answer, previous=plan, decisions=decisions)
        except PlanError as e:
            log.append(f"plan: the fixed plan couldn't be used ({e}); kept the last one")
        left = [f["text"] for f in review_plan(plan, library, request=instruction)
                if f["level"] == "fix"]
        log += [f"plan: still to fix: {t}" for t in left]
    log += [f"plan: {w}" for w in plan["warnings"]]
    built: dict[str, dict[str, Any]] = {}
    failed: list[str] = []

    async def build(key: str, note: str = "") -> bool:
        if _item(plan, key)["kind"] == "library":
            try:
                out = library_item(plan, key, library)
            except PlanError as e:
                log.append(f"{key}: {e}")
                return False
            built[key] = {"id": out["id"], "payload": out["payload"]}
            return True
        if is_wired(plan, key):
            try:
                out = wired_payload(plan, key, built)
            except PlanError as e:
                log.append(f"{key}: {e}")
                return False
            built[key] = {"id": _item(plan, key)["id"], "payload": out["payload"]}
            log.extend(f"{key}: {w}" for w in out["warnings"])
            return True
        error = ""
        for attempt in range(2):
            try:
                # A retry names what went wrong, so the model can fix it.
                req = item_request(plan, key, built, "; ".join(
                    x for x in (note, error and f"your last answer failed: {error}") if x),
                    library=library)
                raw = await complete(**req)
                old = built.get(key)
                out = compile_item(plan, key, built, raw,
                                   taken={b["id"] for b in built.values()},
                                   item_id=old["id"] if old else "", library=library)
            except (ValueError, PlanError) as e:
                log.append(f"{key} attempt {attempt + 1}: {e}")
                error = str(e)
                continue
            except Exception as e:  # noqa: BLE001 - a failed call is a scored miss
                log.append(f"{key} attempt {attempt + 1}: {type(e).__name__}: {e}")
                error = str(e)
                continue
            built[key] = {"id": out["id"], "payload": out["payload"]}
            log.extend(f"{key}: {w}" for w in out["warnings"])
            if out["repair"] and not note:
                log.append(f"{key} fix: {out['repair']}")
                return await build(key, out["repair"]) or True
            return True
        return False

    from engine.ai import pack_tidy

    for key in build_order(plan):
        if await build(key):
            continue
        if _item(plan, key)["kind"] == "template":
            # As the manager does on the template's second failure.
            try:
                out = pack_tidy.fallback_item(plan, key, built, "both tries failed",
                                              library=library)
            except ValueError as e:
                log.append(f"{key}: {e}")
            else:
                built[key] = {"id": out["id"], "payload": out["payload"]}
                log.append(f"{key}: wrote a plain template")
                continue
        failed.append(key)

    def checked() -> dict[str, Any] | None:
        nonlocal built
        if not built:
            return None
        built, tidied = pack_tidy.tidy(plan, built, library=library)
        for k, t in tidied.items():
            log.extend(f"{k} tidy: {w}" for w in t["warnings"])
        return check_pack(plan, built, seeds=seeds, library=library)

    report = checked()
    for _ in range(repairs):
        if not report or not report["problems"]:
            break
        for key, problems in report["problems"].items():
            if key in built:
                log.append(f"{key} repair: {'; '.join(problems)}")
                await build(key, "; ".join(problems))
                w = _item(plan, key)
                if w["kind"] == "wildcard":
                    for c in plan["items"]:
                        if c["kind"] == "constraint" and w["var"] in (c["source"], c["target"]):
                            await build(c["key"])
        report = checked()
    return {"plan": plan, "built": built, "check": report, "log": log, "failed": failed}
