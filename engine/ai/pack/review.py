"""Pack builder plan review: known variables, settings findings and
`review_plan` with its model prompt."""
from __future__ import annotations

import re
from typing import Any

from engine.ai import guide as ai_guide
from engine.ai import library_vars
from engine.ai.pack._common import (
    _STR,
    _TAG_REF,
    MAX_NAME,
    MIN_SECTIONED,
    _clean,
    _obj,
    _reads,
    is_wild,
)
from engine.ai.pack.change import _plan_lines
from engine.ai.pack.plan import _row_var, _vocab
from engine.ai.pack.plan_rules import _case_namers, _split_groups, _twin_picks
from engine.ai.pack.prompts import decisions_note, settings_note
from engine.ai.pack.settings import MAX_SWEEP_OPTIONS, canvas_note, parse_run, parse_settings

_NARROWS = re.compile(r"\b(exclude|only|never|reduce|rarely|no |not |without)", re.I)
_AGREE = re.compile(r"\b(match|matches|agree|go with|goes with|fit|fits|suit|suits)\b", re.I)
_SETS = re.compile(r"\b(?:set|sets|add|adds|append|appends|prepend|put|puts|make|makes)\b"
                   r"[^$.;]{0,40}\$([a-zA-Z_][a-zA-Z0-9_]*)", re.I)
#: Set by the engine or the canvas, not by an item.
RUNTIME_VARS = set(library_vars.RUNTIME_VARS)
#: Words that name the same slot, for pointing a stray anchor at a variable
#: the pack does set ($setting → $scene).
_SAME_SLOT = [
    {"setting", "scene", "location", "place", "background", "environment", "backdrop"},
    {"character", "subject", "person", "girl", "boy", "hero", "protagonist", "race"},
    {"class", "role", "job", "archetype", "profession"},
    {"season", "weather", "time", "time_of_day"},
    {"theme", "style", "mood", "genre", "vibe", "aesthetic"},
    {"outfit", "clothes", "clothing", "attire", "costume", "wear"},
]


def known_vars(plan: dict[str, Any]) -> set[str]:
    """Every variable the plan's rules may read: what its items, inputs and
    derivations set, the bundle it extends, the user's canvas (Injector
    rows, the Loop's renamed variables) and the run-time ones."""
    items = plan["items"]
    sets = {i["var"] for i in items if i["var"]} | {i["var"] for i in plan.get("inputs") or []}
    sets |= set((plan.get("base") or {}).get("sets") or [])
    sets |= {c["name"] for c in plan.get("canvas") or []}
    for i in items:
        # A derivation may set more than its main variable; any it names
        # counts, so the check never asks for one it already makes.
        if i["kind"] == "derivation":
            sets |= set(_SETS.findall(i.get("about") or ""))
    return sets | RUNTIME_VARS


def _slot_words(text: str) -> set[str]:
    words = {w.rstrip("s") for w in re.findall(r"[a-z]+", text.lower().replace("_", " "))}
    out = set(words)
    for group in _SAME_SLOT:
        if words & {g.rstrip("s") for g in group}:
            out |= {g.rstrip("s") for g in group}
    return out


def anchor_stand_in(plan: dict[str, Any], anchor: str) -> dict[str, Any] | None:
    """The picked item that most likely means the same slot as an anchor
    nothing sets (by its variable, name or section), or None."""
    want = _slot_words(anchor)
    best, score = None, 0
    for i in plan["items"]:
        if i["kind"] not in ("wildcard", "library") or not i["var"]:
            continue
        have = _slot_words(" ".join([i["var"], i["name"], i.get("section") or ""]))
        n = len(want & have)
        if n > score:
            best, score = i, n
    return best


def _new_item(plan: dict[str, Any], kind: str, name: str, var: str, about: str,
              section: str = "") -> dict[str, Any]:
    return {"kind": kind, "name": name[:MAX_NAME], "var": var, "section": section,
            "count": 0, "tags": [], "source": "", "target": "", "use": "", "about": about}


def _mentions(items: list[dict[str, Any]], var: str) -> bool:
    pat = re.compile(r"\$" + re.escape(var) + r"\b|\b" + re.escape(var) + r"\b", re.I)
    return any(pat.search(i.get("about") or "") for i in items)


def _lora_slot(items: list[dict[str, Any]], var: str) -> str:
    """The variable a LoRA input stands in for (``outfit_lora`` → $outfit)
    when a wildcard in the pack rolls it, else ""."""
    m = re.fullmatch(r"(\w+?)_lora", var)
    if not m:
        return ""
    slot = m.group(1)
    rolled = {i["var"] for i in items if is_wild(i) and i["var"]}
    if slot in rolled:
        return slot
    for group in _SAME_SLOT:
        if slot in group:
            return next((v for v in rolled if v in group), "")
    return ""


def _settings_findings(plan: dict[str, Any], add: Any) -> None:
    """What the plan's run style, its LoRA inputs and the model setting need
    and the plan lacks."""
    cfg = parse_settings(plan.get("settings"))
    run = parse_run(plan.get("run"))
    items = plan["items"]
    derivs = [i for i in items if i["kind"] == "derivation"]
    if run["mode"] == "story":
        if not _mentions(derivs, "iteration"):
            n = run["frames"]
            add(None, "fix", "Story over a Loop needs a derivation that sets the story beat "
                "from $iteration, or every frame looks the same",
                {"op": "add", "item": _new_item(
                    plan, "derivation", "Story beat", "beat",
                    f"Sets $beat from $iteration, one branch per frame 1 to {n} (equals "
                    "\"1\", \"2\", …), each one short step of the story in order.")})
        if not any("hold" in (i.get("use") or "") for i in items if is_wild(i)):
            add(None, "tip", "Nothing is held, so the character and outfit change every "
                "frame of the story; set the ones that must stay to hold")
    if run["mode"] == "sweep":
        for i in items:
            if i["kind"] == "wildcard" and re.search(r"sweep", i.get("about") or "", re.I) \
                    and (i.get("count") or 0) > MAX_SWEEP_OPTIONS + 2:
                add(i, "tip", f"{i['name']} is a sweep axis with {i['count']} options; the "
                    f"Loop makes a frame for each ticked one, so keep it to about "
                    f"{MAX_SWEEP_OPTIONS}",
                    {"op": "edit", "key": i["key"], "set": {"count": MAX_SWEEP_OPTIONS}})
        if not any(re.search(r"sweep", i.get("about") or "", re.I) for i in items):
            add(None, "tip", "No wildcard is marked as a sweep axis; say \"sweep axis\" in "
                "the about of the 2 or 3 short ones to sweep")
    # A LoRA input that stands in for a rolled pick needs a rule swapping it
    # in; one nothing reads does nothing.
    for inp in plan.get("inputs") or []:
        var = inp["var"]
        if not var.endswith("_lora"):
            continue
        slot = _lora_slot(items, var)
        if slot and not _mentions(derivs, var):
            label = slot.replace("_", " ")
            add(None, "fix", f"${var} should replace the random {label} when it is set, so "
                f"a derivation must write it into ${slot}",
                {"op": "add", "item": _new_item(
                    plan, "derivation", f"{label.capitalize()} LoRA", slot,
                    f"When ${var} is set, replace ${slot} with ${var}; otherwise leave the "
                    "random pick.")})
        elif not slot and not _mentions(items, var):
            add(None, "fix", f"Nothing reads the input ${var}; read it in the template "
                "(or in the rule it belongs to)")
    if cfg["model"] == "family" and not _mentions(items, "model_variant") \
            and not _mentions(items, "model_family"):
        add(None, "fix", "Per model family needs a derivation keyed on $model_variant "
            "(from a WP Model Info node)",
            {"op": "add", "item": _new_item(
                plan, "derivation", "Model quality", "quality",
                "Sets $quality from $model_variant: pony → score_9, score_8_up, score_7_up; "
                "illustrious or noobai → masterpiece, best quality, very aesthetic; else the "
                "pack's own quality words.")})


def review_plan(plan: dict[str, Any],
                library: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Check a plan against the guide before anything is built:
    ``[{id, key, level: "fix"|"tip", text, patch?}]``. "fix" findings would
    break the pack or leave a rule doing nothing; "tip" findings make it
    more coherent. A finding with a ``patch`` can be applied to the plan
    without the model (``{op: "edit", key, set: {field: value}}``,
    ``{op: "add", item}``, ``{op: "remove", key}`` or ``{op: "plan", set:
    {anchor}, label}`` for a plan-wide field); the others go to the planner
    when the user asks for them to be fixed. Deterministic."""
    items = plan["items"]
    out: list[dict[str, Any]] = []

    def add(item: dict[str, Any] | None, level: str, text: str,
            patch: dict[str, Any] | None = None) -> None:
        f: dict[str, Any] = {"id": f"r{len(out) + 1}", "key": item["key"] if item else "",
                             "level": level, "text": text}
        if patch:
            f["patch"] = patch
        out.append(f)

    wild = {i["var"]: i for i in items if is_wild(i)}
    known = known_vars(plan)
    anchor = plan.get("anchor") or ""
    if anchor and anchor not in known:
        stand_in = anchor_stand_in(plan, anchor)
        if stand_in is not None:
            add(None, "fix", f"The anchor ${anchor} isn't set by anything in the pack; "
                f"{stand_in['name']} (${stand_in['var']}) looks like the same thing, so "
                "the other picks can follow it instead",
                {"op": "plan", "set": {"anchor": stand_in["var"]},
                 "label": f"Use ${stand_in['var']}"})
        else:
            add(None, "fix", f"The anchor ${anchor} isn't set by anything in the pack, so "
                "nothing can follow it; add an item for it (Fix with AI) or clear it",
                {"op": "plan", "set": {"anchor": ""}, "label": "Clear it"})
    for role, group in [(r, list(c.values())) for r, c in _split_groups(
            list(wild.values()), _case_namers(items))]:
        add(group[0], "fix", ", ".join(g["name"] for g in group) + f" split one subject "
            f"({role.replace('_', ' ')}) into a wildcard per case, so the prompt either "
            f"lists them all or shows the wrong one; make one {role.replace('_', ' ')} "
            "wildcard with the cases as tags, and a constraint from the pick that decides "
            "between them")
    for a, b, what in _twin_picks(list(wild.values())):
        add(b, "fix", f"{a['name']} and {b['name']} both pick the {what}, so the prompt "
            f"shows two; make one wildcard (a colour that varies is more options in "
            f"it, never a second colour)")
    for i in items:
        if i["kind"] in ("derivation", "combine", "template"):
            missing = [v for v in _reads(i.get("about") or "") if v not in known
                       and not (v == "negatives" and i["kind"] == "template")]
            if missing:
                add(i, "fix", f"{i['name']} reads ${', $'.join(missing)}, which nothing in "
                    "the pack sets; add an item or an input for it")
    for c in (i for i in items if i["kind"] == "constraint"):
        src, tgt = wild.get(c["source"]), wild.get(c["target"])
        if not src or not tgt:
            continue
        about = c.get("about") or ""
        named = set(_TAG_REF.findall(about.lower()))
        known_tags = set(src["tags"]) | set(tgt["tags"])
        stray = sorted(named - known_tags)
        if stray:
            add(c, "fix", f"{c['name']} keys on #{', #'.join(stray)}, which neither "
                f"{src['name']} nor {tgt['name']} lists in its tags")
        if not src["tags"] and not named:
            add(c, "tip", f"{src['name']} has no tags, so {c['name']} can only pair "
                "single options; give it the tags the rule tests")
        if _AGREE.search(about) and src["tags"] and tgt["tags"] \
                and not set(src["tags"]) & set(tgt["tags"]) and not named:
            add(c, "tip", f"To make {tgt['name']} agree with {src['name']}, tag both with "
                "the same words (or give the target an accepts group) and key the rule on them")
        if _NARROWS.search(about) and tgt["kind"] == "wildcard" \
                and not re.search(r"never empty|fallback", tgt.get("about") or "", re.I):
            add(tgt, "tip", f"{c['name']} narrows {tgt['name']}; say \"never empty\" in its "
                "description so it gets a fallback option",
                {"op": "edit", "key": tgt["key"],
                 "set": {"about": (tgt.get("about") or "").rstrip(". ") + ". Never empty."}})
    # Constraint loops: the edge that closes one never applies.
    after: dict[str, set[str]] = {v: set() for v in wild}
    for c in (i for i in items if i["kind"] == "constraint"):
        if c["source"] in after and c["target"] in after:
            after[c["target"]].add(c["source"])

    def reaches(a: str, b: str, seen: set[str]) -> bool:
        return any(x == b or (x not in seen and reaches(x, b, seen | {x}))
                   for x in after.get(a, ()))
    for c in (i for i in items if i["kind"] == "constraint"):
        if c["source"] in after and reaches(c["source"], c["target"], {c["source"]}):
            add(c, "fix", f"{c['name']} closes a loop of constraints ({c['target']} already "
                f"comes before {c['source']}), so it can't apply")
    # A preset that also sets what another item sets: one overwrites the other.
    owner = {i["var"]: i for i in items
             if i["var"] and i["kind"] not in ("constraint", "template", "fixed_values")}
    for i in (x for x in items if x["kind"] == "fixed_values"):
        clash = [v for v in dict.fromkeys(_SETS.findall(i.get("about") or "")
                                          + _reads(i.get("about") or ""))
                 if v in owner and v != i["var"]]
        if clash:
            add(i, "fix", f"{i['name']} also sets ${', $'.join(clash)}, which "
                f"{', '.join(dict.fromkeys(owner[v]['name'] for v in clash))} already "
                "set; keep it to values nothing else sets")
    rules = [i for i in items if i["kind"] in ("constraint", "derivation")]
    picks = [i for i in items if i["kind"] in ("wildcard", "library") and i["var"]]
    if len(picks) >= 3 and not rules:
        add(None, "tip", "Nothing links the picks, so they can clash (a winter scene in "
            "sandals); add a constraint or a derivation from the anchor")
    if anchor and anchor in known and len(picks) >= 3:
        linked = {anchor}
        for _ in range(len(items)):
            for i in rules:
                ins = {i["source"]} if i["kind"] == "constraint" else _reads(i.get("about") or "")
                outs = {i["target"]} if i["kind"] == "constraint" else {i["var"]}
                if linked & set(ins):
                    linked |= outs
        loose = [p["name"] for p in picks if p["var"] not in linked]
        if len(loose) >= 2:
            add(None, "tip", f"{', '.join(loose[:4])} don't follow the anchor ${anchor}; "
                "link the ones that should agree with it")
    if not any(i["kind"] == "template" for i in items) and not plan.get("base"):
        reads = [f"${i['var']}" for i in items if i["var"] and i["kind"] != "constraint"
                 and not _vocab(i)]
        add(None, "fix", "There is no template, so nothing turns the variables into a prompt",
            {"op": "add", "item": {
                "kind": "template", "name": f"{plan['title']} prompt"[:MAX_NAME], "var": "",
                "section": "", "count": 0, "tags": [], "source": "", "target": "", "use": "",
                "about": "The final prompt reading " + ", ".join(reads[:20])
                + ", in a natural order, with a standing negative."}})
    _settings_findings(plan, add)
    for d in plan.get("dropped") or []:
        if isinstance(d, dict) and d.get("kind") == "constraint":
            sides = [f"${v}" for v in (d.get("source"), d.get("target")) if v]
            add(None, "fix", f"The constraint {d.get('name')} was left out because "
                f"{d.get('why')}, so its rule ({d.get('about') or 'no description'}) does "
                "nothing; " + (f"plan wildcards for {' and '.join(sides)} so it can apply"
                               if len(sides) == 2 else
                               "give it the wildcard it keys on as source and the one it "
                               "changes as target"))
    # A new wildcard the library already has.
    if parse_settings(plan.get("settings"))["library"] == "reuse":
        lib = {}
        for r in library or []:
            if r.get("type") == "wildcard" and _row_var(r):
                lib.setdefault(_row_var(r), r)
                lib.setdefault(str(r.get("name") or "").lower(), r)
        for i in items:
            if i["kind"] != "wildcard" or not i["var"]:
                continue
            r = lib.get(i["var"]) or lib.get(i["name"].lower())
            if r is not None and _row_var(r) not in {x["var"] for x in items
                                                     if x["kind"] == "library"}:
                add(i, "tip", f"Your library already has {r.get('name')} (${_row_var(r)}); "
                    "use it instead of a new one",
                    {"op": "edit", "key": i["key"],
                     "set": {"kind": "library", "name": str(r.get("name") or ""),
                             "var": _row_var(r), "count": 0}})
    if parse_settings(plan.get("settings"))["structure"] == "sections" \
            and len([i for i in items if not _vocab(i)]) >= MIN_SECTIONED * 2 \
            and len({i.get("section") for i in items if i.get("section")}) < 2:
        add(None, "tip", "Everything is in one section; group the items (character, outfit, "
            "scene…) so each part gets its own sub-bundle")
    return out


REVIEW_SCHEMA: dict[str, Any] = _obj({
    "findings": {"type": "array", "items": _obj({
        "item": _STR, "severity": {"type": "string", "enum": ["fix", "tip"]}, "text": _STR})},
})

REVIEW_SYSTEM = """\
You review a plan for a Wildcard Pipeline prompt pack before it is built. \
Find what would make its prompts incoherent, repetitive or broken, and say \
the fix in one sentence each: a pick that should follow another but nothing \
links them, a "must match" done with a reduce instead of shared tags, a \
constrained wildcard with no "never empty", a wildcard doing two jobs, a \
derivation that should be a constraint (or the other way round), a missing \
slot the request asked for, options in two styles, a wildcard whose \
options would stray outside its one subject (a pose wildcard with hair \
colours), a negative setting the plan ignores. item is the item's name, or \
"" for the whole pack; severity "fix" when it breaks the pack or the \
request, else "tip". Say exactly what to change. At most 8 findings; [] \
when the plan is good. Don't repeat the checker's findings; they are listed.

""" + ai_guide.STRUCTURE + "\n" + ai_guide.WHICH + "\n" + ai_guide.NODES + "\n" \
    + ai_guide.COHERENCE


def review_prompt(plan: dict[str, Any], found: list[dict[str, Any]],
                  request: str = "") -> str:
    lines = ([f"The user asked: {request.strip()[:1500]}"] if request.strip() else []) \
        + _plan_lines(plan) + ["", settings_note(plan.get("settings") or {})]
    if plan.get("decisions"):
        lines.append(decisions_note(plan["decisions"]))
    if plan.get("canvas"):
        lines.append(canvas_note(plan["canvas"]))
    if found:
        lines.append("The checker already found: " + " ".join(f["text"] for f in found))
    return "\n".join(lines)


def compile_review(answer: Any, plan: dict[str, Any]) -> list[dict[str, Any]]:
    names = {i["name"].lower(): i["key"] for i in plan["items"]}
    out: list[dict[str, Any]] = []
    for f in (answer.get("findings") if isinstance(answer, dict) else None) or []:
        if not isinstance(f, dict):
            continue
        text = _clean(f.get("text"), 300)
        if text:
            level = "fix" if f.get("severity") == "fix" else "tip"
            out.append({"id": f"m{len(out) + 1}",
                        "key": names.get(_clean(f.get("item"), MAX_NAME).lower(), ""),
                        "level": level, "text": text, "by": "model"})
    return out[:8]


def review_note(findings: list[dict[str, Any]]) -> str:
    """Findings as a refine request for the planner."""
    if not findings:
        return ""
    return ("Revise the plan to fix ALL of these, one by one:\n"
            + "\n".join(f"{n}. {f['text'].rstrip('. ')}." for n, f in enumerate(findings, 1))
            + "\nWhere one asks for a new item (a constraint, a derivation, a wildcard), add it "
            "to the plan; where one asks to change an item, change that item.")


def follow_up_note(plan: dict[str, Any]) -> str:
    """What the plan answer looked like after checking, for a refine."""
    if not plan.get("warnings"):
        return ""
    return "the checker changed it: " + "; ".join(plan["warnings"])[:600]
