"""Pack builder check: `check_pack` runs the pack on the engine and lists
what went wrong, plus the unread / repeat / variety analysis."""
from __future__ import annotations

import copy
import re
from typing import Any

from engine.ai import lint as ai_lint
from engine.ai import ratings as ai_ratings
from engine.ai.pack import graph as pack_graph
from engine.ai.pack._common import (
    CHECK_SEEDS,
    MAX_COUNT,
    SAMPLE_PROMPTS,
    TWIN_SEEDS,
    VERIFY_SEEDS,
    _chunks,
    _reads,
    is_wild,
)
from engine.ai.pack.build import _built_rows
from engine.ai.pack.layout import (
    _merge_reports,
    _template,
    chain_modules,
    extend_chain,
    frame_of,
    frame_pins,
    loop_frames,
    pins,
    ref_catalog,
    render,
)
from engine.ai.pack.plan import item_io
from engine.ai.pack.text_fixes import _combine_inputs


def check_pack(
    plan: dict[str, Any], built: dict[str, Any], *, seeds: int = CHECK_SEEDS,
    library: list[dict[str, Any]] | None = None, base: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run the pack on the engine. Returns ``{runs, failed, problems:
    {key: [text]}, notes: [text], variables: [{var, distinct, top}],
    prompts: [{seed, text, negative}], order: [key], relations: [...],
    distinct}`` (``order``: the items in run order; ``relations``: a graph
    plan's relations as ``verify_relations`` checked them, a broken one is
    also a note; ``distinct``: distinct prompts ÷ runs). ``problems`` are what an item's
    repair gets told; ``notes`` are pack-wide. Inputs are pinned to their
    examples; refs resolve against the pack and ``library``. With ``base``
    the bundle being extended runs too, as it will after install."""
    from engine.pipeline import PipelineEngine
    from engine.scenario import run_scenario

    modules = chain_modules(plan, built) if base is None else extend_chain(plan, built, base)
    rows = [*(r for r in library or [] if r.get("type") == "wildcard"),
            *(r for r in _built_rows(plan, built) if r["type"] == "wildcard")]
    catalog = ref_catalog(modules, rows)
    pinned = pins(plan)
    by_id = {}
    for i in plan["items"]:
        if i["key"] in built:
            by_id[built[i["key"]]["id"]] = i["key"]
    # Runtime warnings name the instance ("pack.3"), not the module id.
    for m in modules:
        if m.get("_uid") and m.get("id") in by_id:
            by_id[str(m["_uid"])] = by_id[m["id"]]
    problems: dict[str, list[str]] = {}
    notes: list[str] = []
    quality: list[dict[str, str]] = []
    missing = [i["name"] for i in plan["items"] if i["key"] not in built]
    if missing:
        notes.append("Not built: " + ", ".join(missing))
    for d in plan.get("dropped") or []:
        if isinstance(d, dict) and d.get("kind") == "constraint":
            notes.append(f"The plan's constraint {d.get('name')} isn't in the pack: {d.get('why')}")
    notes += unread_notes(plan, built, problems)
    # "Goes with" written as exclude drops options that carry both tags.
    row_by_id = {r.get("id"): r for r in rows}
    code_vars = {i["var"] for i in pack_graph.run_items(plan["graph"], plan.get("settings"))} \
        if isinstance(plan.get("graph"), dict) else set()
    for i in plan["items"]:
        if i["kind"] == "constraint" and i["key"] in built:
            for said in ai_lint.exclude_shared_tags(built[i["key"]]["payload"], row_by_id.get):
                problems.setdefault(i["key"], []).append(said)
        # A rule that maps one pick to another value by value is a wildcard
        # plus a constraint written out longhand (a 22-branch weather table).
        # Not the rules the code wires from the run (the story beat is
        # $iteration → $beat, one branch per frame, by design): a problem
        # there can't be rebuilt away, so Fix with AI looped on it (Sonnet
        # walkthrough, 2026-10-21).
        if i["kind"] == "derivation" and i["key"] in built and i["var"] not in code_vars:
            for said in ai_lint.derivation_shape(i["name"], built[i["key"]]["payload"]):
                if "value by value" in said:
                    problems.setdefault(i["key"], []).append(said)
    seed_list = list(range(1, max(1, seeds) + 1))
    frames = loop_frames(plan)
    if frames:
        # A story runs over a Loop: each seed plays one frame, so every beat
        # is checked (the Loop sets $iteration at run time).
        report = _merge_reports([
            run_scenario(modules, seeds=[x for x in seed_list if frame_of(x, frames) == f],
                         catalog=catalog, pins={**pinned, **frame_pins(f, frames)},
                         sample_limit=0, value_limit=MAX_COUNT + 20)
            for f in range(1, frames + 1) if any(frame_of(x, frames) == f for x in seed_list)])
    else:
        report = run_scenario(modules, seeds=seed_list, catalog=catalog, pins=pinned,
                              sample_limit=0, value_limit=MAX_COUNT + 20)
    fallbacks: dict[str, int] = {}
    for w in report["warnings"]:
        key = by_id.get(str(w.get("owner_id") or w.get("module_id") or ""))
        detail = _got if isinstance(_got := w.get("detail"), dict) else {}
        what = detail.get("hint") or w.get("message") or w.get("type")
        text = f"{what} ({w['count']} of {report['runs']} runs)"
        if key and w.get("type") == "fallback_used":
            fallbacks[key] = fallbacks.get(key, 0) + int(w.get("count") or 0)
        if key:
            problems.setdefault(key, []).append(text)
        else:
            notes.append(text)
    notes += _tight_rules(plan, fallbacks, report["runs"])
    if report["failed"]:
        notes.append(f"{report['failed']} of {report['runs']} runs failed")
    variables = []
    for i in plan["items"]:
        if i["kind"] in ("wildcard", "library", "derivation", "combine", "fixed_values") \
                and i["var"]:
            v = report["variables"].get(i["var"])
            if v is None:
                if i["key"] in built:
                    problems.setdefault(i["key"], []).append(f"${i['var']} was never set")
                continue
            total = sum(v["counts"].values()) + v["other"]
            top = [{"value": k, "share": round(n / total, 3) if total else 0}
                   for k, n in list(v["counts"].items())[:3]]
            variables.append({"var": i["var"], "distinct": v["distinct"], "top": top})
            if i["kind"] == "wildcard" and i["key"] in built and total:
                quality += _variety(i, built[i["key"]]["payload"], v, total, plan)
    # Two variables that hold the same text run after run: one is a copy.
    owned = [i for i in plan["items"] if i["var"] and i["key"] in built
             and i["kind"] not in ("constraint", "template")]
    runs: list[dict[str, Any]] = []
    # A graph plan's relations are checked on these runs too: more of them.
    for seed in seed_list[:VERIFY_SEEDS if isinstance(plan.get("graph"), dict) else TWIN_SEEDS]:
        try:
            runs.append(PipelineEngine().run(copy.deepcopy(modules),
                                             ctx={**pinned, "__wp_catalog__": catalog}, seed=seed))
        except Exception:  # noqa: BLE001 - a failed run is reported above
            continue
    seen: list[dict[str, Any]] = []
    for i in owned:
        vals = [str(ctx.get(i["var"]) or "").strip() for ctx in runs]
        if not runs or not all(vals):
            continue
        # A rule that rewrites a variable another item set is one variable,
        # not a copy of it.
        twin = next((o for o in seen if o["vals"] == vals and o["var"] != i["var"]), None)
        if twin is not None:
            problems.setdefault(i["key"], []).append(
                f"${i['var']} always holds the same text as ${twin['var']}; drop one or make "
                "them say different things")
        else:
            seen.append({"var": i["var"], "vals": vals})
    tpl = _template(plan, built)
    rendered: list[str] = []
    if tpl is not None and isinstance(plan.get("graph"), dict):
        neg0 = built[tpl[0]["key"]]["payload"].get("negative_template") or ""
        for ctx in runs:
            try:
                rendered.append(render(tpl[1], neg0, ctx)[0].lower())
            except Exception:  # noqa: BLE001 - a failed run is reported elsewhere
                rendered.append("")
    relations = pack_graph.verify_relations(plan, built, runs, rendered or None)
    for r in relations:
        if r["checked"] and not r["holds"]:
            notes.append(f"Rule never fired in the {len(runs)} test runs: {r['text']}"
                         if r.get("why") else
                         f"Rule broken in {r['broken']} of {r['seen']} runs: {r['text']}")
    prompts: list[dict[str, Any]] = []
    distinct = 0.0
    if tpl is not None:
        item, text = tpl
        set_vars = set(report["variables"]) | set(pinned) | (
            {"iteration", "iteration_total"} if frames else set())
        unset = [v for v in _reads(text) if v not in set_vars]
        if unset:
            problems.setdefault(item["key"], []).append(
                "reads $" + ", $".join(unset) + ", which no run set")
        neg = built[item["key"]]["payload"].get("negative_template") or ""
        braces = 0
        for seed in seed_list[:SAMPLE_PROMPTS]:
            try:
                frame = frame_pins(frame_of(seed, frames), frames) if frames else {}
                ctx = PipelineEngine().run(copy.deepcopy(modules),
                                           ctx={**pinned, **frame, "__wp_catalog__": catalog},
                                           seed=seed)
                prompt, negative = render(text, neg, ctx)
                if re.search(r"[{}]|@\{", prompt):
                    braces += 1
                prompts.append({"seed": seed, "text": prompt, "negative": negative})
            except Exception as exc:  # noqa: BLE001 - shown, not raised
                prompts.append({"seed": seed, "text": f"(failed: {exc})", "negative": ""})
        distinct = _distinct(runs, text, neg)
        for k, said in _repeats(plan, built, runs, text, neg).items():
            problems.setdefault(k, []).append(said)
        for k, said in _overlaps(plan, built, text).items():
            problems.setdefault(k, []).append(said)
        for said in _unseen(plan, built, runs, text, neg):
            if not any(said.split(")")[0] in p for p in problems.get(item["key"], [])):
                problems.setdefault(item["key"], []).append(said)
        for k, said in _lists_all(plan, built, runs).items():
            problems.setdefault(k, []).append(said)
        for k, said in _printed_names(plan, built, runs, text, neg).items():
            problems.setdefault(k, []).append(said)
        from engine.ai import pack_tidy
        tested = pack_tidy.runs(plan, built, library=library, base=base)
        for k, said in pack_tidy.rule_breaks(plan, built, tested).items():
            problems.setdefault(k, []).append(said)
        for k, said in pack_tidy.dead_ends(plan, built).items():
            problems.setdefault(k, []).append(said)
        for k, said in pack_tidy.missing_attributes(plan, built, tested).items():
            problems.setdefault(k, []).append(said)
        for k, said in _literal_names(owned, runs, prompts, item["key"], set(unset)).items():
            problems.setdefault(k, []).append(said)
        mixed = [lv for p in prompts if len(lv := ai_ratings.rating_levels(p["text"])) > 1]
        if mixed:
            problems.setdefault(item["key"], []).append(
                f"{len(mixed)} of {len(prompts)} sample prompts say two ratings at once ("
                + ", ".join(f"rating_{x}" for x in mixed[0])
                + "); keep one rating tag per prompt")
        if braces:
            problems.setdefault(item["key"], []).append(
                "the prompt shows { } or @{ } as written: a variable it reads holds a pick "
                "the Assembler can't make")
    # The items in the order they run (the order install keeps), for the
    # Build list: build order puts every constraint last, which reads wrong.
    order = list(dict.fromkeys(by_id[str(m["_uid"])] for m in modules
                               if str(m.get("_uid")) in by_id))
    return {"runs": report["runs"], "failed": report["failed"], "problems": problems,
            "notes": notes, "variables": variables, "prompts": prompts, "quality": quality,
            "order": order, "relations": relations, "distinct": distinct,
            "fallbacks": fallbacks}


_NAME = re.compile(r"\$[A-Za-z_]\w*")


def _literal_names(owned: list[dict[str, Any]], runs: list[dict[str, Any]],
                   prompts: list[dict[str, Any]], tpl_key: str,
                   unset: set[str]) -> dict[str, str]:
    """A ``$name`` printed as written in the prompt: a value holds a
    variable name the Assembler doesn't fill in again (9B smoke, comic
    hero, 2026-10-24: "$style, 1hero, solo, $hero, …"). Filed on the item
    whose value holds it, else on the template."""
    seen = {m for p in prompts for m in _NAME.findall(p["text"])} - {f"${v}" for v in unset}
    if not seen:
        return {}
    out: dict[str, str] = {}
    for i in owned:
        names = sorted({m for ctx in runs for m in _NAME.findall(str(ctx.get(i["var"]) or ""))})
        if names:
            out[i["key"]] = (f"${i['var']} holds {', '.join(names[:3])} as written, and the "
                             "prompt prints it: write the words, or read the variable from the "
                             "template instead")
    if not out:
        names = sorted(seen)
        out[tpl_key] = (f"the prompt prints {', '.join(names[:3])} as written: nothing fills "
                        "it in")
    return out


#: The share of runs a slot may fall back in before its rules count as too
#: tight: a rule that empties the pool most of the time isn't choosing.
TIGHT_SHARE = 0.3


def _tight_rules(plan: dict[str, Any], fallbacks: dict[str, int], runs: int) -> list[str]:
    """A note per slot whose fallback stood in for ``TIGHT_SHARE`` or more
    of the runs, naming the relations that narrow it: the pool those leave
    is empty most of the time, so the pack isn't choosing (landscape,
    2026-10-19: 84 of 100 runs)."""
    graph = plan.get("graph")
    out: list[str] = []
    if not runs or not isinstance(graph, dict):
        return out
    for key, n in fallbacks.items():
        if n / runs < TIGHT_SHARE:
            continue
        item = next((i for i in plan["items"] if i["key"] == key), None)
        slot = pack_graph.slot_by_var(graph, item["var"]) if item else None
        if slot is None:
            continue
        rules = [pack_graph._slot_rel_words(r) for r in pack_graph.inbound(graph, slot)]
        out.append(f"{slot['name']}: its rules leave nothing in {n} of {runs} runs, so the "
                   "fallback stands in; loosen one of them"
                   + (" (" + "; ".join(rules[:4]) + ")" if rules else "")
                   + " or add options that fit more of them")
    return out


def _distinct(runs: list[dict[str, Any]], text: str, neg: str) -> float:
    """Distinct prompts over the runs ÷ runs: a pack that collapsed to one
    prompt scores near 0, one that never repeats 1."""
    shown: set[str] = set()
    for ctx in runs:
        try:
            shown.add(render(text, neg, ctx)[0].strip().lower())
        except Exception:  # noqa: BLE001 - a failed run is reported elsewhere
            continue
    return round(len(shown) / len(runs), 2) if runs else 0.0


def _lists_all(plan: dict[str, Any], built: dict[str, Any],
               runs: list[dict[str, Any]]) -> dict[str, str]:
    """An item whose text lists most of a wildcard's options (every hair
    style, every weapon) prints them all in one prompt: ``{key: problem}``."""
    wild = [(i, [c for o in built[i["key"]]["payload"].get("options") or []
                 if isinstance(o, dict) for c in sorted(_chunks(str(o.get("value") or "")))[:1]])
            for i in plan["items"] if is_wild(i) and i["key"] in built]
    writers = [(i, item_io(i, built[i["key"]]["payload"])[1]) for i in plan["items"]
               if i["key"] in built and i["kind"] in ("fixed_values", "combine", "derivation",
                                                      "wildcard", "library")]
    out: dict[str, str] = {}
    for w, heads in wild:
        if len(heads) < 4:
            continue
        for i, sets in writers:
            if i is w or i["key"] in out:
                continue
            hit = 0
            for ctx in runs:
                low = ", ".join(str(ctx.get(v) or "") for v in sets).lower()
                named = sum(bool(re.search(r"(?<!\w)" + re.escape(h) + r"(?!\w)", low))
                            for h in heads)
                hit += named >= max(4, len(heads) * 3 // 5)
            if runs and hit * 2 >= len(runs):
                out[i["key"]] = (f"it lists most of {w['name']}'s options at once, so every "
                                 f"prompt shows them all; read ${w['var']} instead")
    return out


def _printed_names(plan: dict[str, Any], built: dict[str, Any], runs: list[dict[str, Any]],
                   text: str, neg: str) -> dict[str, str]:
    """A tag or variable name printed as prompt text ("summer_outer"):
    ``{key of the item whose variable holds it: problem}``, when it shows
    in at least a sixth of the runs."""
    names = {n.lower() for i in plan["items"] for n in [i.get("var") or ""] if "_" in n}
    # In tags style an option may be its own booru tag ("long_hair").
    for i in [] if plan.get("style") == "tags" else plan["items"]:
        if is_wild(i) and i["key"] in built:
            pl = built[i["key"]]["payload"]
            names |= {str(t).lower() for t in pl.get("sub_categories") or [] if "_" in str(t)}
            names |= {str(t).lower() for t in i.get("tags") or [] if "_" in str(t)}
    # Pony's score, source and rating tags are prompt words, not names
    # (bench Z19: "rating_explicit" was reported as one).
    names = {n for n in names if not pack_graph.PONY_ONLY.fullmatch(n)}
    if not names:
        return {}
    writers = [(i, item_io(i, built[i["key"]]["payload"])[1]) for i in plan["items"]
               if i["key"] in built and i["kind"] != "template"]
    hits: dict[str, list[str]] = {}
    for ctx in runs:
        for i, sets in writers:
            for v in sets:
                chunks = {re.sub(r"\s+", " ", x).strip().lower().lstrip("#$")
                          for x in str(ctx.get(v) or "").split(",")}
                for c in sorted(chunks & names):
                    hits.setdefault(i["key"], []).append(c)
    out: dict[str, str] = {}
    need = max(2, len(runs) // 6)
    for k, got in hits.items():
        if len(got) >= need:
            shown = ", ".join(f'"{w}"' for w in dict.fromkeys(got))
            out[k] = (f"it puts a tag or variable name in the prompt as text ({shown}); "
                      "write words a picture shows instead")
    return out


def _unseen(plan: dict[str, Any], built: dict[str, Any], runs: list[dict[str, Any]],
            text: str, neg: str) -> list[str]:
    """Picks that are set but never show in the prompt: only a rule reads
    them, to decide something else (the time of day only picks the
    lighting). The image never says it, which is rarely what was asked."""
    shown: list[str] = []
    for ctx in runs:
        try:
            shown.append(render(text, neg, ctx)[0].lower())
        except Exception:  # noqa: BLE001 - a failed run is reported elsewhere
            shown.append("")
    out: list[str] = []
    for i in plan["items"]:
        if not is_wild(i) or i["key"] not in built or "internal" in (i.get("use") or ""):
            continue
        seen = had = 0
        for ctx, prompt in zip(runs, shown, strict=True):
            value = str(ctx.get(i["var"]) or "").strip().lower()
            if not value:
                continue
            had += 1
            chunks = list(_chunks(value)) or [value]
            if any(c in prompt for c in chunks):
                seen += 1
        if had and had * 2 >= len(runs) and not seen:
            out.append(f"${i['var']} ({i['name']}) never reaches the prompt: what reads it "
                       "doesn't print it; read it here too")
    return out


def _overlaps(plan: dict[str, Any], built: dict[str, Any], text: str) -> dict[str, str]:
    """A wildcard whose options already name what another one the prompt
    shows picks (an outfit "…, chinos, loafers" next to a shoes pick):
    ``{key: problem}``. Two shoes then show in one prompt."""
    shown = set(_reads(text))
    wild = [(i, [str(o.get("value") or "") for o in built[i["key"]]["payload"].get(
        "options") or [] if isinstance(o, dict)]) for i in plan["items"]
        if is_wild(i) and i["key"] in built and i["var"] in shown]
    out: dict[str, str] = {}
    for a, a_opts in wild:
        a_chunks = {c for o in a_opts for c in _chunks(o)}
        a_heads = {c.split()[-1] for c in a_chunks}
        # The head noun most of A's options end in ("eyes" for an Eyes
        # pick) is A's own subject: B's "gentle eyes" borrows it, A's
        # "blue eyes" doesn't, so no hit on it counts against A (Sonnet 5.5,
        # 2026-10-21: Fix Eyes with AI could never clear "names what
        # $expression picks: gentle eyes, half-closed eyes").
        a_all = [c.split()[-1] for o in a_opts for c in _chunks(o)]
        a_subject = {h for h in set(a_all) if a_all.count(h) * 2 > len(a_all)}
        for b, b_opts in wild:
            if b is a or a["key"] in out:
                continue
            b_chunks = [c for o in b_opts for c in sorted(_chunks(o))[:1]]
            heads = [c.split()[-1] for c in b_chunks]
            # A head noun most of B's options share ("hair") names B's
            # subject, not one pick: only full matches count for it.
            hits = sorted({c for c, h in zip(b_chunks, heads, strict=True)
                           if h not in a_subject
                           and (c in a_chunks
                                or (heads.count(h) * 2 <= len(heads) and h in a_heads
                                    and len(h) >= 4))})
            if len(hits) >= 2:
                out[a["key"]] = (
                    f"its options already name what ${b['var']} ({b['name']}) picks: "
                    + ", ".join(f'"{h}"' for h in hits[:4])
                    + f"; leave those to {b['name']}, or the prompt shows two")
    return out


def _repeats(plan: dict[str, Any], built: dict[str, Any], runs: list[dict[str, Any]],
             text: str, neg: str) -> dict[str, str]:
    """Two items that put the same words in the prompt ("masterpiece, best
    quality" in two presets, a time of day and a lighting rule both saying
    "golden hour"): ``{key of the later item: problem}``, when it happens
    in at least a quarter of the runs."""
    writers = [(i, item_io(i, built[i["key"]]["payload"])[1]) for i in plan["items"]
               if i["key"] in built and i["kind"] in ("wildcard", "library", "fixed_values",
                                                      "derivation")]
    seen: dict[tuple[str, str], int] = {}
    words: dict[tuple[str, str], list[str]] = {}
    for ctx in runs:
        try:
            prompt = render(text, neg, ctx)[0]
        except Exception:  # noqa: BLE001 - a failed run is reported elsewhere
            continue
        counts: dict[str, int] = {}
        for c in (re.sub(r"\s+", " ", x).strip().lower() for x in prompt.split(",")):
            counts[c] = counts.get(c, 0) + 1
        twice = {c for c, n in counts.items() if n > 1 and len(c) >= 3}
        if not twice:
            continue
        first: dict[str, str] = {}
        pairs: set[tuple[str, str]] = set()
        for i, sets in writers:
            for c in sorted(set().union(*(_chunks(str(ctx.get(v) or "")) for v in sets))
                            & twice):
                k = first.setdefault(c, i["key"])
                # A rule that adds to a variable another item set shares it.
                if k != i["key"] and not (sets & dict(
                        (w["key"], ws) for w, ws in writers)[k]):
                    pairs.add((k, i["key"]))
                    if c not in words.setdefault((k, i["key"]), []):
                        words[(k, i["key"])].append(c)
        for pair in pairs:
            seen[pair] = seen.get(pair, 0) + 1
        # A rule that adds words the variable already holds (a tundra rule
        # adding "thick fog" to weather that rolled it).
        for i, sets in writers:
            if i["kind"] != "derivation":
                continue
            for v in sets:
                parts = [re.sub(r"\s+", " ", x).strip().lower()
                         for x in str(ctx.get(v) or "").split(",")]
                dup = sorted({c for c in parts if len(c) >= 3 and parts.count(c) > 1} & twice)
                if dup:
                    pair = (i["key"], i["key"])
                    seen[pair] = seen.get(pair, 0) + 1
                    words.setdefault(pair, [])
                    words[pair] += [f"${v}: {c}" for c in dup if f"${v}: {c}" not in words[pair]]
                    break
    out: dict[str, str] = {}
    need = max(2, len(runs) // 6)
    items = {i["key"]: i for i in plan["items"]}
    for (a, b), n in seen.items():
        if n < need or b in out:
            continue
        shown = ", ".join(f'"{w}"' for w in words[(a, b)][:6])
        if a == b:
            out[b] = (f"it adds words the variable already holds, so the prompt says them "
                      f"twice: {shown}; add only what isn't there, or replace it")
            continue
        out[b] = (f"it repeats words ${items[a]['var']} ({items[a]['name']}) already puts in "
                  f"the prompt: {shown}; leave them to {items[a]['name']}")
    return out


def unread_notes(plan: dict[str, Any], built: dict[str, Any],
                 problems: dict[str, list[str]]) -> list[str]:
    """Built items whose variables nothing reads: a wildcard or preset the
    template never shows goes on the template's problems (its rebuild can
    read it); an unread combine or derivation is a pack note."""
    reads: set[str] = set()
    for i in plan["items"]:
        if i["key"] in built:
            reads |= item_io(i, built[i["key"]]["payload"])[0]
    ruled = {v for c in plan["items"] if c["kind"] == "constraint"
             for v in (c["source"], c["target"])}
    if plan.get("anchor"):
        ruled.add(plan["anchor"])
    # A list other options draw from (``@{id:tag}``) is read every run.
    drawn: set[str] = set()
    for b in built.values():
        for o in (b.get("payload") or {}).get("options") or []:
            if isinstance(o, dict) and isinstance(o.get("value"), str):
                drawn |= set(re.findall(r"@\{([0-9a-f]{8})", o["value"]))
    tpl = next((i for i in plan["items"] if i["kind"] == "template" and i["key"] in built), None)
    notes: list[str] = []
    for i in plan["items"]:
        if i["key"] not in built or not i["var"] or i.get("existing") \
                or i["kind"] in ("constraint", "template"):
            continue
        sets = item_io(i, built[i["key"]]["payload"])[1]
        if sets & reads or built[i["key"]].get("id") in drawn:
            continue
        if sets & ruled and "internal" in (i.get("use") or ""):
            continue  # a driver kept out of the prompt on purpose
        if sets & ruled and tpl is not None:
            # Other picks follow it, but the image never shows it (a
            # constraint's target that nothing reads changes nothing).
            problems.setdefault(tpl["key"], []).append(
                f"it doesn't read ${i['var']} ({i['name']}): a constraint uses it, but the "
                "prompt never shows it; read it")
            continue
        if sets & ruled:
            continue
        if i["kind"] == "derivation" and tpl is not None:
            # A rule the request asked for ("night gets moody lighting") that
            # the prompt never shows changes nothing.
            problems.setdefault(tpl["key"], []).append(
                f"it doesn't read ${i['var']} ({i['name']}), so that rule changes nothing in "
                "the prompt; read it")
        elif i["kind"] in ("combine", "derivation"):
            notes.append(f"Nothing reads ${i['var']}, so {i['name']} does nothing")
        elif tpl is not None:
            problems.setdefault(tpl["key"], []).append(
                f"it doesn't read ${i['var']} ({i['name']}), so that pick never reaches the "
                "prompt; read it")
        else:
            notes.append(f"Nothing reads ${i['var']} ({i['name']})")
    for inp in plan.get("inputs") or []:
        if inp["var"] in reads | ruled:
            continue
        if tpl is not None:
            problems.setdefault(tpl["key"], []).append(
                f"it doesn't read the input ${inp['var']}, so what the user gives never "
                "reaches the prompt; read it")
        else:
            notes.append(f"Nothing reads the input ${inp['var']}")
    # The template reading a variable and a combine of it prints it twice.
    if tpl is not None:
        shown = item_io(tpl, built[tpl["key"]]["payload"])[0]
        read_combos = [c for c in plan["items"] if c["kind"] == "combine"
                       and c["key"] in built and c["var"] in shown]
        for n, c in enumerate(read_combos):
            mine = set(_combine_inputs(plan, built, c["var"]))
            for d in read_combos[:n]:
                theirs = set(_combine_inputs(plan, built, d["var"]))
                if c["var"] in theirs or d["var"] in mine:
                    continue
                dup = sorted(mine & theirs)
                if dup:
                    problems.setdefault(c["key"], []).append(
                        f"it reads ${', $'.join(dup)}, which ${d['var']} ({d['name']}) "
                        "already joins, so the prompt shows it twice; leave it out")
                    break
        for c in plan["items"]:
            if c["kind"] != "combine" or c["key"] not in built or c["var"] not in shown:
                continue
            twice = sorted(item_io(c, built[c["key"]]["payload"])[0] & shown)
            if twice:
                problems.setdefault(tpl["key"], []).append(
                    f"it reads ${', $'.join(twice)} and ${c['var']} ({c['name']}), which "
                    "already holds it, so it shows twice; read one of them")
    return notes


def _variety(item: dict[str, Any], payload: dict[str, Any], v: dict[str, Any],
             total: int, plan: dict[str, Any]) -> list[dict[str, str]]:
    """How varied a wildcard came out: options never picked, too few
    distinct values, one value taking most runs when its weight doesn't
    say so. Advice for a rebuild, not errors."""
    out: list[dict[str, str]] = []
    opts = [o for o in payload.get("options") or [] if isinstance(o, dict)
            and isinstance(o.get("value"), str) and (o.get("weight") or 0) > 0]
    narrowed = any(c["kind"] == "constraint" and c["target"] == item["var"]
                   for c in plan["items"])
    plain = [o for o in opts if not re.search(r"[{}$@]", o["value"])]
    never = [o["value"] for o in plain if o["value"] not in v["counts"]]
    if never and len(opts) <= MAX_COUNT and not narrowed and "pick" not in item.get("use", ""):
        out.append({"key": item["key"], "text": f"{item['name']}: never picked in {total} "
                    f"runs: {', '.join(never[:5])}" + (" …" if len(never) > 5 else "")})
    if len(opts) >= 6 and v["distinct"] <= 2:
        out.append({"key": item["key"], "text": f"{item['name']} came out only "
                    f"{v['distinct']} ways in {total} runs"})
    weights = sum(float(o.get("weight") or 0) for o in opts) or 1.0
    for value, n in list(v["counts"].items())[:1]:
        share = n / total
        expected = max((float(o.get("weight") or 0) for o in opts if o["value"] == value),
                       default=0.0) / weights
        if share > 0.6 and expected < 0.4 and len(opts) >= 3:
            out.append({"key": item["key"], "text": f"{item['name']} is \"{value[:40]}\" in "
                        f"{round(share * 100)}% of runs"})
    return out
