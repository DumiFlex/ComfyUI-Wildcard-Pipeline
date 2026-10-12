"""Pack builder: a whole pack of modules from one description.

Four steps, each its own request so a small local model stays on track:

1. **Plan.** The model writes an outline (`PLAN_SCHEMA`): the pack's title,
   up to three questions it can't guess, the run-time inputs it expects
   (variables a WP Context Injector brings in), and a list of items by name
   and variable (wildcards, fixed values, derivations, combines,
   constraints, one template), each with an optional per-use line (`use`:
   "pick 2-3; hold", see `use.py`). A wildcard with no variable is a
   vocabulary other options point at with ``@{Name:tag}``. `compile_plan`
   checks it and gives every item a key.
2. **Build.** One call per item in `build_order`, with the same prompts and
   checkers the editor panels and the chat use (`wildcard.compile_spec`,
   `derivation`, `constraint`, `text_items`). Later items see what earlier
   ones built, so a constraint knows its wildcards' tags and an option can
   point at a vocabulary built before it.
3. **Check.** `check_pack` runs the pack on the real engine for a few
   hundred seeds and lists, per item, what went wrong, plus sample prompts.
4. **Install.** `install_ops` turns the pack into one import commit (the
   modules, the template and a bundle, tagged as one collection), so one
   undo removes all of it.

The model never writes ids, `sub_categories`, `@{uuid}` refs or rule ids
(it names wildcards; `refs.compile_text` turns names into ids); every
payload is built here and validated by its engine handler. The
manager holds the plan and the built items between requests, so nothing is
kept on the server.
"""
from __future__ import annotations

import copy
import json
import re
import secrets
from typing import Any

from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import guide as ai_guide
from engine.ai import library_vars, text_items
from engine.ai import patterns as ai_patterns
from engine.ai import refs as ai_refs
from engine.ai import use as ai_use
from engine.ai import wildcard as ai_wildcard
from engine.modules.combine_handler import CombineHandler
from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.derivation_handler import DerivationHandler
from engine.modules.fixed_values_handler import FixedValuesHandler
from engine.modules.snapshot import payload_hash, walk_transitive_refs
from engine.modules.wildcard_handler import WildcardHandler

KINDS = ("wildcard", "library", "fixed_values", "derivation", "combine", "constraint",
         "template")
#: How every option and value in a pack is written.
STYLES = ("tags", "sentences")
MAX_INPUTS = 6
MAX_USE = 200
MAX_ITEMS = 20
MAX_QUESTIONS = 3
MIN_COUNT, MAX_COUNT, DEFAULT_COUNT = 4, 60, 12
MAX_ABOUT = 600
MAX_NAME = 80
MAX_TEMPLATE = 4000
CHECK_SEEDS = 200
SAMPLE_PROMPTS = 3
_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_VAR_READ = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)")
_KEY = re.compile(r"^i\d{1,3}$")
_HEX8 = re.compile(r"^[0-9a-f]{8}$")

_STR = {"type": "string"}
_STRS = {"type": "array", "items": _STR}


def _obj(props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False,
            "required": list(props), "properties": props}


PLAN_SCHEMA: dict[str, Any] = _obj({
    "title": _STR,
    "summary": _STR,
    "rating": {"type": "string", "enum": ["safe", "nsfw"]},
    "style": {"type": "string", "enum": list(STYLES)},
    "model": _STR,
    "anchor": _STR,
    "questions": {"type": "array", "items": _obj({"question": _STR, "choices": _STRS})},
    "inputs": {"type": "array", "items": _obj({"var": _STR, "about": _STR, "example": _STR})},
    "items": {"type": "array", "items": _obj({
        "kind": {"type": "string", "enum": list(KINDS)},
        "name": _STR,
        "var": _STR,
        "about": _STR,
        "count": {"type": "integer"},
        "tags": _STRS,
        "source": _STR,
        "target": _STR,
        "use": _STR,
    })},
})

PLAN_SYSTEM = """\
You plan prompt packs for Wildcard Pipeline, a ComfyUI extension that builds \
image-generation prompts from modules that run in order on a WP Context node \
and set $variables; a WP Prompt Assembler then renders a template from them.
- wildcard: a list of options bound to a $variable; each run picks one \
(weighted). Options carry tags (one lowercase word each) that rules and \
filters use, may hold small {a|b} variations, and may point at another \
wildcard with @{Its name:tag} for a fresh pick from it ("a @{Colors:warm} \
scarf"). A wildcard with var "" is a vocabulary: it isn't in the stack; \
other options point at it (colours, materials, names used in many places).
- fixed_values: variables set to the same text every run (quality tags, a \
style preset); var is the main one.
- derivation: IF/ELSE rules that read variables and set others ("when $class \
is mage, set $title to Archmage"; "when $season is winter, add coat to \
$outfit"); they can also add words to a variable's negative prompt.
- combine: a template that joins variables into a new one ("$race $class").
- constraint: links a SOURCE wildcard to a TARGET wildcard so the source's \
pick changes the target's odds (exclude, reduce, boost, only), usually by \
tag ("#caster gets only #robe outfits"). To make two picks agree (shoes \
that match the outfit), tag both wildcards with the same words for it.
- template: the final prompt, reading $variables only (no picks).
- library: a wildcard the user already has (listed under "The user's \
library"), used as is. Reuse one when it fits instead of making a copy.

Plan a pack for the request. Answer with:
- title: a short pack name. summary: one sentence on what it makes.
- rating: "nsfw" if the pack is sexual or explicit, else "safe".
- style: "tags" (comma-separated Danbooru-style tags, for SDXL anime models \
like Pony, Illustrious, NoobAI) or "sentences" (short natural phrases, for \
Flux, SD3, Qwen-Image and other natural-language models). Every item is \
written in it. Follow the request, else the user's library, else "tags".
- model: the image model family the request names ("pony", "flux", …), or "".
- anchor: the variable (no $) the other picks follow (setting, character \
class, season), or "" when nothing should drive the rest.
- questions: up to 3 things you can't guess that would change the plan, \
each with 2 to 4 short choices. Ask only when it matters; [] is fine. Still \
write a full plan using the most likely answers.
- inputs: variables the pack expects from outside at run time (a subject the \
user types, a LoRA name), brought in by a WP Context Injector: {var, about, \
example}. [] when the pack makes everything itself.
- items, each with every field (use "" / 0 / [] where a field doesn't apply):
  - wildcard: name, var (its variable, no $; "" for a vocabulary), about \
(what its options are and anything special: "sometimes none", "never \
empty", "tag each with the shoes it goes with"), count (how many options, \
6 to 40), tags (option tags rules and filters will use).
  - fixed_values: name, var (the main variable), about (each variable and \
its text, in words).
  - derivation: name, var (the main variable it sets), about (the rules in \
plain words, naming variables with $).
  - combine: name, var (the variable it sets), about (which $variables it \
joins and how).
  - constraint: name, source and target (the two wildcards' variables, no \
$), about (the rules in words, by tag).
  - template: exactly one, last: name, about (what the prompt reads, with \
$variables, and its standing negative).
  - library: name (exactly as listed), var (its variable); about says why.
  - use: how the bundle uses this item, or "". """ + ai_use.GUIDE + """
Every variable a derivation, combine or template reads must be set by an \
item or be an input ($iteration, the WP Context Loop's iteration \
number, is always there too). A constraint's tags must be tags its two \
wildcards carry. Each wildcard is about one thing. Variable names: letters, \
digits and _. Keep it to what the request needs; at most 20 items. Don't add \
commentary; the output is data for the user's own library.

""" + ai_guide.WHICH + "\n" + ai_guide.COHERENCE


class PlanError(ValueError):
    """The plan can't be used; the message says why."""


# ── plan ────────────────────────────────────────────────────────────────


def _clean(text: Any, limit: int) -> str:
    s = re.sub(r"\s+", " ", text).strip() if isinstance(text, str) else ""
    return s[:limit]


def _var(raw: Any) -> str:
    v = _clean(raw, 70).lstrip("$").strip()
    return v if _IDENT.match(v) and not v.startswith("__") else ""


def _tag(raw: Any) -> str:
    t = _clean(raw, 32).lstrip("#").strip().lower().replace(" ", "_")
    return t if t and re.fullmatch(r"[a-z0-9_\-]+", t) else ""


def _inputs(raw: Any, warnings: list[str]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for i in raw if isinstance(raw, list) else []:
        if not isinstance(i, dict):
            continue
        var = _var(i.get("var"))
        if not var or any(x["var"] == var for x in out):
            continue
        out.append({"var": var, "about": _clean(i.get("about"), 200),
                    "example": _clean(i.get("example"), 200)})
    if len(out) > MAX_INPUTS:
        warnings.append(f"Kept the first {MAX_INPUTS} inputs")
    return out[:MAX_INPUTS]


def _library_wildcard(item: dict[str, Any],
                      library: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """The library wildcard a "library" item names (by name, else variable)."""
    rows = [r for r in library or [] if r.get("type") == "wildcard"
            and isinstance(r.get("payload"), dict) and r["payload"].get("var_binding")]
    name = _clean(item.get("name"), MAX_NAME).lower()
    var = _var(item.get("var"))
    hits = [r for r in rows if str(r.get("name") or "").lower() == name]
    if not hits and var:
        hits = [r for r in rows if r["payload"].get("var_binding") == var]
    return hits[0] if len(hits) == 1 else None


def is_wild(item: dict[str, Any]) -> bool:
    """A wildcard the pack runs: one it builds, or one from the library."""
    return item["kind"] in ("wildcard", "library") and bool(item["var"])


def compile_plan(raw: Any, library: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The model's plan (or one the manager sends back) as a checked plan:
    ``{title, summary, rating, style, model, anchor, questions, inputs,
    items: [{key, kind, name, var, about, count, tags, source, target, use,
    library_id}], warnings}``. Items the manager sent keep their keys.
    "library" items must name a wildcard in ``library``. Raises PlanError
    when nothing usable is left."""
    if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
        raise PlanError("the plan had no items")
    warnings: list[str] = []
    questions = []
    for q in raw.get("questions") if isinstance(raw.get("questions"), list) else []:
        if not isinstance(q, dict):
            continue
        text = _clean(q.get("question"), 200)
        choices = [c for c in (_clean(x, 60) for x in q.get("choices") or []) if c][:4]
        if text and len(choices) >= 2:
            questions.append({"question": text, "choices": choices})
    inputs = _inputs(raw.get("inputs"), warnings)
    items: list[dict[str, Any]] = []
    keys: set[str] = set()
    sets: dict[str, str] = {i["var"]: "an input" for i in inputs}
    names: set[str] = set()
    next_key = 1
    template_seen = False
    for it in raw["items"]:
        if not isinstance(it, dict) or it.get("kind") not in KINDS:
            continue
        kind = it["kind"]
        name = _clean(it.get("name"), MAX_NAME)
        about = _clean(it.get("about"), MAX_ABOUT)
        var = _var(it.get("var"))
        lib_row = None
        if kind == "library":
            lib_row = _library_wildcard(it, library)
            if lib_row is None:
                warnings.append(f"Left out {name or var or 'a library item'}: no wildcard "
                                "by that name in the library")
                continue
            name, var = str(lib_row.get("name") or name), lib_row["payload"]["var_binding"]
        if kind == "template":
            if template_seen:
                warnings.append(f"Left out a second template, {name or 'unnamed'}")
                continue
            template_seen = True
        if kind in ("combine", "fixed_values") and not var:
            warnings.append(f"Left out {kind.replace('_', ' ')} {name or 'unnamed'}: "
                            "it needs a variable")
            continue
        if kind == "wildcard" and not var and not name:
            warnings.append("Left out a wildcard with no name or variable")
            continue
        if kind == "derivation" and not about:
            warnings.append(f"Left out derivation {name or 'unnamed'}: it says no rules")
            continue
        if kind in ("wildcard", "library", "combine", "fixed_values") and var in sets:
            warnings.append(f"Left out {name or var}: ${var} is already set by {sets[var]}")
            continue
        if kind == "wildcard" and not var and name.lower() in names:
            warnings.append(f"Left out a second wildcard named {name}")
            continue
        key = it.get("key") if isinstance(it.get("key"), str) and _KEY.match(it["key"]) else ""
        if not key or key in keys:
            while f"i{next_key}" in keys or any(
                    isinstance(x, dict) and x.get("key") == f"i{next_key}" for x in raw["items"]):
                next_key += 1
            key = f"i{next_key}"
            next_key += 1
        keys.add(key)
        count = it.get("count")
        count = int(count) if isinstance(count, (int, float)) and not isinstance(count, bool) \
            else DEFAULT_COUNT
        item = {
            "key": key, "kind": kind,
            "name": name or (f"${var}" if var else kind.replace("_", " ").title()),
            "var": var, "about": about,
            "count": max(MIN_COUNT, min(MAX_COUNT, count)) if kind == "wildcard" else 0,
            "tags": list(dict.fromkeys(
                t for t in (_tag(x) for x in it.get("tags") or []) if t))[:12]
            if kind == "wildcard" else [],
            "source": _var(it.get("source")) if kind == "constraint" else "",
            "target": _var(it.get("target")) if kind == "constraint" else "",
            "use": _clean(it.get("use"), MAX_USE) if kind in (
                "wildcard", "library", "combine", "derivation", "fixed_values") and var else "",
            "library_id": "",
        }
        if lib_row is not None:
            item["library_id"] = lib_row["id"]
            item["count"] = 0
            item["tags"] = [t for t in lib_row["payload"].get("sub_categories") or []
                            if isinstance(t, str)][:12]
        if kind in ("wildcard", "library", "combine", "derivation", "fixed_values") and var:
            sets.setdefault(var, item["name"])
        if kind == "wildcard":
            names.add(item["name"].lower())
        items.append(item)
        if len(items) >= MAX_ITEMS:
            warnings.append(f"Kept the first {MAX_ITEMS} items")
            break
    wildcard_vars = {i["var"]: i for i in items if is_wild(i)}
    kept: list[dict[str, Any]] = []
    for i in items:
        if i["kind"] == "constraint":
            bad = [s for s in (i["source"], i["target"]) if s not in wildcard_vars]
            if bad or i["source"] == i["target"]:
                warnings.append(
                    f"Left out constraint {i['name']}: "
                    + (f"${bad[0] or '?'} isn't a wildcard in this pack" if bad
                       else "its source and target are the same"))
                continue
        kept.append(i)
    if not any(is_wild(i) for i in kept):
        raise PlanError("the plan has no wildcards")
    rating = raw.get("rating") if raw.get("rating") in ("safe", "nsfw") else "safe"
    anchor = _var(raw.get("anchor"))
    if anchor and anchor not in {i["var"] for i in kept if i["var"]} \
            and anchor not in {i["var"] for i in inputs}:
        warnings.append(f"The anchor ${anchor} isn't set by the pack")
        anchor = ""
    return {
        "title": _clean(raw.get("title"), MAX_NAME) or "AI pack",
        "summary": _clean(raw.get("summary"), 300),
        "rating": rating,
        "style": raw.get("style") if raw.get("style") in STYLES else "tags",
        "model": _clean(raw.get("model"), 40),
        "anchor": anchor,
        "questions": questions[:MAX_QUESTIONS],
        "inputs": inputs,
        "items": kept,
        "warnings": warnings,
    }


def _vocab(item: dict[str, Any]) -> bool:
    """A wildcard with no variable: only reached through refs."""
    return item["kind"] == "wildcard" and not item["var"]


_BUILD_RANK = {"library": 0, "fixed_values": 1, "wildcard": 1, "derivation": 2, "combine": 3,
               "constraint": 4, "template": 5}


def build_order(plan: dict[str, Any]) -> list[str]:
    """Keys in the order to build them: what an item reads comes first, and
    vocabularies before the wildcards that point at them."""
    items = list(enumerate(plan["items"]))
    items.sort(key=lambda p: (0 if _vocab(p[1]) else _BUILD_RANK[p[1]["kind"]], p[0]))
    return [i["key"] for _, i in items]


def _walk_reads(node: Any, out: list[str]) -> None:
    if isinstance(node, str):
        out.extend(_VAR_READ.findall(node))
    elif isinstance(node, dict):
        if isinstance(node.get("var"), str) and "op" in node:
            out.append(node["var"].lstrip("$"))
        for k, v in node.items():
            if k not in ("target_var", "output_var", "id"):
                _walk_reads(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_reads(v, out)


def item_io(item: dict[str, Any], payload: dict[str, Any] | None) -> tuple[set[str], set[str]]:
    """(variables the item reads, variables it sets), from its built payload
    when there is one, else from the plan's words."""
    writes = {item["var"]} if item.get("var") else set()
    reads: list[str] = []
    if isinstance(payload, dict):
        _walk_reads(payload, reads)
        if item["kind"] == "derivation":
            writes |= {t for r in payload.get("rules") or []
                       for t in library_vars._action_targets(r)}
        elif item["kind"] == "fixed_values":
            writes |= {v.get("name") for v in payload.get("values") or []
                       if isinstance(v, dict) and isinstance(v.get("name"), str)}
    else:
        reads = _VAR_READ.findall(item.get("about") or "")
    # A derivation that appends to its own variable reads it too, but that
    # is not an edge to itself.
    return {r.split(".")[0] for r in reads} - writes, writes


def _by_reads(items: list[dict[str, Any]], built: dict[str, Any]) -> list[str]:
    """Keys of rule items so each runs after the ones that set what it
    reads; plan order otherwise. A loop keeps plan order for its members."""
    io = {i["key"]: item_io(i, (built.get(i["key"]) or {}).get("payload")) for i in items}
    pending = [i["key"] for i in items]
    done: list[str] = []
    while pending:
        def ready(k: str) -> bool:
            return not any(io[o][1] & io[k][0] for o in pending if o != k)
        nxt = next((k for k in pending if ready(k)), pending[0])
        pending.remove(nxt)
        done.append(nxt)
    return done


def chain_order(plan: dict[str, Any], built: dict[str, Any] | None = None) -> list[str]:
    """Keys of the modules in the order they run. Fixed values first. A
    constraint needs its source picked before it and its target after it,
    so wildcards follow the constraint edges and each constraint sits just
    before its target. Derivations and combines come after the wildcards,
    each after whatever sets what it reads (a derivation that reads a
    combine's output runs after the combine). A constraint whose edges loop
    back is placed last, where it does nothing; the check reports that.
    Vocabularies aren't in the chain."""
    items = plan["items"]
    wild = [i for i in items if is_wild(i)]
    by_var = {i["var"]: i for i in wild}
    cons = [i for i in items if i["kind"] == "constraint"]
    after: dict[str, set[str]] = {i["var"]: set() for i in wild}
    for c in cons:
        after[c["target"]].add(c["source"])
    ordered: list[str] = []
    placed: set[str] = set()
    pending = [i["var"] for i in wild]
    while pending:
        ready = next((v for v in pending if after[v] <= placed), None)
        if ready is None:  # a loop: take the first, its inbound edge won't apply
            ready = pending[0]
        pending.remove(ready)
        placed.add(ready)
        ordered.append(ready)
    position = {v: n for n, v in enumerate(ordered)}
    chain: list[str] = [i["key"] for i in items if i["kind"] == "fixed_values"]
    for v in ordered:
        for c in cons:
            if c["target"] == v and position[c["source"]] < position[v]:
                chain.append(c["key"])
        chain.append(by_var[v]["key"])
    chain += [c["key"] for c in cons if c["key"] not in chain]
    rules = [i for i in items if i["kind"] in ("derivation", "combine")]
    # Derivations before combines unless a read says otherwise.
    rules.sort(key=lambda i: i["kind"] == "combine")
    chain += _by_reads(rules, built or {})
    return chain


MAX_SAMPLE = 2000


def plan_prompt(instruction: str, *, library_note: str = "", sample: str = "") -> str:
    """The plan request: what the user asked, their library's conventions,
    and optionally a prompt they like to rebuild as a pack."""
    out = f"Request: {instruction.strip()}"
    sample = sample.strip()[:MAX_SAMPLE]
    if sample:
        out += (
            "\n\nA prompt the user likes, to turn into a pack that makes more like it:\n"
            f"<<<\n{sample}\n>>>\nSplit it into slots (subject, hair, outfit, pose, "
            "setting, lighting, style, quality…). For each slot reuse a library wildcard "
            "that fits (kind \"library\"), else plan a wildcard whose options include the "
            "sample's own words. Keep fixed parts (quality tags, style) as fixed values. "
            "The template should read the slots in the sample's order, and its negative "
            "should keep the sample's negative if it has one. Write in the sample's style.")
    if library_note:
        out += "\n\n" + library_note
    return out


# ── review ──────────────────────────────────────────────────────────────

_NARROWS = re.compile(r"\b(exclude|only|never|reduce|rarely|no |not |without)", re.I)
_AGREE = re.compile(r"\b(match|matches|agree|go with|goes with|fit|fits|suit|suits)\b", re.I)
_TAG_REF = re.compile(r"#([a-z0-9_\-]+)")
_SETS = re.compile(r"\b(?:set|sets|add|adds|append|appends|prepend|put|puts|make|makes)\b"
                   r"[^$.;]{0,40}\$([a-zA-Z_][a-zA-Z0-9_]*)", re.I)
#: Set by the engine or the canvas, not by an item.
RUNTIME_VARS = {"iteration", "iteration_total", "model_family", "model_variant", "model_name"}


def review_plan(plan: dict[str, Any]) -> list[dict[str, str]]:
    """Check a plan against the guide before anything is built:
    ``[{key, level: "fix"|"tip", text}]``. "fix" findings would break the
    pack or leave a rule doing nothing; "tip" findings make it more
    coherent. Deterministic; the manager can send them to the planner as a
    refine."""
    items = plan["items"]
    out: list[dict[str, str]] = []

    def add(item: dict[str, Any] | None, level: str, text: str) -> None:
        out.append({"key": item["key"] if item else "", "level": level, "text": text})

    wild = {i["var"]: i for i in items if is_wild(i)}
    sets = {i["var"] for i in items if i["var"]} | {i["var"] for i in plan.get("inputs") or []}
    for i in items:
        # A derivation may set more than its main variable; any it names
        # counts, so the check never asks for one it already makes.
        if i["kind"] == "derivation":
            sets |= set(_SETS.findall(i.get("about") or ""))
    known = sets | RUNTIME_VARS
    for i in items:
        if i["kind"] in ("derivation", "combine", "template"):
            missing = [v for v in _reads(i.get("about") or "") if v not in known]
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
                "description so it gets a fallback option")
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
    rules = [i for i in items if i["kind"] in ("constraint", "derivation")]
    picks = [i for i in items if i["kind"] in ("wildcard", "library") and i["var"]]
    if len(picks) >= 3 and not rules:
        add(None, "tip", "Nothing links the picks, so they can clash (a winter scene in "
            "sandals); add a constraint or a derivation from the anchor")
    anchor = plan.get("anchor") or ""
    if anchor and len(picks) >= 3:
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
    if not any(i["kind"] == "template" for i in items):
        add(None, "fix", "There is no template, so nothing turns the variables into a prompt")
    return out


REVIEW_SCHEMA: dict[str, Any] = _obj({
    "findings": {"type": "array", "items": _obj({"item": _STR, "text": _STR})},
})

REVIEW_SYSTEM = """\
You review a plan for a Wildcard Pipeline prompt pack before it is built. \
Find what would make its prompts incoherent, repetitive or broken, and say \
the fix in one sentence each: a pick that should follow another but nothing \
links them, a "must match" done with a reduce instead of shared tags, a \
constrained wildcard with no "never empty", a wildcard doing two jobs, a \
derivation that should be a constraint (or the other way round), a missing \
slot the request asked for, options in two styles. item is the item's name, \
or "" for the whole pack. At most 6 findings; [] when the plan is good. \
Don't repeat the checker's findings; they are listed.

""" + ai_guide.WHICH + "\n" + ai_guide.COHERENCE


def review_prompt(plan: dict[str, Any], found: list[dict[str, str]]) -> str:
    lines = [f"Pack: {plan['title']}: {plan['summary']}",
             f"Style: {plan.get('style') or 'tags'}; anchor: "
             f"{('$' + plan['anchor']) if plan.get('anchor') else 'none'}"]
    for i in plan["items"]:
        bits = [i["kind"], i["name"]]
        if i["var"]:
            bits.append("$" + i["var"])
        if i["kind"] == "constraint":
            bits.append(f"${i['source']} → ${i['target']}")
        if i["tags"]:
            bits.append("tags " + ", ".join(i["tags"]))
        if i.get("use"):
            bits.append("use " + i["use"])
        lines.append("- " + " · ".join(bits) + (f": {i['about']}" if i["about"] else ""))
    if found:
        lines.append("The checker already found: " + " ".join(f["text"] for f in found))
    return "\n".join(lines)


def compile_review(answer: Any, plan: dict[str, Any]) -> list[dict[str, str]]:
    names = {i["name"].lower(): i["key"] for i in plan["items"]}
    out = []
    for f in (answer.get("findings") if isinstance(answer, dict) else None) or []:
        if not isinstance(f, dict):
            continue
        text = _clean(f.get("text"), 300)
        if text:
            out.append({"key": names.get(_clean(f.get("item"), MAX_NAME).lower(), ""),
                        "level": "tip", "text": text, "by": "model"})
    return out[:6]


def review_note(findings: list[dict[str, str]]) -> str:
    """Findings as a refine request for the planner."""
    if not findings:
        return ""
    return "Revise the plan to fix these: " + " ".join(f"- {f['text']}." for f in findings)


def follow_up_note(plan: dict[str, Any]) -> str:
    """What the plan answer looked like after checking, for a refine."""
    if not plan.get("warnings"):
        return ""
    return "the checker changed it: " + "; ".join(plan["warnings"])[:600]


# ── build ───────────────────────────────────────────────────────────────


def _item(plan: dict[str, Any], key: str) -> dict[str, Any]:
    for i in plan["items"]:
        if i["key"] == key:
            return i
    raise PlanError(f"no item {key} in the plan")


STYLE_LINES = {
    "tags": "Write every option and value as comma-separated Danbooru-style tags "
            "(\"long hair, red hair\"), no sentences.",
    "sentences": "Write every option and value as a short natural phrase "
                 "(\"long flowing red hair\"), not tag lists.",
}


def _pack_line(plan: dict[str, Any]) -> str:
    line = f"Part of the pack \"{plan['title']}\": {plan['summary']}".rstrip(": ")
    style = STYLE_LINES.get(plan.get("style") or "")
    if style:
        line += ". " + style
    if plan.get("model"):
        line += f" The image model is {plan['model']}."
    return line


def consumers(plan: dict[str, Any], item: dict[str, Any]) -> list[str]:
    """What the rest of the plan does with a wildcard, so its options come
    out spelled and tagged the way those items need."""
    var = item["var"]
    if not var:
        return [f"{i['name']} points at it" for i in plan["items"]
                if i["kind"] == "wildcard" and item["name"] in (i.get("about") or "")][:4]
    out = []
    for i in plan["items"]:
        if i is item:
            continue
        about = i.get("about") or ""
        if i["kind"] == "constraint" and var in (i["source"], i["target"]):
            side = "source" if i["source"] == var else "target"
            out.append(f"constraint {i['name']} uses it as its {side}: {about}")
        elif i["kind"] in ("derivation", "combine", "template") \
                and re.search(rf"\${re.escape(var)}\b", about):
            out.append(f"{i['kind']} {i['name']}: {about}")
    if plan.get("anchor") == var:
        out.insert(0, "it is the pack's anchor: the other picks follow it")
    return out[:6]


def _built_rows(plan: dict[str, Any], built: dict[str, Any]) -> list[dict[str, Any]]:
    """Built modules as library-like rows (for the variable catalog)."""
    rows = []
    for i in plan["items"]:
        b = built.get(i["key"])
        if i["kind"] in ("wildcard", "library", "derivation", "combine", "fixed_values") \
                and isinstance(b, dict):
            rows.append({"id": b["id"], "type": "wildcard" if i["kind"] == "library"
                         else i["kind"], "name": i["name"],
                         "description": i["about"], "payload": b["payload"]})
    return rows


def _catalog(plan: dict[str, Any], built: dict[str, Any]) -> dict[str, dict[str, Any]]:
    cat = library_vars.build_catalog(_built_rows(plan, built), inputs=plan.get("inputs"))
    # Planned variables not built yet still count as known.
    for i in plan["items"]:
        if i["var"] and i["var"] not in cat and i["kind"] != "constraint":
            cat[i["var"]] = {"name": i["var"], "sources": [], "values": [], "tags": [],
                             "about": i["about"][:100], "axes": []}
    return cat


def ref_index(
    plan: dict[str, Any], built: dict[str, Any], library: list[dict[str, Any]] | None = None,
) -> ai_refs.RefIndex:
    """What an option may point at: the library's wildcards, then the pack's."""
    idx = ai_refs.RefIndex([r for r in library or [] if r.get("type") == "wildcard"])
    for r in _built_rows(plan, built):
        if r["type"] == "wildcard":
            idx.add(r)
    return idx


def _wildcard_view(item: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    return {"id": b["id"], "name": item["name"], "description": item["about"],
            "payload": b["payload"]}


def library_item(plan: dict[str, Any], key: str,
                 library: list[dict[str, Any]] | None) -> dict[str, Any]:
    """A "library" item, built without the model: the user's own wildcard as
    it is, in the shape `compile_item` returns."""
    item = _item(plan, key)
    row = next((r for r in library or [] if r.get("id") == item["library_id"]), None)
    if row is None:
        raise PlanError(f"{item['name']} isn't in the library any more")
    payload = copy.deepcopy(row["payload"])
    idx = ai_refs.RefIndex([r for r in library or [] if r.get("type") == "wildcard"])
    return {"key": key, "id": row["id"], "kind": "library", "payload": payload,
            "preview": [ai_wildcard.option_line(o, idx) for o in payload.get("options") or []],
            "warnings": [f"Uses your wildcard {item['name']} as it is"]}


def item_request(
    plan: dict[str, Any], key: str, built: dict[str, Any], note: str = "",
    library: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """``{system, user, schema, schema_name, temperature}`` for one item."""
    item = _item(plan, key)
    kind = item["kind"]
    if kind == "library":
        raise PlanError(f"{item['name']} comes from the library; nothing to write")
    fix = f"\n\nThe last version had these problems; fix them: {note.strip()}" \
        if note.strip() else ""
    if kind == "wildcard":
        own = built.get(key, {}).get("id")
        idx = ref_index(plan, built, library)
        pointers = idx.describe(exclude=own)
        user = ai_wildcard.build_user_prompt(
            instruction=f"{item['about']} {_pack_line(plan)}."
            + (f" Tag options with these tags where they fit: {', '.join(item['tags'])}."
               if item["tags"] else "")
            + (" It's a vocabulary other options point at, so keep each option short."
               if _vocab(item) else "")
            + "".join(f"\nUsed by: {c}" for c in consumers(plan, item))
            + ("\nSpell options exactly as the items above test them, and give them the "
               "tags those items key on." if consumers(plan, item) else "") + fix,
            count=item["count"], name=item["name"], var_binding=item["var"],
            existing_options=[], tags=item["tags"], refs_text=pointers,
        )
        return {"system": ai_wildcard.spec_prompt(), "user": user,
                "schema": ai_wildcard.SPEC_SCHEMA, "schema_name": "wildcard",
                "temperature": 0.8}
    if kind == "derivation":
        idx = ref_index(plan, built, library)
        user = ai_derivation.build_prompt(
            instruction=item["about"] + fix, name=item["name"],
            catalog_text=library_vars.describe(_catalog(plan, built)),
            existing_rules=[], description=_pack_line(plan), refs_text=idx.describe(),
        )
        return {"system": ai_derivation.SYSTEM_PROMPT, "user": user,
                "schema": ai_derivation.SCHEMA, "schema_name": "derivation_rules",
                "temperature": 0.3}
    if kind == "constraint":
        src, tgt = _constraint_sides(plan, item, built)
        user = ai_constraint.build_prompt(
            instruction=item["about"] + fix, source=src, target=tgt, existing=[],
            name=item["name"], description=_pack_line(plan),
        )
        return {"system": ai_constraint.SYSTEM_PROMPT, "user": user,
                "schema": ai_constraint.SCHEMA, "schema_name": "constraint_rules",
                "temperature": 0.3}
    cat = _catalog(plan, built)
    if kind in ("combine", "fixed_values"):
        cat.pop(item["var"], None)
    user = text_items.build_prompt(
        kind=kind, instruction=item["about"] + fix, name=item["name"],
        catalog_text=library_vars.describe(cat), description=_pack_line(plan),
        out_var=item["var"] if kind == "combine" else "",
    )
    system, schema, name = {
        "fixed_values": (text_items.FIXED_SYSTEM, text_items.FIXED_SCHEMA, "fixed_values"),
        "combine": (text_items.COMBINE_SYSTEM, text_items.COMBINE_SCHEMA, "combine"),
        "template": (text_items.TEMPLATE_SYSTEM, text_items.TEMPLATE_SCHEMA, "template"),
    }[kind]
    return {"system": system, "user": user, "schema": schema, "schema_name": name,
            "temperature": 0.4}


def _constraint_sides(
    plan: dict[str, Any], item: dict[str, Any], built: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    by_var = {i["var"]: i for i in plan["items"] if is_wild(i)}
    sides = []
    for var, prefix in ((item["source"], "S"), (item["target"], "T")):
        w = by_var.get(var)
        b = built.get(w["key"]) if w else None
        if not isinstance(b, dict):
            raise PlanError(f"build ${var} before {item['name']}")
        sides.append(ai_constraint.side_view(_wildcard_view(w, b), prefix))
    return sides[0], sides[1]


def new_id(taken: set[str]) -> str:
    while True:
        mid = secrets.token_hex(4)
        if mid not in taken:
            taken.add(mid)
            return mid


def _reads(text: str) -> list[str]:
    return list(dict.fromkeys(_VAR_READ.findall(text)))


def compile_item(
    plan: dict[str, Any], key: str, built: dict[str, Any], answer: Any, *,
    taken: set[str] | None = None, item_id: str = "",
    library: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The model's answer for one item as ``{key, id, kind, payload,
    preview, warnings}``. A template's payload is ``{template_string,
    negative_template}``. Raises ValueError when nothing usable came back."""
    item = _item(plan, key)
    kind = item["kind"]
    taken = taken if taken is not None else set()
    mid = item_id if _HEX8.match(item_id or "") else new_id(
        taken | {r["id"] for r in library or [] if isinstance(r.get("id"), str)})
    warnings: list[str] = []
    preview: list[str] = []
    if kind == "wildcard":
        idx = ref_index(plan, {k: v for k, v in built.items() if k != key}, library)
        compiled = ai_wildcard.compile_spec(
            answer, var=item["var"] or None, refs=idx, self_id=mid, limit=item["count"],
            existing_payload={"options": [], "sub_categories": list(item["tags"])},
        )
        payload = compiled["payload"]
        used = {t for o in payload["options"] for t in o.get("sub_categories") or []}
        payload["sub_categories"] = [t for t in payload["sub_categories"] if t in used
                                     or t in {x for v in (payload.get("tag_groups") or {})
                                              .values() for x in v}]
        WildcardHandler.validate_payload(payload)
        missing = [t for t in item["tags"] if t not in used]
        if missing:
            warnings.append("No option carries #" + ", #".join(missing))
        warnings += compiled["warnings"]
        preview = [ai_wildcard.option_line(o, idx) for o in payload["options"]]
        if item["use"]:
            warnings += _use_notes(item, payload)
    elif kind == "derivation":
        compiled = ai_derivation.compile_rules(answer, catalog=_catalog(plan, built),
                                               refs=ref_index(plan, built, library))
        if not compiled["rules"]:
            raise ValueError("no usable rules" + "".join(
                f"; {s['text'][:40]}: {s['reason']}" for s in compiled["skipped"][:3]))
        payload = {"rules": [r["rule"] for r in compiled["rules"]]}
        DerivationHandler.validate_payload(payload)
        preview = [ai_derivation.describe_rule(r) for r in payload["rules"]]
        warnings += list(dict.fromkeys(w for r in compiled["rules"] for w in r["warnings"]))
        warnings += [f"Left out {s['text'][:60]}: {s['reason']}"
                     for s in compiled["skipped"][:5]]
    elif kind == "constraint":
        src, tgt = _constraint_sides(plan, item, built)
        compiled = ai_constraint.compile_rules(answer, source=src, target=tgt)
        if not compiled["cells"] and not compiled["exceptions"]:
            raise ValueError("no usable rules" + "".join(
                f"; {s['text'][:40]}: {s['reason']}" for s in compiled["skipped"][:3]))
        matrix: dict[str, dict[str, Any]] = {}
        for c in compiled["cells"]:
            matrix.setdefault(c["source_tag"], {})[c["target_tag"]] = c["cell"]
        by_var = {i["var"]: i for i in plan["items"] if is_wild(i)}
        payload = {
            "source_wildcard_id": built[by_var[item["source"]]["key"]]["id"],
            "target_wildcard_id": built[by_var[item["target"]]["key"]]["id"],
            "matrix": matrix, "exceptions": [e["exception"] for e in compiled["exceptions"]],
        }
        ConstraintHandler.validate_payload(payload)
        preview = [f"#{c['source_tag']} → #{c['target_tag']}: {c['cell']['mode']}"
                   for c in compiled["cells"]] + [
            f"{e['exception']['source']} → {e['exception']['target']}: "
            f"{e['exception']['mode']}" for e in compiled["exceptions"]]
        warnings += [f"Left out {s['text'][:60]}: {s['reason']}"
                     for s in compiled["skipped"][:5]]
    elif kind == "fixed_values":
        out = text_items.compile_fixed(answer)
        payload, preview, warnings = out["payload"], out["preview"], out["warnings"]
        names = [v["name"] for v in payload["values"]]
        if item["var"] not in names:
            warnings.append(f"It doesn't set ${item['var']}")
    elif kind == "combine":
        cat = _catalog(plan, built)
        out = text_items.compile_combine(answer, out_var=item["var"], catalog=cat)
        payload, preview, warnings = out["payload"], out["preview"], out["warnings"]
    else:
        out = text_items.compile_template(answer, catalog=_catalog(plan, built))
        payload, preview, warnings = out["payload"], out["preview"], out["warnings"]
    return {"key": key, "id": mid, "kind": kind, "payload": payload,
            "preview": preview, "warnings": warnings, "repair": repair_note(warnings)}


#: Compile warnings worth one automatic rebuild: the item doesn't fit the
#: rest of the pack (a rule tests a value or tag that isn't there).
_REPAIRABLE = re.compile(r"has no option|No option carries|unknown tag|nothing sets|"
                         r"isn't set|not a variable|doesn't set|which no", re.I)


def repair_note(warnings: list[str]) -> str:
    """The warnings a rebuild should fix, as its note; "" when none."""
    hits = [w for w in warnings if _REPAIRABLE.search(w)]
    return "; ".join(hits)[:600]


def _use_notes(item: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    _inst, notes = ai_use.parse_use(item["use"], kind=item["kind"],
                                    tags=payload.get("sub_categories") or [])
    return [f"Use: {n}" for n in notes]


def item_instance(item: dict[str, Any], payload: dict[str, Any] | None) -> dict[str, Any]:
    """The item's use line as the instance its bundle child carries."""
    if not item.get("use"):
        return {}
    tags = (payload or {}).get("sub_categories") if item["kind"] in (
        "wildcard", "library") else None
    inst, _notes = ai_use.parse_use(item["use"], kind=item["kind"], tags=tags)
    return inst


def parse_built(plan: dict[str, Any], raw: Any) -> dict[str, dict[str, Any]]:
    """The built items the manager sends back, checked again: each payload
    goes through its handler, and constraints must point at the pack's own
    wildcards. Unknown keys and bad entries are dropped."""
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return out
    kinds = {i["key"]: i["kind"] for i in plan["items"]}
    ids: set[str] = set()
    for key, b in raw.items():
        kind = kinds.get(key)
        if kind is None or not isinstance(b, dict) or not isinstance(b.get("payload"), dict):
            continue
        mid = b.get("id")
        if not isinstance(mid, str) or not _HEX8.match(mid) or mid in ids:
            continue
        payload = b["payload"]
        try:
            if kind in ("wildcard", "library"):
                WildcardHandler.validate_payload(payload)
            elif kind == "fixed_values":
                FixedValuesHandler.validate_payload(payload)
            elif kind == "derivation":
                DerivationHandler.validate_payload(payload)
            elif kind == "combine":
                CombineHandler.validate_payload(payload)
            elif kind == "constraint":
                ConstraintHandler.validate_payload(payload)
            else:
                text = payload.get("template_string")
                neg = payload.get("negative_template", "")
                if not isinstance(text, str) or not text.strip() or not isinstance(neg, str):
                    continue
        except ValueError:
            continue
        ids.add(mid)
        out[key] = {"id": mid, "payload": copy.deepcopy(payload)}
    wild_ids = {out[i["key"]]["id"] for i in plan["items"]
                if i["kind"] in ("wildcard", "library") and i["key"] in out}
    for i in plan["items"]:
        b = out.get(i["key"])
        if i["kind"] == "constraint" and b is not None and not (
                b["payload"].get("source_wildcard_id") in wild_ids
                and b["payload"].get("target_wildcard_id") in wild_ids):
            del out[i["key"]]
    return out


# ── check ───────────────────────────────────────────────────────────────


def chain_modules(plan: dict[str, Any], built: dict[str, Any]) -> list[dict[str, Any]]:
    """The built modules in run order, in the list shape the engine takes,
    each with its use line as its instance."""
    items = {i["key"]: i for i in plan["items"]}
    out = []
    for n, key in enumerate(chain_order(plan, built)):
        b = built.get(key)
        if b is None:
            continue
        i = items[key]
        out.append({
            "id": b["id"], "_uid": f"pack.{n}", "enabled": True,
            "type": "wildcard" if i["kind"] == "library" else i["kind"],
            "name": i["name"], "meta": {"name": i["name"], "library_name": i["name"]},
            "payload": copy.deepcopy(b["payload"]),
            "payload_hash": payload_hash(b["payload"]),
            "instance": item_instance(i, b["payload"]),
        })
    return out


def ref_catalog(
    modules: list[dict[str, Any]], rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """The ``@{uuid}`` catalog a run needs: every wildcard the modules point
    at, transitively, from ``rows`` (the pack's and the library's)."""
    by_id = {r["id"]: r for r in rows if isinstance(r.get("id"), str)
             and r.get("type", "wildcard") == "wildcard"}
    roots = sorted({t for m in modules for t in _ids_in(m)} | {
        m["id"] for m in modules if m.get("type") == "wildcard"})
    if not roots:
        return {}

    def fetch(uuid: str) -> dict[str, Any] | None:
        r = by_id.get(uuid)
        if r is None:
            return None
        return {"id": uuid, "type": "wildcard", "name": r.get("name", ""),
                "payload": r["payload"], "payload_hash": payload_hash(r["payload"])}

    return walk_transitive_refs(roots, fetch_module=fetch).snapshots


def _ids_in(module: dict[str, Any]) -> set[str]:
    text = json.dumps(module.get("payload") or {})
    return set(re.findall(r"@\{([0-9a-f]{8})", text))


def _template(plan: dict[str, Any], built: dict[str, Any]) -> tuple[dict[str, Any], str] | None:
    for i in plan["items"]:
        if i["kind"] == "template" and i["key"] in built:
            return i, built[i["key"]]["payload"]["template_string"]
    return None


def pins(plan: dict[str, Any]) -> dict[str, str]:
    """Each input's example, as the check pins it."""
    return {i["var"]: i["example"] or i["var"].replace("_", " ")
            for i in plan.get("inputs") or []}


def render(text: str, negative: str, ctx: dict[str, Any]) -> tuple[str, str]:
    """A template and its negative the way the Assembler renders them."""
    from engine.negatives import entries_for_reads, join_unique, render_negative
    from engine.template import resolve_variables, resolve_variables_raw

    reads: list[Any] = []
    prompt = resolve_variables(text, ctx, reads=reads)
    collected = join_unique(str(e.get("text", "")) for e in entries_for_reads(ctx, reads))
    neg = render_negative(negative, collected, lambda t: resolve_variables_raw(t, ctx))
    return prompt, neg


def check_pack(
    plan: dict[str, Any], built: dict[str, Any], *, seeds: int = CHECK_SEEDS,
    library: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run the pack on the engine. Returns ``{runs, failed, problems:
    {key: [text]}, notes: [text], variables: [{var, distinct, top}],
    prompts: [{seed, text, negative}]}``. ``problems`` are what an item's
    repair gets told; ``notes`` are pack-wide. Inputs are pinned to their
    examples; refs resolve against the pack and ``library``."""
    from engine.pipeline import PipelineEngine
    from engine.scenario import run_scenario

    modules = chain_modules(plan, built)
    rows = [*(r for r in library or [] if r.get("type") == "wildcard"),
            *(r for r in _built_rows(plan, built) if r["type"] == "wildcard")]
    catalog = ref_catalog(modules, rows)
    pinned = pins(plan)
    by_id = {}
    for i in plan["items"]:
        if i["key"] in built:
            by_id[built[i["key"]]["id"]] = i["key"]
    problems: dict[str, list[str]] = {}
    notes: list[str] = []
    quality: list[dict[str, str]] = []
    missing = [i["name"] for i in plan["items"] if i["key"] not in built]
    if missing:
        notes.append("Not built: " + ", ".join(missing))
    seed_list = list(range(1, max(1, seeds) + 1))
    report = run_scenario(modules, seeds=seed_list, catalog=catalog, pins=pinned,
                          sample_limit=0, value_limit=MAX_COUNT + 20)
    for w in report["warnings"]:
        key = by_id.get(str(w.get("owner_id") or w.get("module_id") or ""))
        detail = w.get("detail") if isinstance(w.get("detail"), dict) else {}
        what = detail.get("hint") or w.get("message") or w.get("type")
        text = f"{what} ({w['count']} of {report['runs']} runs)"
        if key:
            problems.setdefault(key, []).append(text)
        else:
            notes.append(text)
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
    tpl = _template(plan, built)
    prompts: list[dict[str, Any]] = []
    if tpl is not None:
        item, text = tpl
        set_vars = set(report["variables"]) | set(pinned)
        unset = [v for v in _reads(text) if v not in set_vars]
        if unset:
            problems.setdefault(item["key"], []).append(
                "reads $" + ", $".join(unset) + ", which no run set")
        neg = built[item["key"]]["payload"].get("negative_template") or ""
        braces = 0
        for seed in seed_list[:SAMPLE_PROMPTS]:
            try:
                ctx = PipelineEngine().run(copy.deepcopy(modules),
                                           ctx={**pinned, "__wp_catalog__": catalog}, seed=seed)
                prompt, negative = render(text, neg, ctx)
                if re.search(r"[{}]|@\{", prompt):
                    braces += 1
                prompts.append({"seed": seed, "text": prompt, "negative": negative})
            except Exception as exc:  # noqa: BLE001 - shown, not raised
                prompts.append({"seed": seed, "text": f"(failed: {exc})", "negative": ""})
        if braces:
            problems.setdefault(item["key"], []).append(
                "the prompt shows { } or @{ } as written: a variable it reads holds a pick "
                "the Assembler can't make")
    return {"runs": report["runs"], "failed": report["failed"], "problems": problems,
            "notes": notes, "variables": variables, "prompts": prompts, "quality": quality}


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


# ── install ─────────────────────────────────────────────────────────────


def collection_tag(title: str) -> str:
    tag = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:32].strip("-")
    return tag or "ai-pack"


def _remap_refs(payload: dict[str, Any], remap: dict[str, str]) -> dict[str, Any]:
    moved = {old: new for old, new in remap.items() if old != new}
    if not moved:
        return payload
    text = json.dumps(payload)
    text = re.sub(r"@\{([0-9a-f]{8})", lambda m: "@{" + moved.get(m.group(1), m.group(1)), text)
    return json.loads(text)


def wiring_notes(plan: dict[str, Any]) -> list[str]:
    """How to use the pack on the canvas, one step per line."""
    out = [f"Add a WP Context node and insert the bundle \"{plan['title']}\"."]
    for i in plan.get("inputs") or []:
        out.append(f"Bring ${i['var']} in with a WP Context Injector row named {i['var']}"
                   + (f" ({i['about']})" if i["about"] else "") + ", above the Context.")
    if any(i["kind"] == "template" for i in plan["items"]):
        out.append("Add a WP Prompt Assembler after it and load the template "
                   f"\"{next(i['name'] for i in plan['items'] if i['kind'] == 'template')}\".")
    if any("hold" in (i.get("use") or "") for i in plan["items"]):
        out.append("Items set to hold keep their pick across a WP Context Loop run.")
    return out


def install_ops(
    plan: dict[str, Any], built: dict[str, Any], *, taken: set[str],
    template_ids: set[str], bundle_ids: set[str],
) -> dict[str, Any]:
    """An import commit for the pack: ``{adds, ids: {key: id}, bundle_id,
    template_id, tag, notes}``. Ids already in the library are swapped for
    fresh ones; constraints, refs and the bundle follow. Vocabularies are
    installed but stay out of the bundle (refs reach them)."""
    tag = collection_tag(plan["title"])
    remap: dict[str, str] = {}
    used = set(taken)
    for i in plan["items"]:
        b = built.get(i["key"])
        if b is None or i["kind"] in ("template", "library"):
            continue
        remap[b["id"]] = new_id(used) if b["id"] in used else b["id"]
        used.add(remap[b["id"]])
    fixed: dict[str, dict[str, Any]] = {}
    for key, b in built.items():
        p = _remap_refs(copy.deepcopy(b["payload"]), remap)
        if "source_wildcard_id" in p:
            p["source_wildcard_id"] = remap.get(p["source_wildcard_id"], p["source_wildcard_id"])
            p["target_wildcard_id"] = remap.get(p["target_wildcard_id"], p["target_wildcard_id"])
        fixed[key] = {"id": remap.get(b["id"], b["id"]), "payload": p}
    adds: list[dict[str, Any]] = []
    ids: dict[str, str] = {}
    template_id = ""
    for i in plan["items"]:
        b = fixed.get(i["key"])
        if b is None:
            continue
        if i["kind"] == "template":
            template_id = new_id(set(template_ids))
            ids[i["key"]] = template_id
            adds.append({"kind": "template", "entity": {
                "id": template_id, "name": i["name"], "description": i["about"],
                "tags": [tag], "template_string": b["payload"]["template_string"],
                "negative_template": b["payload"].get("negative_template") or None,
            }})
            continue
        ids[i["key"]] = b["id"]
        if i["kind"] == "library":
            continue  # already in the library; only the bundle uses it
        adds.append({"kind": i["kind"], "entity": {
            "id": b["id"], "name": i["name"], "description": i["about"], "tags": [tag],
            "payload": b["payload"], "content_rating": plan["rating"],
        }})
    children = []
    for m in chain_modules(plan, fixed):
        children.append({
            "id": m["id"], "type": m["type"], "enabled": True, "collapsed": False,
            "meta": m["meta"], "payload": m["payload"], "payload_hash": m["payload_hash"],
            "instance": m["instance"], "entries": [],
        })
    bundle_id = new_id(set(bundle_ids) | used)
    adds.append({"kind": "bundle", "entity": {
        "id": bundle_id, "name": plan["title"], "description": plan["summary"],
        "tags": [tag], "children": children, "content_rating": plan["rating"],
    }})
    return {"adds": adds, "ids": ids, "bundle_id": bundle_id,
            "template_id": template_id, "tag": tag, "notes": wiring_notes(plan)}


# ── whole run (evals) ───────────────────────────────────────────────────

#: ``await complete(system=, user=, schema=, schema_name=, temperature=)``
#: returns the model's JSON answer; raises on a failed call.
Complete = Any


async def run_pack(
    complete: Complete, instruction: str, *, seeds: int = 100, repairs: int = 2,
    library: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Plan, build, check and repair a pack the way the manager does, for
    the eval script. Returns ``{plan, built, check, log, failed}``; ``failed``
    lists the items that never built. Raises PlanError when the plan fails."""
    log: list[str] = []
    lib_note = ai_patterns.note(ai_patterns.summarize(library or []))
    answer = await complete(system=PLAN_SYSTEM,
                            user=plan_prompt(instruction, library_note=lib_note),
                            schema=PLAN_SCHEMA, schema_name="pack_plan", temperature=0.4)
    plan = compile_plan(answer, library=library)
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
                continue
            built[key] = {"id": out["id"], "payload": out["payload"]}
            log.extend(f"{key}: {w}" for w in out["warnings"])
            if out["repair"] and not note:
                log.append(f"{key} fix: {out['repair']}")
                return await build(key, out["repair"]) or True
            return True
        return False

    for key in build_order(plan):
        if not await build(key):
            failed.append(key)
    report = check_pack(plan, built, seeds=seeds, library=library) if built else None
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
        report = check_pack(plan, built, seeds=seeds, library=library)
    return {"plan": plan, "built": built, "check": report, "log": log, "failed": failed}
