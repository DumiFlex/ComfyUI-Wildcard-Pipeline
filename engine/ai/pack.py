"""Pack builder: a whole pack of modules from one description.

Four steps, each its own request so a small local model stays on track:

1. **Plan.** The model writes an outline (`PLAN_SCHEMA`): the pack's title,
   up to three questions it can't guess, and a list of items by name and
   variable (wildcards, derivations, combines, constraints, one template).
   `compile_plan` checks it and gives every item a key.
2. **Build.** One call per item in `build_order`, with the same prompts and
   checkers the editor panels use (`wildcard`, `derivation`, `constraint`),
   or the small combine/template schemas here. Later items see what earlier
   ones built, so a constraint knows its wildcards' tags.
3. **Check.** `check_pack` runs the pack on the real engine for a few
   hundred seeds and lists, per item, what went wrong, plus sample prompts.
4. **Install.** `install_ops` turns the pack into one import commit (the
   modules, the template and a bundle, tagged as one collection), so one
   undo removes all of it.

The model never writes ids, `sub_categories`, `@{uuid}` refs or rule ids;
every payload is built here and validated by its engine handler. The
manager holds the plan and the built items between requests, so nothing is
kept on the server.
"""
from __future__ import annotations

import copy
import re
import secrets
from typing import Any

from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import library_vars
from engine.ai import wildcard as ai_wildcard
from engine.modules.combine_handler import CombineHandler
from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.derivation_handler import DerivationHandler
from engine.modules.snapshot import payload_hash
from engine.modules.wildcard_handler import WildcardHandler

KINDS = ("wildcard", "derivation", "combine", "constraint", "template")
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
    "questions": {"type": "array", "items": _obj({"question": _STR, "choices": _STRS})},
    "items": {"type": "array", "items": _obj({
        "kind": {"type": "string", "enum": list(KINDS)},
        "name": _STR,
        "var": _STR,
        "about": _STR,
        "count": {"type": "integer"},
        "tags": _STRS,
        "source": _STR,
        "target": _STR,
    })},
})

PLAN_SYSTEM = """\
You plan prompt packs for Wildcard Pipeline, a ComfyUI extension that builds \
image-generation prompts from modules chained in order:
- wildcard: a list of options bound to a $variable; each run picks one. Its \
options can carry tags (one lowercase word each) that rules refer to.
- derivation: IF/ELSE rules that read variables and set others ("when $class \
is mage, set $title to Archmage").
- combine: a template that joins variables into a new one ("$race $class").
- constraint: links a SOURCE wildcard to a TARGET wildcard so the source's \
pick changes the target's odds (exclude, reduce, boost, only), usually by tag.
- template: the final prompt, reading the variables.

Plan a self-contained pack for the request. Answer with:
- title: a short pack name. summary: one sentence on what it makes.
- rating: "nsfw" if the pack is sexual or explicit, else "safe".
- questions: up to 3 things you can't guess that would change the plan, each \
with 2 to 4 short choices. Ask only when it matters; [] is fine. Still write a \
full plan using the most likely answers.
- items, each with every field (use "" / 0 / [] where a field doesn't apply):
  - wildcard: name, var (its variable, no $), about (what its options are), \
count (how many options, 6 to 40), tags (option tags rules will use).
  - derivation: name, var (the main variable it sets), about (the rules in \
plain words, naming variables with $).
  - combine: name, var (the variable it sets), about (which $variables it \
joins and how).
  - constraint: name, source and target (the two wildcards' variables, no $), \
about (the rules in words, by tag: "#caster gets only #robe outfits").
  - template: exactly one, last: name, about (what the prompt reads, with \
$variables).
Every variable a derivation, combine or template reads must be set by an \
earlier item. Give rules something to work with: a constraint's tags must be \
tags its two wildcards carry. Variable names: letters, digits and _. Keep it \
to what the request needs; at most 20 items. Don't add commentary; the output \
is data for the user's own library.\
"""

COMBINE_SCHEMA = _obj({"template": _STR})
TEMPLATE_SCHEMA = _obj({"template": _STR, "negative": _STR})

TEXT_SYSTEM = """\
You write prompt text for Wildcard Pipeline, a ComfyUI extension that builds \
image-generation prompts. Read variables with $name; only the variables \
listed are available. {a|b} picks one of a or b at random. Write the text \
exactly as it should appear, in the style of the options listed (usually \
comma-separated tags). Never use @{...}. Don't add commentary; the output is \
data for the user's own library.\
"""


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


def compile_plan(raw: Any) -> dict[str, Any]:
    """The model's plan (or one the manager sends back) as a checked plan:
    ``{title, summary, rating, questions, items: [{key, kind, name, var,
    about, count, tags, source, target}], warnings}``. Items the manager sent
    keep their keys. Raises PlanError when nothing usable is left."""
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
    items: list[dict[str, Any]] = []
    keys: set[str] = set()
    sets: dict[str, str] = {}
    next_key = 1
    template_seen = False
    for it in raw["items"]:
        if not isinstance(it, dict) or it.get("kind") not in KINDS:
            continue
        kind = it["kind"]
        name = _clean(it.get("name"), MAX_NAME)
        about = _clean(it.get("about"), MAX_ABOUT)
        var = _var(it.get("var"))
        if kind == "template":
            if template_seen:
                warnings.append(f"Left out a second template, {name or 'unnamed'}")
                continue
            template_seen = True
        if kind in ("wildcard", "combine") and not var:
            warnings.append(f"Left out {kind} {name or 'unnamed'}: it needs a variable")
            continue
        if kind == "derivation" and not about:
            warnings.append(f"Left out derivation {name or 'unnamed'}: it says no rules")
            continue
        if kind in ("wildcard", "combine") and var in sets:
            warnings.append(f"Left out {name or var}: ${var} is already set by {sets[var]}")
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
            "name": name or (f"${var}" if var else kind.title()),
            "var": var, "about": about,
            "count": max(MIN_COUNT, min(MAX_COUNT, count)) if kind == "wildcard" else 0,
            "tags": list(dict.fromkeys(
                t for t in (_tag(x) for x in it.get("tags") or []) if t))[:12]
            if kind == "wildcard" else [],
            "source": _var(it.get("source")) if kind == "constraint" else "",
            "target": _var(it.get("target")) if kind == "constraint" else "",
        }
        if kind in ("wildcard", "combine", "derivation") and var:
            sets.setdefault(var, item["name"])
        items.append(item)
        if len(items) >= MAX_ITEMS:
            warnings.append(f"Kept the first {MAX_ITEMS} items")
            break
    wildcard_vars = {i["var"]: i for i in items if i["kind"] == "wildcard"}
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
    if not any(i["kind"] == "wildcard" for i in kept):
        raise PlanError("the plan has no wildcards")
    rating = raw.get("rating") if raw.get("rating") in ("safe", "nsfw") else "safe"
    return {
        "title": _clean(raw.get("title"), MAX_NAME) or "AI pack",
        "summary": _clean(raw.get("summary"), 300),
        "rating": rating,
        "questions": questions[:MAX_QUESTIONS],
        "items": kept,
        "warnings": warnings,
    }


_BUILD_RANK = {"wildcard": 0, "derivation": 1, "combine": 2, "constraint": 3, "template": 4}


def build_order(plan: dict[str, Any]) -> list[str]:
    """Keys in the order to build them: what an item reads comes first."""
    items = list(enumerate(plan["items"]))
    items.sort(key=lambda p: (_BUILD_RANK[p[1]["kind"]], p[0]))
    return [i["key"] for _, i in items]


def chain_order(plan: dict[str, Any]) -> list[str]:
    """Keys of the modules in the order they run. A constraint needs its
    source picked before it and its target after it, so wildcards follow
    the constraint edges and each constraint sits just before its target.
    Derivations then combines come after the wildcards. A constraint whose
    edges loop back is placed last, where it does nothing; the check
    reports that."""
    items = plan["items"]
    wild = [i for i in items if i["kind"] == "wildcard"]
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
    chain: list[str] = []
    for v in ordered:
        for c in cons:
            if c["target"] == v and position[c["source"]] < position[v]:
                chain.append(c["key"])
        chain.append(by_var[v]["key"])
    chain += [c["key"] for c in cons if c["key"] not in chain]
    chain += [i["key"] for i in items if i["kind"] == "derivation"]
    chain += [i["key"] for i in items if i["kind"] == "combine"]
    return chain


def plan_prompt(instruction: str) -> str:
    return f"Request: {instruction.strip()}"


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


def _pack_line(plan: dict[str, Any]) -> str:
    return f"Part of the pack \"{plan['title']}\": {plan['summary']}".rstrip(": ")


def _built_rows(plan: dict[str, Any], built: dict[str, Any]) -> list[dict[str, Any]]:
    """Built modules as library-like rows (for the variable catalog)."""
    rows = []
    for i in plan["items"]:
        b = built.get(i["key"])
        if i["kind"] in ("wildcard", "derivation", "combine") and isinstance(b, dict):
            rows.append({"type": i["kind"], "name": i["name"], "description": i["about"],
                         "payload": b["payload"]})
    return rows


def _catalog(plan: dict[str, Any], built: dict[str, Any]) -> dict[str, dict[str, Any]]:
    cat = library_vars.build_catalog(_built_rows(plan, built))
    # Planned variables not built yet still count as known.
    for i in plan["items"]:
        if i["var"] and i["var"] not in cat and i["kind"] != "constraint":
            cat[i["var"]] = {"name": i["var"], "sources": [], "values": [], "tags": [],
                             "about": i["about"][:100]}
    return cat


def _wildcard_view(item: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    return {"id": b["id"], "name": item["name"], "description": item["about"],
            "payload": b["payload"]}


def item_request(
    plan: dict[str, Any], key: str, built: dict[str, Any], note: str = "",
) -> dict[str, Any]:
    """``{system, user, schema, schema_name, temperature}`` for one item."""
    item = _item(plan, key)
    kind = item["kind"]
    fix = f"\n\nThe last version had these problems; fix them: {note.strip()}" \
        if note.strip() else ""
    if kind == "wildcard":
        user = ai_wildcard.build_user_prompt(
            instruction=f"{item['about']} {_pack_line(plan)}."
            + (f" Tag options with these tags where they fit: {', '.join(item['tags'])}."
               if item["tags"] else "") + fix,
            count=item["count"], name=item["name"], var_binding=item["var"],
            existing_options=[], tags=item["tags"],
        )
        return {"system": ai_wildcard.SYSTEM_PROMPT, "user": user,
                "schema": ai_wildcard.OPTIONS_SCHEMA, "schema_name": "options",
                "temperature": 0.8}
    if kind == "derivation":
        user = ai_derivation.build_prompt(
            instruction=item["about"] + fix, name=item["name"],
            catalog_text=library_vars.describe(_catalog(plan, built)),
            existing_rules=[], description=_pack_line(plan),
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
    if kind == "combine":
        cat.pop(item["var"], None)
    lines = [_pack_line(plan), "", "Variables you can read:",
             library_vars.describe(cat) or "(none)", ""]
    if kind == "combine":
        lines.append(f"Write the text for ${item['var']} ({item['name']}): {item['about']}")
        lines.append("Answer with {\"template\": text}.")
        schema, name = COMBINE_SCHEMA, "combine"
    else:
        lines.append(f"Write the final prompt template \"{item['name']}\": {item['about']}")
        lines.append("Also write a short negative prompt, or \"\".")
        schema, name = TEMPLATE_SCHEMA, "template"
    return {"system": TEXT_SYSTEM, "user": "\n".join(lines) + fix,
            "schema": schema, "schema_name": name, "temperature": 0.4}


def _constraint_sides(
    plan: dict[str, Any], item: dict[str, Any], built: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    by_var = {i["var"]: i for i in plan["items"] if i["kind"] == "wildcard"}
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


def _text_answer(raw: Any, field: str) -> str:
    if not isinstance(raw, dict) or not isinstance(raw.get(field), str):
        raise ValueError(f"the answer had no {field}")
    text = raw[field].strip()
    if "@{" in text:
        raise ValueError("it points at a module by id")
    if not text:
        raise ValueError(f"the {field} is empty")
    return text[:MAX_TEMPLATE]


def compile_item(
    plan: dict[str, Any], key: str, built: dict[str, Any], answer: Any, *,
    taken: set[str] | None = None, item_id: str = "",
) -> dict[str, Any]:
    """The model's answer for one item as ``{key, id, kind, payload,
    preview, warnings}``. A template's payload is ``{template_string,
    negative_template}``. Raises ValueError when nothing usable came back."""
    item = _item(plan, key)
    kind = item["kind"]
    taken = taken if taken is not None else set()
    mid = item_id if _HEX8.match(item_id or "") else new_id(taken)
    warnings: list[str] = []
    preview: list[str] = []
    if kind == "wildcard":
        compiled = ai_wildcard.compile_options(
            answer, existing_payload={"options": [], "sub_categories": item["tags"]},
            limit=item["count"],
        )
        if not compiled["options"]:
            raise ValueError("no usable options")
        used = {t for o in compiled["options"] for t in o["tags"]}
        tags = [t for t in [*item["tags"], *compiled["new_tags"]] if t in used]
        options = []
        for o in compiled["options"]:
            opt: dict[str, Any] = {"id": new_id(set()), "value": o["value"],
                                   "weight": o["weight"], "sub_categories": o["tags"]}
            if o["negative"]:
                opt["negative"] = o["negative"]
            options.append(opt)
        payload: dict[str, Any] = {"var_binding": item["var"], "sub_categories": tags,
                                   "options": options}
        WildcardHandler.validate_payload(payload)
        missing = [t for t in item["tags"] if t not in used]
        if missing:
            warnings.append("No option carries #" + ", #".join(missing))
        warnings += [f"Left out {s['text'][:60]}: {s['reason']}"
                     for s in compiled["skipped"][:5]]
        preview = [o["value"] + (f"  #{' #'.join(o['tags'])}" if o["tags"] else "")
                   for o in compiled["options"]]
    elif kind == "derivation":
        compiled = ai_derivation.compile_rules(answer, catalog=_catalog(plan, built))
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
        by_var = {i["var"]: i for i in plan["items"] if i["kind"] == "wildcard"}
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
    else:
        cat = _catalog(plan, built)
        text = _text_answer(answer, "template")
        unknown = [v for v in _reads(text) if v not in cat or v == item["var"]]
        if unknown:
            warnings.append("Reads $" + ", $".join(unknown) + ", which nothing in the pack sets")
        if kind == "combine":
            payload = {"template": text, "output_var": item["var"],
                       "input_vars": [v for v in _reads(text) if v in cat]}
            CombineHandler.validate_payload(payload)
        else:
            neg = answer.get("negative") if isinstance(answer.get("negative"), str) else ""
            neg = neg.strip()[:MAX_TEMPLATE] if "@{" not in neg else ""
            payload = {"template_string": text, "negative_template": neg}
        preview = [text] + ([f"Negative: {payload['negative_template']}"]
                            if kind == "template" and payload["negative_template"] else [])
    return {"key": key, "id": mid, "kind": kind, "payload": payload,
            "preview": preview, "warnings": warnings}


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
            if kind == "wildcard":
                WildcardHandler.validate_payload(payload)
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
                if i["kind"] == "wildcard" and i["key"] in out}
    for i in plan["items"]:
        b = out.get(i["key"])
        if i["kind"] == "constraint" and b is not None and not (
                b["payload"].get("source_wildcard_id") in wild_ids
                and b["payload"].get("target_wildcard_id") in wild_ids):
            del out[i["key"]]
    return out


# ── check ───────────────────────────────────────────────────────────────


def chain_modules(plan: dict[str, Any], built: dict[str, Any]) -> list[dict[str, Any]]:
    """The built modules in run order, in the list shape the engine takes."""
    items = {i["key"]: i for i in plan["items"]}
    out = []
    for n, key in enumerate(chain_order(plan)):
        b = built.get(key)
        if b is None:
            continue
        i = items[key]
        out.append({
            "id": b["id"], "_uid": f"pack.{n}", "type": i["kind"], "enabled": True,
            "name": i["name"], "meta": {"name": i["name"], "library_name": i["name"]},
            "payload": copy.deepcopy(b["payload"]),
            "payload_hash": payload_hash(b["payload"]), "instance": {},
        })
    return out


def _template(plan: dict[str, Any], built: dict[str, Any]) -> tuple[dict[str, Any], str] | None:
    for i in plan["items"]:
        if i["kind"] == "template" and i["key"] in built:
            return i, built[i["key"]]["payload"]["template_string"]
    return None


def check_pack(
    plan: dict[str, Any], built: dict[str, Any], *, seeds: int = CHECK_SEEDS,
) -> dict[str, Any]:
    """Run the pack on the engine. Returns ``{runs, failed, problems:
    {key: [text]}, notes: [text], variables: [{var, distinct, top}],
    prompts: [{seed, text, negative}]}``. ``problems`` are what an item's
    repair gets told; ``notes`` are pack-wide."""
    from engine.pipeline import PipelineEngine
    from engine.scenario import run_scenario
    from engine.template import resolve_variables

    modules = chain_modules(plan, built)
    by_id = {}
    for i in plan["items"]:
        if i["key"] in built:
            by_id[built[i["key"]]["id"]] = i["key"]
    problems: dict[str, list[str]] = {}
    notes: list[str] = []
    missing = [i["name"] for i in plan["items"] if i["key"] not in built]
    if missing:
        notes.append("Not built: " + ", ".join(missing))
    seed_list = list(range(1, max(1, seeds) + 1))
    report = run_scenario(modules, seeds=seed_list, sample_limit=0, value_limit=5)
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
        if i["kind"] in ("wildcard", "derivation", "combine") and i["var"]:
            v = report["variables"].get(i["var"])
            if v is None:
                if i["key"] in built:
                    problems.setdefault(i["key"], []).append(f"${i['var']} was never set")
                continue
            total = sum(v["counts"].values()) + v["other"]
            top = [{"value": k, "share": round(n / total, 3) if total else 0}
                   for k, n in list(v["counts"].items())[:3]]
            variables.append({"var": i["var"], "distinct": v["distinct"], "top": top})
    tpl = _template(plan, built)
    prompts: list[dict[str, Any]] = []
    if tpl is not None:
        item, text = tpl
        set_vars = set(report["variables"])
        unset = [v for v in _reads(text) if v not in set_vars]
        if unset:
            problems.setdefault(item["key"], []).append(
                "reads $" + ", $".join(unset) + ", which no run set")
        neg = built[item["key"]]["payload"].get("negative_template") or ""
        for seed in seed_list[:SAMPLE_PROMPTS]:
            try:
                ctx = PipelineEngine().run(copy.deepcopy(modules), ctx={}, seed=seed)
                prompts.append({"seed": seed, "text": resolve_variables(text, ctx),
                                "negative": resolve_variables(neg, ctx) if neg else ""})
            except Exception as exc:  # noqa: BLE001 - shown, not raised
                prompts.append({"seed": seed, "text": f"(failed: {exc})", "negative": ""})
    return {"runs": report["runs"], "failed": report["failed"], "problems": problems,
            "notes": notes, "variables": variables, "prompts": prompts}


# ── install ─────────────────────────────────────────────────────────────


def collection_tag(title: str) -> str:
    tag = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:32].strip("-")
    return tag or "ai-pack"


def install_ops(
    plan: dict[str, Any], built: dict[str, Any], *, taken: set[str],
    template_ids: set[str], bundle_ids: set[str],
) -> dict[str, Any]:
    """An import commit for the pack: ``{adds, ids: {key: id}, bundle_id,
    template_id, tag}``. Ids already in the library are swapped for fresh
    ones and the constraints and bundle follow."""
    tag = collection_tag(plan["title"])
    remap: dict[str, str] = {}
    used = set(taken)
    for i in plan["items"]:
        b = built.get(i["key"])
        if b is None or i["kind"] == "template":
            continue
        remap[b["id"]] = new_id(used) if b["id"] in used else b["id"]
        used.add(remap[b["id"]])
    fixed: dict[str, dict[str, Any]] = {}
    for key, b in built.items():
        p = copy.deepcopy(b["payload"])
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
        adds.append({"kind": i["kind"], "entity": {
            "id": b["id"], "name": i["name"], "description": i["about"], "tags": [tag],
            "payload": b["payload"], "content_rating": plan["rating"],
        }})
    children = []
    for m in chain_modules(plan, fixed):
        children.append({
            "id": m["id"], "type": m["type"], "enabled": True, "collapsed": False,
            "meta": m["meta"], "payload": m["payload"], "payload_hash": m["payload_hash"],
            "instance": {}, "entries": [],
        })
    bundle_id = new_id(set(bundle_ids) | used)
    adds.append({"kind": "bundle", "entity": {
        "id": bundle_id, "name": plan["title"], "description": plan["summary"],
        "tags": [tag], "children": children, "content_rating": plan["rating"],
    }})
    return {"adds": adds, "ids": ids, "bundle_id": bundle_id,
            "template_id": template_id, "tag": tag}


# ── whole run (evals) ───────────────────────────────────────────────────

#: ``await complete(system=, user=, schema=, schema_name=, temperature=)``
#: returns the model's JSON answer; raises on a failed call.
Complete = Any


async def run_pack(
    complete: Complete, instruction: str, *, seeds: int = 100, repairs: int = 2,
) -> dict[str, Any]:
    """Plan, build, check and repair a pack the way the manager does, for
    the eval script. Returns ``{plan, built, check, log, failed}``; ``failed``
    lists the items that never built. Raises PlanError when the plan fails."""
    log: list[str] = []
    answer = await complete(system=PLAN_SYSTEM, user=plan_prompt(instruction),
                            schema=PLAN_SCHEMA, schema_name="pack_plan", temperature=0.4)
    plan = compile_plan(answer)
    log += [f"plan: {w}" for w in plan["warnings"]]
    built: dict[str, dict[str, Any]] = {}
    failed: list[str] = []

    async def build(key: str, note: str = "") -> bool:
        for attempt in range(2):
            try:
                req = item_request(plan, key, built, note)
                raw = await complete(**req)
                old = built.get(key)
                out = compile_item(plan, key, built, raw,
                                   taken={b["id"] for b in built.values()},
                                   item_id=old["id"] if old else "")
            except (ValueError, PlanError) as e:
                log.append(f"{key} attempt {attempt + 1}: {e}")
                continue
            except Exception as e:  # noqa: BLE001 - a failed call is a scored miss
                log.append(f"{key} attempt {attempt + 1}: {type(e).__name__}: {e}")
                continue
            built[key] = {"id": out["id"], "payload": out["payload"]}
            log.extend(f"{key}: {w}" for w in out["warnings"])
            return True
        return False

    for key in build_order(plan):
        if not await build(key):
            failed.append(key)
    report = check_pack(plan, built, seeds=seeds) if built else None
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
        report = check_pack(plan, built, seeds=seeds)
    return {"plan": plan, "built": built, "check": report, "log": log, "failed": failed}
