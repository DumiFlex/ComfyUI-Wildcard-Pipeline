"""Score the pack builder against a model, offline.

Runs each request below through the same plan → build → check → repair
steps the manager uses (`engine/ai/pack.py:run_pack`), on the model saved
under Settings › AI assistant, and scores it:

- plan: the plan compiled (a dict the checker could use);
- built: share of planned items that built and passed their engine
  validator;
- clean: the test run on the engine ended with no problems;
- prompts: the template rendered sample prompts;
- feature: for the requests at the end, whether the pack used the feature
  the request calls for (a reference with a tag filter, an accepts axis, an
  empty option, a multi-pick, a fallback, an input, a model rule, a preset
  with negatives, hold).

Use it before listing a model as a suggestion. It is not part of CI: it
needs a running model and takes minutes per request.

USAGE
-----
    python scripts/ai_pack_evals.py [--set full|smoke] [--limit N] [--only 11,15]
                                    [--model NAME] [--out report.md]
                                    [--planner graph|items] [--drafts auto|one|three]
                                    [--save DIR]

``--set smoke`` runs a shorter set (plain packs, the feature requests and
two packs with a rule on a drawn list / a multi-value accepts target).

``--save DIR`` keeps every pack the run built: ``DIR/<n>-<slug>.md`` is a
readable sheet (items with their options and tags, constraint cells,
rules, the template, the check and sample prompts) and ``.json`` the plan
and built payloads, so a pack can be read, or judged, after the run.

Exit 0 always; the report is the result. Reads the AI settings file the
same way ComfyUI does (`WP_AI_CONFIG_PATH` overrides it).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.ai import config as ai_config  # noqa: E402
from engine.ai import pack  # noqa: E402

REQUESTS = [
    "A fantasy character pack: race, class, an outfit and a weapon that fit the class. "
    "Elves never use guns. Give each character a title like 'Elven Archmage'.",
    "Everyday outfits by season. Never sandals or shorts in winter, never a parka in summer.",
    "A weather wildcard and a time of day; night scenes get moody lighting.",
    "Cyberpunk street portraits: implants, neon colours, a district, and a mood.",
    "Food photography: a dish, plating style, a table surface and a light setup that suits "
    "the dish.",
    "Animals in habitats: the animal decides which habitats are possible.",
    "Hairstyles and hair colours, with long styles more common than short ones.",
    "A sci-fi ship interior pack: room type, lighting, crew role that fits the room.",
    "Landscape pack: biome, time of day, weather; snow only in cold biomes.",
    "Anime character sheet: archetype, hair, eyes, outfit, expression matching the archetype.",
    "Architectural renders: building style, material, era; glass and steel only after 1900.",
    "A horror pack: location, monster, lighting; daylight scenes are rare.",
    "Car photography: car type, setting, camera angle; off-road cars get dirt roads.",
    "Fashion editorial: garment, fabric, pose, backdrop colour that contrasts the garment.",
    "Medieval town scenes: building, trade, crowd density, market day or not.",
    "Underwater scenes: depth zone, creatures that live at that depth, light level.",
    "Space art: celestial body, colour palette, viewpoint; no atmosphere glow on moons.",
    "Portrait lighting pack: lighting style, background, lens; rim light needs a dark "
    "background.",
    "Fantasy creatures: creature, size, element; fire creatures never live in water.",
    "Steampunk inventors: invention, workshop, outfit, a title from the invention.",
    "Interior design: room, style, colour scheme; minimalist rooms get muted colours.",
    "Sports action shots: sport, venue that fits the sport, moment, crowd.",
    "Mythology pack: pantheon, deity, symbol that belongs to the deity, setting.",
    "Post-apocalyptic survivors: role, gear that fits the role, ruin type, weather.",
    "Cozy cafe scenes: drink, pastry, seating, time of day; hot drinks in winter.",
    "Pixel art game sprites: character class, palette, pose; mages get staffs.",
    "Botanical illustrations: plant, part shown, art style; cacti never get leaves.",
    "Superhero pack: power, costume colours, city, a hero name built from the power.",
    "Wedding photography: venue, season, dress style, flowers in season.",
    "A simple pack: just a colour wildcard and a shape wildcard and a template.",
    # Each of these needs one feature; `feature` scores whether the pack used it.
    ("Winter clothes: a scarf, a hat and mittens, each in a warm colour drawn from one shared "
     "colour list.", "ref_filter"),
    ("Outfits and shoes: the shoes must match the outfit (sneakers with casual, heels with "
     "formal, boots with either).", "accepts"),
    ("Portraits where the person wears a hat about 30% of the time.", "null"),
    ("Fantasy adventurers carrying 2 to 3 accessories each.", "multi_pick"),
    ("Pets with a collar colour; rules narrow the colours a lot, but it must never come out "
     "empty.", "fallback"),
    ("Portraits of a subject I type in myself, with a background and lighting that suit "
     "a portrait.", "input"),
    ("A character pack that works on both Pony and Flux checkpoints, with tags for Pony and "
     "sentences for Flux.", "model"),
    ("An anime style preset with quality tags and its own negatives.", "preset_negatives"),
    ("A comic batch: the same hero in every image of a loop, with a different scene each "
     "time.", "hold"),
]

#: Not in the full run: a rule on a list that another wildcard draws from,
#: and a target that takes more than one source value.
EXTRA = [
    ("Shirts by season, the colour drawn from one shared colour list; winter never gets "
     "pastel colours.", "ref_filter"),
    ("Outfits and shoes: boots go with both casual and formal outfits, sneakers only with "
     "casual, heels only with formal.", "accepts"),
]

#: A shorter run (about a third of the time): a few plain packs, every
#: feature request, and `EXTRA`.
SMOKE = [REQUESTS[i] for i in (1, 2, 6, 29)] + REQUESTS[30:] + EXTRA


def _wildcards(result: dict[str, Any]) -> list[dict[str, Any]]:
    kinds = {i["key"]: i["kind"] for i in result["plan"]["items"]}
    return [b["payload"] for k, b in result["built"].items() if kinds.get(k) == "wildcard"]


def _uses(result: dict[str, Any]) -> str:
    return " ; ".join(i.get("use") or "" for i in result["plan"]["items"])


#: Whether a built pack used the feature its request calls for.
FEATURES: dict[str, Any] = {
    # A draw from a shared list (`@{id}`, or `@{id:tag}` when narrowed): the
    # request's list holds warm colours only, so no `:filter` is needed.
    "ref_filter": lambda r: any("@{" in o.get("value", "")
                                for w in _wildcards(r) for o in w.get("options") or []),
    "accepts": lambda r: any("accepts" in (w.get("tag_group_kinds") or {}).values()
                             for w in _wildcards(r)),
    "null": lambda r: any(o.get("is_null") for w in _wildcards(r)
                          for o in w.get("options") or []),
    "multi_pick": lambda r: "pick" in _uses(r),
    "fallback": lambda r: any(o.get("fallback") for w in _wildcards(r)
                              for o in w.get("options") or []),
    "input": lambda r: bool(r["plan"].get("inputs")),
    "model": lambda r: "$model_" in json.dumps(r["built"]) or "model_variant" in json.dumps(
        r["built"]),
    "preset_negatives": lambda r: any(
        i["kind"] == "fixed_values" and any(v.get("negative") for v in
                                            r["built"].get(i["key"], {}).get("payload", {})
                                            .get("values") or [])
        for i in r["plan"]["items"]),
    "hold": lambda r: "hold" in _uses(r),
}


def _relations(r: dict[str, Any]) -> list[dict[str, Any]]:
    graph = r["plan"].get("graph")
    return list(graph.get("relations") or []) if isinstance(graph, dict) else []


#: The features the code adds by itself once the plan calls for them, read
#: from the model's own graph instead: every agree / only source becomes
#: accepts, every narrowed slot gets a fallback, the tidy adds empty options.
#: Counted from the BUILT pack, those passed with the model doing nothing.
PLANNED: dict[str, Any] = {
    "accepts": lambda r: any(x.get("kind") == "accepts" for x in _relations(r)),
    "null": lambda r: any((s.get("sometimes_none") or 0) > 0
                          for s in (r["plan"].get("graph") or {}).get("slots") or []),
    # The model can't write a fallback; it can write the rule that needs one.
    "fallback": lambda r: any(x.get("kind") in ("agree", "accepts", "only", "exclude")
                              for x in _relations(r)),
}


def feature_scores(feature: str, result: dict[str, Any]) -> dict[str, Any]:
    """``feature_used``: the model asked for the feature (its graph, for the
    ones in `PLANNED`), else the built pack has it; ``feature_built``: the
    built pack has it, whoever added it."""
    built = bool(FEATURES[feature](result))
    planned = PLANNED.get(feature)
    if planned is None or not isinstance(result["plan"].get("graph"), dict):
        return {"feature": feature, "feature_used": built, "feature_built": built}
    return {"feature": feature, "feature_used": bool(planned(result)), "feature_built": built}


def _score(result: dict[str, Any]) -> dict[str, Any]:
    plan = result["plan"]
    total = len(plan["items"])
    built = len(result["built"])
    check = result["check"] or {}
    problems = sum(len(v) for v in (check.get("problems") or {}).values()) \
        + len(check.get("notes") or [])
    # A rule that never fired in the runs can't be judged: counted apart,
    # never as a break (118d showed "0 of 0 runs broke it" as ✗).
    rels = [r for r in check.get("relations") or [] if r.get("checked")]
    checked = [r for r in rels if r.get("seen") or r.get("holds")]
    return {
        "items": total, "built": built, "built_share": round(built / total, 2) if total else 0,
        "problems": problems if check else None, "clean": bool(check) and problems == 0,
        "prompts": [p["text"] for p in check.get("prompts") or []],
        # wired: relations that held on the engine runs (graph plans only).
        "relations": len(checked), "held": sum(1 for r in checked if r.get("holds")),
        "unfired": len(rels) - len(checked),
        "distinct": check.get("distinct") if check else None,
        # fell: the worst slot's share of runs where its rules left nothing
        # and the fallback stood in (graph plans only).
        "fell": round(max(check.get("fallbacks", {}).values(), default=0)
                      / check["runs"], 2) if check and check.get("runs") else None,
    }


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "pack"


def _item_lines(plan: dict[str, Any], built: dict[str, Any], item: dict[str, Any]) -> list[str]:
    """One readable line per thing an item holds (an option, a cell, a
    rule), from its built payload."""
    from engine.ai import derivation as ai_derivation
    from engine.ai import wildcard as ai_wildcard

    pl = built[item["key"]]["payload"]
    kind = item["kind"]
    if kind in ("wildcard", "library"):
        lines = [ai_wildcard.option_line(o) for o in pl.get("options") or [] if isinstance(o, dict)]
        groups = pl.get("tag_groups") or {}
        kinds = pl.get("tag_group_kinds") or {}
        for name, tags in groups.items():
            lines.append(f"axis {name} ({kinds.get(name, 'classify')}): {', '.join(tags)}")
        return lines
    if kind == "derivation":
        return [ai_derivation.describe_rule(r) for r in pl.get("rules") or []
                if isinstance(r, dict)]
    if kind == "constraint":
        names = {built[i["key"]]["id"]: i["name"] for i in plan["items"] if i["key"] in built}
        src = names.get(pl.get("source_wildcard_id"), "?")
        dst = names.get(pl.get("target_wildcard_id"), "?")
        lines = [f"{src} → {dst}"]
        for st, row in (pl.get("matrix") or {}).items():
            for tt, cell in (row or {}).items():
                f = cell.get("factor", 1)
                lines.append(f"{st} → {tt}: {cell.get('mode')}" + (f" ×{f}" if cell.get("mode") in
                                                                   ("boost", "reduce") else ""))
        for e in pl.get("exceptions") or []:
            lines.append(f"{e.get('source_value')} → {e.get('target_value')}: {e.get('mode')}")
        return lines
    if kind == "fixed_values":
        return [f"${v.get('name')} = {v.get('value')}" + (f" [neg: {v['negative']}]"
                                                           if v.get("negative") else "")
                for v in pl.get("values") or [] if isinstance(v, dict)]
    if kind == "combine":
        return [f"${item['var']} = {pl.get('template')}"]
    if kind == "template":
        return [pl.get("template_string") or ""] + (
            [f"negative: {pl['negative_template']}"] if pl.get("negative_template") else [])
    return [json.dumps(pl)[:200]]


def sample_prompts(plan: dict[str, Any], built: dict[str, Any], n: int = 12) -> list[str]:
    """``n`` rendered prompts from the built pack, as the check renders them."""
    import copy

    from engine.pipeline import PipelineEngine

    tpl = pack._template(plan, built)
    if tpl is None:
        return []
    item, text = tpl
    neg = built[item["key"]]["payload"].get("negative_template") or ""
    modules = pack.chain_modules(plan, built)
    rows = [r for r in pack._built_rows(plan, built) if r["type"] == "wildcard"]
    catalog = pack.ref_catalog(modules, rows)
    pinned = pack.pins(plan)
    frames = pack.loop_frames(plan)
    out = []
    for seed in range(1, n + 1):
        try:
            frame = pack.frame_pins(pack.frame_of(seed, frames), frames) if frames else {}
            ctx = PipelineEngine().run(copy.deepcopy(modules),
                                       ctx={**pinned, **frame, "__wp_catalog__": catalog},
                                       seed=seed)
            prompt, negative = pack.render(text, neg, ctx)
            out.append(prompt + (f"  ⟂ {negative}" if negative else ""))
        except Exception as exc:  # noqa: BLE001 - shown, not raised
            out.append(f"(seed {seed} failed: {exc})")
    return out


def pack_sheet(request: str, result: dict[str, Any]) -> str:
    """A readable sheet of one built pack: what the model planned, every
    item's contents, the check and sample prompts."""
    plan, built, check = result["plan"], result["built"], result.get("check") or {}
    lines = [f"# {plan.get('title') or 'Pack'}", "", f"Request: {request}", ""]
    for key, label in (("summary", "Summary"), ("design", "How it fits together")):
        if plan.get(key):
            lines += [f"{label}: {plan[key]}", ""]
    lines.append(f"Style: {plan.get('style')}; rating: {plan.get('rating')}; "
                 f"anchor: ${plan.get('anchor') or '-'}; planner: "
                 f"{'graph' if plan.get('graph') else 'items'}")
    graph = plan.get("graph")
    if isinstance(graph, dict):
        lines += ["", "## Graph", ""]
        for s in graph["slots"]:
            axes = "; ".join(f"{a['name']}: {', '.join(a['values'])}" for a in s["axes"])
            lines.append(f"- slot {s['name']} (${s['var']}, {s['show']}"
                         + (f", pick {s['pick']}" if s["pick"] else "") + f"): {s['what']}"
                         + (f" — axes {axes}" if axes else ""))
        for r in graph["relations"]:
            lines.append(f"- relation: {pack.graph._slot_rel_words(r)}")
        for b in plan.get("bad_refs") or []:
            lines.append(f"- dropped: {b}")
    problems = check.get("problems") or {}
    lines += ["", "## Items", ""]
    for i in plan["items"]:
        head = f"### {i['name']} ({i['kind']}" + (f", ${i['var']}" if i.get("var") else "") \
            + (f", use: {i['use']}" if i.get("use") else "") + ")"
        lines += [head, ""]
        if i.get("about"):
            lines.append(f"_{i['about']}_")
        if i["key"] not in built:
            lines += ["(not built)", ""]
            continue
        lines += [f"- {x}" for x in _item_lines(plan, built, i)]
        for p in problems.get(i["key"], []):
            lines.append(f"- ⚠ {p}")
        lines.append("")
    lines += ["## Check", ""]
    if check:
        lines.append(f"{check.get('runs')} runs, {check.get('failed')} failed, "
                     f"{sum(len(v) for v in problems.values())} item problems, "
                     f"{len(check.get('notes') or [])} notes"
                     + (f", distinct prompts {check['distinct']}" if check.get("distinct") is not
                        None else ""))
        lines += [f"- note: {n}" for n in check.get("notes") or []]
        listed = {i["key"] for i in plan["items"] if i["key"] in built}
        lines += [f"- ⚠ {k or 'pack'}: {p}" for k, ps in problems.items() if k not in listed
                  for p in ps]
        for r in check.get("relations") or []:
            unfired = r["checked"] and not r["holds"] and not r.get("seen")
            mark = "✓" if r["holds"] else "○" if unfired else ("✗" if r["checked"] else "·")
            lines.append(f"- {mark} {r['text']}" + (
                " (never fired)" if unfired else
                f" ({r['broken']} of {r['seen']} runs broke it)"
                if r["checked"] and not r["holds"] else ""))
    else:
        lines.append("(no check)")
    lines += ["", "## Sample prompts", ""]
    lines += [f"{n}. {p}" for n, p in enumerate(sample_prompts(plan, built), 1)]
    if result.get("log"):
        lines += ["", "## Build log", ""] + [f"- {x}" for x in result["log"]]
    return "\n".join(lines) + "\n"


def save_pack(folder: Path, n: int, request: str, result: dict[str, Any]) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    base = folder / f"{n:02d}-{_slug(request)}"
    base.with_suffix(".md").write_text(pack_sheet(request, result), encoding="utf-8")
    base.with_suffix(".json").write_text(
        json.dumps({"request": request, "plan": result["plan"], "built": result["built"],
                    "check": result.get("check"), "log": result.get("log")}, indent=2),
        encoding="utf-8")
    return base.with_suffix(".md")


async def evaluate(complete: Any, requests: list[Any], *, seeds: int = 100,
                   settings: dict | None = None, save: Path | None = None,
                   only: set[int] | None = None) -> list[dict]:
    """``requests``: text, or ``(text, feature)`` to also score a feature.
    ``settings`` are the pack settings (``planner`` picks the graph or the
    item-list planner). With ``save``, every built pack is written there as
    a readable sheet and JSON (``save_pack``). ``only``: the request
    numbers to run (1-based, as the report numbers them)."""
    rows = []
    for n, entry in enumerate(requests, 1):
        if only and n not in only:
            continue
        req, feature = entry if isinstance(entry, tuple) else (entry, "")
        started = time.perf_counter()
        try:
            result = await pack.run_pack(complete, req, seeds=seeds, settings=settings)
        except Exception as e:  # noqa: BLE001 - every request is scored
            rows.append({"request": req, "plan": False, "feature": feature,
                         "error": f"{type(e).__name__}: {e}",
                         "seconds": round(time.perf_counter() - started, 1)})
            continue
        if save is not None:
            try:
                save_pack(save, n, req, result)
            except Exception as e:  # noqa: BLE001 - a sheet that fails is said, not fatal
                print(f"could not save pack {n}: {type(e).__name__}: {e}")
        rows.append({"request": req, "plan": True, **_score(result),
                     **(feature_scores(feature, result) if feature else {}),
                     "log": result["log"][-12:],
                     "seconds": round(time.perf_counter() - started, 1)})
    return rows


def report(rows: list[dict], model: str) -> str:
    planned = [r for r in rows if r["plan"]]
    clean = [r for r in planned if r.get("clean")]
    share = sum(r["built_share"] for r in planned) / len(planned) if planned else 0
    checked = [r for r in planned if r.get("check") is not False and r.get("distinct") is not None]
    distinct = sum(r["distinct"] for r in checked) / len(checked) if checked else 0
    held = sum(r.get("held") or 0 for r in planned)
    relations = sum(r.get("relations") or 0 for r in planned)
    tight = [r for r in planned if (r.get("fell") or 0) >= 0.3]
    lines = [
        f"# Pack builder evals: {model}", "",
        f"- Requests: {len(rows)}",
        f"- Plans that compiled: {len(planned)} / {len(rows)}",
        f"- Items built (mean share): {share:.0%}",
        f"- Packs with a clean test run: {len(clean)} / {len(rows)}",
        f"- Feature requests that used the feature: "
        f"{sum(1 for r in planned if r.get('feature_used'))} / "
        f"{sum(1 for r in rows if r.get('feature'))} (built pack has it: "
        f"{sum(1 for r in planned if r.get('feature_built'))}; accepts, null and fallback "
        "count only when the model's graph asks for them)",
        f"- Relations that held on the test runs (wired): {held} / {relations}"
        f" (never fired, not counted: {sum(r.get('unfired') or 0 for r in planned)})",
        f"- Distinct prompts per run (mean): {distinct:.2f}",
        f"- Packs where a slot fell back in 30% or more of the runs: {len(tight)} / "
        f"{len(planned)}", "",
        "| # | Request | Plan | Built | Problems | Wired | Distinct | Fell | Seconds |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for n, r in enumerate(rows, 1):
        req = r["request"][:70].replace("|", "/")
        if not r["plan"]:
            lines.append(f"| {n} | {req} | no: {r['error'][:60]} | | | | | | {r['seconds']} |")
            continue
        feat = f" ({r['feature']}: {'used' if r['feature_used'] else 'missing'}" \
            + (", code added it" if r.get("feature_built") and not r["feature_used"] else "") \
            + ")" if r.get("feature") else ""
        wired = f"{r['held']}/{r['relations']}" if r.get("relations") else "-"
        distinct_s = f"{r['distinct']:.2f}" if r.get("distinct") is not None else "-"
        fell = f"{r['fell']:.0%}" if r.get("fell") is not None else "-"
        lines.append(f"| {n} | {req}{feat} | yes | {r['built']}/{r['items']} | "
                     f"{r['problems']} | {wired} | {distinct_s} | {fell} | {r['seconds']} |")
    lines += ["", "## Sample prompts", ""]
    for r in planned:
        if r["prompts"]:
            lines.append(f"- {r['request'][:60]}: `{r['prompts'][0][:200]}`")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--set", choices=("full", "smoke"), default="full",
                    help="smoke: a shorter run of plain packs, every feature request and "
                         "two rule-on-a-drawn-list / accepts packs")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="",
                    help="run only these request numbers, e.g. 11,15 (as the report numbers them)")
    ap.add_argument("--model", default="")
    ap.add_argument("--seeds", type=int, default=100)
    ap.add_argument("--out", default="pack-evals.md")
    ap.add_argument("--save", default="",
                    help="folder to keep every built pack in (a readable .md and a .json each)")
    ap.add_argument("--planner", choices=("graph", "items"), default="graph",
                    help="graph: the model writes slots, axes and relations and the code "
                         "wires the pack; items: the model writes every item and payload")
    ap.add_argument("--drafts", choices=("auto", "one", "three"), default="auto",
                    help="plan drafts on the first plan (the Plan drafts setting)")
    args = ap.parse_args()
    from wp_api import _ai_client

    cfg = ai_config.load_effective()
    if args.model:
        cfg = {**cfg, "model": args.model}
    if not cfg.get("model"):
        print("No model set. Pick one under Settings › AI assistant, or pass --model.")
        return 0

    async def complete(**kwargs: Any) -> Any:
        return await _ai_client.complete_json(cfg, **kwargs)

    requests = SMOKE if args.set == "smoke" else REQUESTS
    rows = asyncio.run(evaluate(complete, requests[: args.limit or len(requests)], seeds=args.seeds,
                                settings={"planner": args.planner, "drafts": args.drafts},
                                save=Path(args.save) if args.save else None,
                                only={int(x) for x in args.only.split(",") if x.strip().isdigit()}))
    title = f"{cfg['model']} ({args.planner} planner, drafts: {args.drafts})"
    Path(args.out).write_text(report(rows, title), encoding="utf-8")
    Path(args.out).with_suffix(".json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
