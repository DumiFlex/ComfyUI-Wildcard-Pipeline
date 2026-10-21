"""Pack builder plan: `compile_plan` (keys, reserved ids, checks), the plan
answer, and the build / chain / run orders."""
from __future__ import annotations

import re
from typing import Any

from engine.ai import library_vars
from engine.ai.pack._common import (
    _HEX8,
    _KEY,
    _TAG_REF,
    _VAR_READ,
    DEFAULT_COUNT,
    ITEM_SCHEMA,
    KINDS,
    MAX_ABOUT,
    MAX_ASSUMPTIONS,
    MAX_CHOICES,
    MAX_COUNT,
    MAX_FROM_IMAGES,
    MAX_INPUTS,
    MAX_ITEMS,
    MAX_NAME,
    MAX_QUESTIONS,
    MAX_RESEARCH,
    MAX_SECTIONS,
    MAX_USE,
    MIN_COUNT,
    MIN_SECTIONED,
    STYLES,
    PlanError,
    _clean,
    _model,
    _tag,
    _var,
    is_wild,
    module_type,
    new_id,
)
from engine.ai.pack.plan_rules import (
    _asked_colours,
    _case_rules,
    _drop_loose_groups,
    _drop_unasked_drivers,
    _drop_unasked_subject,
    _fit_rules,
    _light_follows_weather,
    _merge_splits,
    _never_from_request,
    _only_in_rules,
    _stray_rule_tags,
    _strip_case_suffixes,
)
from engine.ai.pack.settings import (
    _same_question,
    canvas_vars,
    parse_decisions,
    parse_run,
    parse_settings,
)

_PICKS = re.compile(r"@\{[^}]*\}|\{[^{}]*\|[^{}]*\}")
_LORA = re.compile(r"lora|lycoris|locon", re.I)
#: Words that say the user brings something at run time ("my OC", "a
#: character I give it"): without one, the pack rolls everything itself.
_GIVEN = re.compile(r"\b(my|mine|our|i'?ll|i will|i give|i type|i pick|i choose|given|"
                    r"supplied|supply|provide[ds]?|typed?|inputs?|injector|own|whatever|"
                    r"any character|fill in|lora)\b|lora", re.I)


_GENERIC = {"character", "subject", "person", "input", "name", "prompt", "text", "base",
            "main", "user", "custom", "given"}


#: Tags a plan item lists (a graph slot lists every axis value).
MAX_TAGS = 48


def _names_input(var: str, request: str) -> bool:
    """Whether the request names what the input is ("my character's
    gender" for $character_gender): its own words, or its generic word
    ("character") when it has nothing else."""
    parts = [p for p in var.lower().split("_") if len(p) >= 3]
    own = [p for p in parts if p not in _GENERIC] or parts
    low = request.lower()
    return any(re.search(r"\b" + re.escape(p.rstrip("s")) + r"(?:s|es|'s)?\b", low)
               for p in own)


def _inputs(raw: Any, warnings: list[str]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for i in raw if isinstance(raw, list) else []:
        if not isinstance(i, dict):
            continue
        var = _var(i.get("var"))
        if not var or any(x["var"] == var for x in out):
            continue
        example = _clean(i.get("example"), 200)
        if _PICKS.search(example):
            # Pinned as typed, so a pick would land in the prompt as written.
            example = _clean(_PICKS.sub("", example), 200).strip(" ,")
        out.append({"var": var, "about": _clean(i.get("about"), 200), "example": example})
    if len(out) > MAX_INPUTS:
        warnings.append(f"Kept the first {MAX_INPUTS} inputs")
    return out[:MAX_INPUTS]


#: A library item that isn't in the library is made new: as fixed values
#: when it reads like a preset, else as a wildcard.
_PRESETISH = re.compile(r"\b(preset|quality|fixed|standing)\b", re.I)
_LIB_SUFFIX = re.compile(r"\s*\((?:user'?s? )?library\)\s*$", re.I)
_USERS = re.compile(r"^(?:the )?(?:user'?s?|my|your)\s+", re.I)
#: A library item that names the library itself ("User's Race Vocabulary",
#: "Tag list") rather than content: nothing reads it, so making it new
#: only adds a junk wildcard.
_METAISH = re.compile(r"\b(vocabulary|vocab|library|tag ?list|word ?list|lists?)\b", re.I)


def _covered(items: list[dict[str, Any]], me: dict[str, Any], name: str) -> bool:
    """Whether another item sets what a library item names ("Vocabulary
    (Colors)" next to a Hair Color wildcard). Nothing at all, or only the
    library's own words: it isn't covered, and is made new instead."""
    words = {w.rstrip("s") for w in re.findall(r"[a-z]{3,}", _METAISH.sub("", name).lower())}
    if not words:
        return True
    for x in items:
        if x is me or x.get("kind") in ("constraint", "template", "library"):
            continue
        text = f"{_var(x.get('var'))} {x.get('name') or ''}".lower().replace("_", " ")
        if any(re.search(r"\b" + re.escape(w) + r"(?:s|es)?\b", text) for w in words):
            return True
    return False


_NEGATIVEISH = re.compile(r"\bnegatives?\b|negative_|_negatives?\b", re.I)


def _slug_var(name: str) -> str:
    """A variable name from an item's name ("Quality Tags" → quality_tags)."""
    v = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40].strip("_")
    return _var(v if not v[:1].isdigit() else f"v_{v}")


def _side(raw: Any, known: dict[str, str]) -> str:
    """A constraint's source or target as a variable: written as one, or as
    an item's name ("Season", "the Season wildcard", "$season (input)")."""
    v = _var(raw)
    if v in known:
        return v
    if v and v.lower() in known:
        return v.lower()
    text = _clean(raw, MAX_NAME).lower()
    for m in re.finditer(r"\$?([a-zA-Z_][a-zA-Z0-9_]*)", text):
        if m.group(1) in known:
            return m.group(1)
    for var, name in known.items():
        if name and name.lower() in text:
            return var
    return v


_ROLE_WORDS = re.compile(r"\b(?:wildcard|selector|options?|list|picks?|types?|pool|set|"
                         r"choices?|vocabulary|library)\b", re.I)


def _concept(name: str) -> str:
    """What a name is about, without its role words ("Race Wildcard",
    "Race Selector", "Races" → "race")."""
    return "_".join(w.rstrip("s") if len(w) > 3 else w for w in
                    re.findall(r"[a-z]+", _ROLE_WORDS.sub("", name.lower())))


def _sides_from_about(x: dict[str, Any], known: dict[str, str]) -> None:
    """A constraint planned with empty sides but "Source: $animal_class,
    Target: $species" (or "$biome → $weather") in its words: the sides come
    from there, in place, instead of the rule being left out."""
    if x.get("source") in known and x.get("target") in known:
        return
    text = f"{x.get('name') or ''} {x.get('about') or ''}"
    named = {}
    for side in ("source", "target"):
        m = re.search(side + r"\s*(?:wildcard|variable)?\s*[:=]\s*\$?([a-zA-Z_]\w*)", text,
                      re.I)
        if m and m.group(1) in known:
            named[side] = m.group(1)
    vars_ = [v for v in dict.fromkeys(re.findall(r"\$([a-zA-Z_]\w*)", text)) if v in known]
    rest = [v for v in vars_ if v not in named.values()]
    for side in ("source", "target"):
        if x.get(side) in known:
            rest = [v for v in rest if v != x[side]]
            continue
        v = named.get(side) or (rest.pop(0) if rest else "")
        if v and v != x.get("target" if side == "source" else "source"):
            x[side] = v
    if x.get("source") in known and x.get("target") in known:
        return
    # No $ at all ("Biome to Climate"): the picks its words name, in order.
    words = re.findall(r"[a-z]{3,}", text.lower())
    order: list[str] = []
    for w in words:
        hits = [v for v in known if w in {v, v.rstrip("s")} or w.rstrip("s") in {
            p.rstrip("s") for p in v.lower().split("_")} or w == str(known[v]).lower()]
        if len(hits) == 1 and hits[0] not in order:
            order.append(hits[0])
    order = [v for v in order if v not in (x.get("source"), x.get("target"))]
    for side in ("source", "target"):
        if x.get(side) not in known and order:
            x[side] = order.pop(0)


def _reads_var(items: list[dict[str, Any]], me: dict[str, Any], var: str) -> bool:
    """Whether another planned item mentions ``$var``."""
    pat = re.compile(r"\$" + re.escape(var) + r"\b")
    return any(x is not me and pat.search(f"{x.get('about') or ''} {x.get('use') or ''}")
               for x in items)


#: Library rows a "library" item may name, and the module type each becomes.
REUSABLE = ("wildcard", "fixed_values")


def _row_var(row: dict[str, Any]) -> str:
    p = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    if row.get("type") == "wildcard":
        return str(p.get("var_binding") or "")
    vals = [v.get("name") for v in p.get("values") or [] if isinstance(v, dict)]
    return str(vals[0]) if vals and isinstance(vals[0], str) else ""


def _library_row(item: dict[str, Any],
                 library: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """The library row a "library" item names (by name, else variable)."""
    rows = [r for r in library or [] if r.get("type") in REUSABLE
            and isinstance(r.get("payload"), dict) and _row_var(r)]
    name = _clean(item.get("name"), MAX_NAME).lower()
    var = _var(item.get("var"))
    hits = [r for r in rows if str(r.get("name") or "").lower() == name]
    if not hits and var:
        hits = [r for r in rows if _row_var(r) == var]
    return hits[0] if len(hits) == 1 else None


def _match_previous(it: dict[str, Any], kind: str, name: str, var: str,
                    previous: list[dict[str, Any]], used: set[str]) -> dict[str, Any] | None:
    """The earlier plan's item this one revises, so it keeps its key and id."""
    for p in previous:
        if p["key"] in used or p["kind"] != kind:
            continue
        if kind == "constraint":
            if p.get("source") == _var(it.get("source")) and p.get("target") == _var(
                    it.get("target")):
                return p
        elif var and p.get("var") == var:
            return p
        elif name and p.get("name", "").lower() == name.lower():
            return p
    return None


def compile_plan(
    raw: Any, library: list[dict[str, Any]] | None = None, *,
    previous: Any = None, decisions: Any = None, settings: Any = None,
    base: dict[str, Any] | None = None, canvas: Any = None, request: str = "",
) -> dict[str, Any]:
    """The model's plan (or one the manager sends back) as a checked plan:
    ``{title, summary, rating, style, model, anchor, questions, assumptions,
    decisions, settings, inputs, sections, items: [{key, id, kind, name,
    var, section, about, count, tags, source, target, use, library_id,
    library_type}], warnings}``.

    Every item gets a key and a reserved module id: items the manager sent
    keep theirs, and an item that revises one in ``previous`` (same kind and
    variable, or name) takes its key and id, so refs and constraints keep
    pointing at it across refines. "library" items must name a wildcard or
    fixed values in ``library``; their id is the library row's. Questions
    matching a decision are dropped. Raises PlanError when nothing usable
    is left.

    With ``base`` ("Extend with AI", from ``bundle_base``) the bundle's own
    wildcards and fixed values come first as ``existing`` library items
    (keys ``e1``…), its variables count as set, and its sub-bundles are
    sections; whatever the answer says about them is ignored."""
    if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
        raise PlanError("the plan had no items")
    cfg = parse_settings(settings if settings is not None else raw.get("settings"))
    decided = parse_decisions(decisions if decisions is not None else raw.get("decisions"))
    prev_items = [p for p in (previous.get("items") if isinstance(previous, dict) else None)
                  or [] if isinstance(p, dict) and isinstance(p.get("key"), str)
                  and isinstance(p.get("kind"), str)]
    warnings: list[str] = []
    questions = []
    for q in raw.get("questions") if isinstance(raw.get("questions"), list) else []:
        if not isinstance(q, dict):
            continue
        text = _clean(q.get("question"), 200)
        choices = list(dict.fromkeys(
            c for c in (_clean(x, 60) for x in q.get("choices") or []) if c))[:MAX_CHOICES]
        if not text or len(choices) < 2:
            continue
        if any(_same_question(text, d["question"]) for d in decided) \
                or any(_same_question(text, x["question"]) for x in questions):
            continue
        questions.append({"header": _clean(q.get("header"), 24) or text[:24],
                          "question": text, "multi": q.get("multi") is True,
                          "choices": choices})
    assumptions = [a for a in (_clean(x, 200) for x in raw.get("assumptions") or []
                               if isinstance(raw.get("assumptions"), list)) if a]
    from_images = [a for a in (_clean(x, 200) for x in raw.get("from_images") or []
                               if isinstance(raw.get("from_images"), list)) if a]
    research = list(dict.fromkeys(q for q in (
        _clean(x, 120) for x in (raw.get("research") if isinstance(raw.get("research"), list)
                                 else [])) if q))[:MAX_RESEARCH]
    sections: list[dict[str, str]] = []
    for s in raw.get("sections") if isinstance(raw.get("sections"), list) else []:
        name = _clean(s.get("name") if isinstance(s, dict) else s, 40)
        if name and not any(x["name"].lower() == name.lower() for x in sections):
            sections.append({"name": name,
                             "about": _clean(s.get("about"), 200) if isinstance(s, dict)
                             else ""})
    if len(sections) > MAX_SECTIONS:
        warnings.append(f"Kept the first {MAX_SECTIONS} sections")
        sections = sections[:MAX_SECTIONS]
    inputs = _inputs(raw.get("inputs"), warnings)
    unasked: list[str] = []
    if request and not _LORA.search(request):
        # A LoRA slot the request never asked for stays empty and leaves a
        # gap in every prompt.
        for i in [i for i in inputs if _LORA.search(i["var"])]:
            inputs.remove(i)
            unasked.append(i["var"])
            warnings.append(f"Left out the input ${i['var']}: the request names no LoRA")
    # An input that shares its variable with a wildcard a constraint needs
    # would leave the constraint without its wildcard: the wildcard wins.
    raw_items = [dict(x) for x in raw["items"] if isinstance(x, dict)]
    if request and inputs:
        # Nothing in the request says the user brings it: the pack rolls it.
        have = {_var(x.get("var")) for x in raw_items}
        given = bool(_GIVEN.search(request))
        for i in list(inputs):
            if given and _names_input(i["var"], request):
                continue
            inputs.remove(i)
            if i["var"] in have:
                warnings.append(f"Dropped the input ${i['var']}: the pack sets it")
                continue
            raw_items.insert(0, {
                "kind": "wildcard", "name": i["var"].replace("_", " ").title(),
                "var": i["var"], "about": (i["about"] or f"the {i['var']}") + (
                    f" (for example {i['example']})" if i["example"] else ""),
                "count": 0, "tags": [], "section": "", "use": ""})
            warnings.append(f"Made the input ${i['var']} a wildcard: the request doesn't "
                            "say you'll give it")
    for v in unasked:
        pat = re.compile(r",?\s*\$" + re.escape(v) + r"\b")
        for x in raw_items:
            if isinstance(x.get("about"), str):
                x["about"] = pat.sub("", x["about"])
    if request:
        raw_items = _drop_unasked_subject(raw, raw_items, request, warnings)
        raw_items = _drop_unasked_drivers(raw_items, request, warnings)
    raw_items = _merge_splits(raw_items, warnings)
    _strip_case_suffixes(raw_items, warnings)
    raw_items = _case_rules(raw_items, warnings)
    if request:
        raw_items = _fit_rules(raw_items, request, warnings)
        _never_from_request(raw_items, request, warnings)
        raw_items = _only_in_rules(raw_items, request, warnings)
        raw_items = _asked_colours(raw_items, request, warnings)
    known_sides = {_var(x.get("var")): _clean(x.get("name"), MAX_NAME)
                   for x in raw_items if _var(x.get("var"))}
    known_sides.update({i["var"]: i["var"] for i in inputs})
    for x in raw_items:
        if x.get("kind") == "constraint":
            for side in ("source", "target"):
                x[side] = _side(x.get(side), known_sides)
            _sides_from_about(x, known_sides)
    # Two rules each way between the same picks: whichever runs second
    # never applies (the loop). The first one planned stays.
    pairs: set[tuple[str, str]] = set()
    for x in list(raw_items):
        if x.get("kind") != "constraint":
            continue
        pair = (str(x.get("source") or ""), str(x.get("target") or ""))
        if pair[::-1] in pairs:
            raw_items.remove(x)
            warnings.append(f"Left out {x.get('name') or 'a constraint'}: a rule the other "
                            f"way (${pair[1]} → ${pair[0]}) is already planned, and the "
                            "two make a loop where one never applies")
            continue
        pairs.add(pair)
    _stray_rule_tags(raw_items, warnings)
    raw_items = _drop_loose_groups(raw_items, warnings)
    raw_items = _light_follows_weather(raw_items, warnings)
    ruled = {x[side] for x in raw_items if x.get("kind") == "constraint"
             for side in ("source", "target")}
    picked = {_var(x.get("var")) for x in raw_items if x.get("kind") in ("wildcard", "library")}
    for i in [i for i in inputs if i["var"] in ruled]:
        inputs.remove(i)
        if i["var"] in picked:
            warnings.append(f"Dropped the input ${i['var']}: a constraint needs the wildcard "
                            "that sets it")
            continue
        # No wildcard for it: make one, just before the first constraint on
        # it, so the constraint has a side to key on.
        cons = [x for x in raw_items if x.get("kind") == "constraint"
                and i["var"] in (x["source"], x["target"])]
        # The tags its rules name, less those the other side's wildcard has.
        other = {_tag(t) for c in cons for x in raw_items if x.get("kind") in (
            "wildcard", "library") and _var(x.get("var")) in (c["source"], c["target"])
            for t in x.get("tags") or []}
        tags = [t for t in dict.fromkeys(t for c in cons for t in _TAG_REF.findall(
            str(c.get("about") or "").lower())) if t not in other]
        at = raw_items.index(cons[0])
        raw_items.insert(at, {
            "kind": "wildcard", "name": i["var"].replace("_", " ").title(), "var": i["var"],
            "about": (i["about"] or f"the {i['var']}") + (
                f" (for example {i['example']})" if i["example"] else ""),
            "count": 0, "tags": tags, "section": cons[0].get("section") or "", "use": ""})
        picked.add(i["var"])
        warnings.append(f"Made the input ${i['var']} a wildcard: "
                        f"{cons[0].get('name') or 'a constraint'} keys on it")
    dropped: list[dict[str, str]] = []
    taken_ids = {r["id"] for r in library or [] if isinstance(r.get("id"), str)}
    items: list[dict[str, Any]] = []
    keys: set[str] = set()
    ids: set[str] = set()
    sets: dict[str, str] = {i["var"]: "an input" for i in inputs}
    names: set[str] = set()
    base_items = [dict(b) for b in (base or {}).get("items") or []]
    base_ids = {b["id"] for b in base_items}
    for b in base_items:
        keys.add(b["key"])
        ids.add(b["id"])
        sets[b["var"]] = f"the bundle's {b['name']}"
        if b["library_type"] == "wildcard":
            names.add(b["name"].lower())
        items.append(b)
    for v, who in ((base or {}).get("sets") or {}).items():
        sets.setdefault(v, f"the bundle's {who}")
    for name in (base or {}).get("subs") or {}:
        if not any(x["name"].lower() == name.lower() for x in sections):
            sections.insert(0, {"name": name, "about": "already in the bundle"})
    used_prev: set[str] = set()
    sent_keys = {x.get("key") for x in raw_items}
    next_key = 1
    template_seen = False
    standing_neg: list[str] = []
    for it in raw_items:
        if it.get("kind") not in KINDS:
            continue
        if base is not None and (it.get("existing") or str(it.get("key") or "").startswith("e")):
            continue  # the bundle's own items come from ``base``
        kind = it["kind"]
        name = _clean(it.get("name"), MAX_NAME)
        about = _clean(it.get("about"), MAX_ABOUT)
        var = _var(it.get("var"))
        lib_row = None
        made_new = ""
        if kind == "library":
            lib_row = _library_row(it, library) if cfg["library"] == "reuse" else None
            if lib_row is not None and lib_row["id"] in base_ids:
                continue  # already in the bundle
            if lib_row is None:
                # Make it new instead: leaving it out loses part of the pack.
                name = _USERS.sub("", _LIB_SUFFIX.sub("", name).strip()).strip()
                if _METAISH.search(name) and not (var and _reads_var(raw_items, it, var)) \
                        and _covered(raw_items, it, name):
                    warnings.append(f"Left out {name or 'a library item'}: it isn't in the "
                                    "library, and the pack's own items cover it")
                    continue
                if _METAISH.search(name):
                    # "Vocabulary (Colors)" is a Colors wildcard.
                    name = re.sub(r"[()\[\]]", "", _METAISH.sub("", name)).strip(" -:,") \
                        or name
                var = var or _slug_var(name)
                if not var:
                    warnings.append("Left out a library item with no name or variable")
                    continue
                core = _concept(name) or var.rstrip("s")
                twin = next((x for x in raw_items if x is not it and x.get("kind") in (
                    "wildcard", "fixed_values") and _var(x.get("var"))
                    and _var(x.get("var")) != var
                    and core in {_var(x.get("var")).rstrip("s"),
                                 _concept(str(x.get("name") or ""))}), None)
                if twin is not None:
                    # "Races" next to the pack's own race wildcard: two races
                    # in every prompt.
                    warnings.append(f"Left out {name or var}: it isn't in the library, and "
                                    f"{twin.get('name') or _var(twin.get('var'))} already "
                                    "picks it")
                    continue
                kind = "fixed_values" if _PRESETISH.search(f"{name} {about}") else "wildcard"
                made_new = "the settings say to make everything new" \
                    if cfg["library"] != "reuse" else "nothing by that name in the library"
            else:
                name, var = str(lib_row.get("name") or name), _row_var(lib_row)
        if kind == "template":
            if template_seen:
                warnings.append(f"Left out a second template, {name or 'unnamed'}")
                continue
            template_seen = True
        if kind in ("combine", "fixed_values") and not var:
            var = _slug_var(name)
            if not var:
                warnings.append(f"Left out a {kind.replace('_', ' ')} with no name or "
                                "variable")
                continue
        if kind in ("wildcard", "fixed_values") and _NEGATIVEISH.search(f"{name} {var}"):
            # Negative words picked at random (or set as a positive variable)
            # land in the prompt or flip from run to run: they belong in the
            # template's standing negative.
            standing_neg.append(about or name)
            warnings.append(f"Moved {name or '$' + var} into the template's standing negative")
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
        if made_new:
            warnings.append(f"Made {name or '$' + var} new: {made_new}")
        prev = _match_previous(it, kind, name, var, prev_items, used_prev)
        if prev is not None:
            used_prev.add(prev["key"])
        key = it.get("key") if isinstance(it.get("key"), str) and _KEY.match(it["key"]) else ""
        if (not key or key in keys) and prev is not None and prev["key"] not in keys:
            key = prev["key"]
        if not key or key in keys:
            while f"i{next_key}" in keys or f"i{next_key}" in sent_keys or any(
                    p["key"] == f"i{next_key}" for p in prev_items):
                next_key += 1
            key = f"i{next_key}"
            next_key += 1
        keys.add(key)
        if lib_row is not None:
            mid = lib_row["id"]
        else:
            mid = it.get("id") if isinstance(it.get("id"), str) and _HEX8.match(it["id"]) \
                else ""
            if (not mid or mid in ids or mid in taken_ids) and prev is not None \
                    and _HEX8.match(str(prev.get("id") or "")):
                mid = prev["id"]
            if not mid or mid in ids or mid in taken_ids:
                mid = new_id(ids | taken_ids)
        ids.add(mid)
        count = it.get("count")
        count = int(count) if isinstance(count, (int, float)) and not isinstance(count, bool) \
            else (cfg["count"] or DEFAULT_COUNT)
        section = _clean(it.get("section"), 40)
        match = next((s["name"] for s in sections if s["name"].lower() == section.lower()), "")
        if section and not match and len(sections) < MAX_SECTIONS:
            sections.append({"name": section, "about": ""})
            match = section
        item = {
            "key": key, "id": mid, "kind": kind,
            "name": name or (f"${var}" if var else kind.replace("_", " ").title()),
            "var": var, "section": match, "about": about,
            "count": max(MIN_COUNT, min(MAX_COUNT, count)) if kind == "wildcard" else 0,
            "tags": list(dict.fromkeys(
                t for t in (_tag(x) for x in it.get("tags") or []) if t))[:MAX_TAGS]
            if kind == "wildcard" else [],
            "source": _var(it.get("source")) if kind == "constraint" else "",
            "target": _var(it.get("target")) if kind == "constraint" else "",
            "use": _clean(it.get("use"), MAX_USE) if kind in (
                "wildcard", "library", "combine", "derivation", "fixed_values") and var else "",
            "library_id": "", "library_type": "",
        }
        if lib_row is not None:
            item["library_id"] = lib_row["id"]
            item["library_type"] = lib_row["type"]
            item["count"] = 0
            item["tags"] = [t for t in lib_row["payload"].get("sub_categories") or []
                            if isinstance(t, str)][:16]
        if kind in ("wildcard", "library", "combine", "derivation", "fixed_values") and var:
            sets.setdefault(var, item["name"])
        if kind == "wildcard":
            names.add(item["name"].lower())
        if base is not None and base.get("nested"):
            item["section"] = ""  # a bundle inside a bundle can't hold sub-bundles
        items.append(item)
        if len(items) - len(base_items) >= MAX_ITEMS:
            warnings.append(f"Kept the first {MAX_ITEMS} items")
            break
    tpl = next((i for i in items if i["kind"] == "template"), None)
    if standing_neg and tpl is not None:
        tpl["about"] = (tpl["about"].rstrip(". ") + ". Standing negative: "
                        + "; ".join(standing_neg))[:MAX_ABOUT]
    wildcard_vars = {i["var"]: i for i in items if is_wild(i)}
    kept: list[dict[str, Any]] = []
    for i in items:
        if i["kind"] == "constraint":
            bad = [s for s in (i["source"], i["target"]) if s not in wildcard_vars]
            if bad or i["source"] == i["target"]:
                why = ((f"${bad[0]} isn't a wildcard in this pack" if bad[0] else
                        "its source or target names no variable") if bad
                       else "its source and target are the same")
                warnings.append(f"Left out constraint {i['name']}: {why}")
                dropped.append({"kind": "constraint", "name": i["name"], "source": i["source"],
                                "target": i["target"], "about": i["about"], "why": why})
                continue
            # A constraint runs just before its target, so it lives with it.
            i["section"] = wildcard_vars[i["target"]]["section"]
        kept.append(i)
    if not any(is_wild(i) for i in kept):
        raise PlanError("the plan has no wildcards")
    # Ones left out of an earlier pass (the manager sends the plan back) stay
    # listed until a constraint between the same two variables is planned.
    have = {(i["source"], i["target"]) for i in kept if i["kind"] == "constraint"}
    for d in raw.get("dropped") if isinstance(raw.get("dropped"), list) else []:
        if isinstance(d, dict) and d.get("kind") == "constraint":
            entry = {k: _clean(d.get(k), MAX_ABOUT) for k in
                     ("name", "source", "target", "about", "why")}
            entry["kind"] = "constraint"
            if entry["name"] and not any(x["name"] == entry["name"] for x in dropped):
                dropped.append(entry)
    dropped = [d for d in dropped if (d["source"], d["target"]) not in have][:MAX_ITEMS]
    if base is not None and all(i.get("existing") for i in kept):
        raise PlanError("the plan adds nothing to the bundle")
    used_sections = {i["section"] for i in kept if i["section"]}
    sections = [s for s in sections if s["name"] in used_sections]
    rating = raw.get("rating") if raw.get("rating") in ("safe", "nsfw") else "safe"
    if cfg["rating"] != "auto":
        rating = cfg["rating"]
    style = raw.get("style") if raw.get("style") in STYLES else "tags"
    if cfg["style"] != "auto":
        style = cfg["style"]
    # An anchor nothing sets is kept: the review offers the fix (it knows
    # the run-time, canvas and bundle variables this check would miss).
    anchor = _var(raw.get("anchor"))
    out_base = {} if base is None else {"base": {
        "id": base["id"], "name": base["name"], "nested": bool(base.get("nested")),
        "sets": sorted(set(base.get("sets") or {}) | {b["var"] for b in base_items})}}
    if canvas is None:
        canvas = raw.get("canvas")
    return {
        **out_base,
        "canvas": canvas_vars(canvas),
        "title": _clean(raw.get("title"), MAX_NAME) or (base or {}).get("name") or "AI pack",
        "summary": _clean(raw.get("summary"), 300),
        "design": _clean(raw.get("design"), 900) or (
            _clean(previous.get("design"), 900) if isinstance(previous, dict) else ""),
        "rating": rating,
        "style": style,
        "model": _model(raw.get("model")),
        "anchor": anchor,
        "questions": questions[:MAX_QUESTIONS],
        "assumptions": assumptions[:MAX_ASSUMPTIONS],
        "from_images": from_images[:MAX_FROM_IMAGES],
        "research": research,
        "decisions": decided,
        "settings": cfg,
        "run": parse_run(raw.get("run"),
                         previous.get("run") if isinstance(previous, dict) else None),
        "inputs": inputs,
        "sections": sections,
        "items": kept,
        "dropped": dropped,
        "warnings": warnings,
    }


def plan_answer(plan: dict[str, Any]) -> dict[str, Any]:
    """A checked plan back in the shape the model writes, for replaying it
    as the model's last answer after the user edited it by hand."""
    return {
        "title": plan["title"], "summary": plan.get("summary", ""),
        "design": plan.get("design", ""),
        "rating": plan.get("rating", "safe"), "style": plan.get("style", "tags"),
        "model": plan.get("model", ""), "anchor": plan.get("anchor", ""),
        "questions": [{k: q[k] for k in ("header", "question", "multi", "choices")}
                      for q in plan.get("questions") or []],
        "assumptions": list(plan.get("assumptions") or []),
        "from_images": list(plan.get("from_images") or []),
        "research": [],
        "run": parse_run(plan.get("run")),
        "inputs": list(plan.get("inputs") or []),
        "sections": list(plan.get("sections") or []),
        "items": [{k: i.get(k, "" if k not in ("count", "tags") else (0 if k == "count" else []))
                   for k in ITEM_SCHEMA["properties"]} for i in plan["items"]
                  if not i.get("existing")],
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
        elif module_type(item) == "fixed_values":
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
    chain: list[str] = [i["key"] for i in items if module_type(i) == "fixed_values"]
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


def _deps(plan: dict[str, Any], built: dict[str, Any]) -> list[tuple[str, str]]:
    """(before, after) key pairs the run order must keep: a constraint
    after its source and before its target, and anything that reads a
    variable after what sets it."""
    items = [i for i in plan["items"] if not _vocab(i) and i["kind"] != "template"]
    by_var = {i["var"]: i["key"] for i in items if is_wild(i)}
    out: list[tuple[str, str]] = []
    io = {i["key"]: item_io(i, (built.get(i["key"]) or {}).get("payload")) for i in items}
    for i in items:
        if i["kind"] == "constraint":
            if i["source"] in by_var:
                out.append((by_var[i["source"]], i["key"]))
            if i["target"] in by_var:
                out.append((i["key"], by_var[i["target"]]))
            continue
        for o in items:
            if o is not i and o["kind"] != "constraint" and io[o["key"]][1] & io[i["key"]][0]:
                out.append((o["key"], i["key"]))
    return out


def sectioned(plan: dict[str, Any], built: dict[str, Any] | None = None,
              ) -> list[tuple[str, list[str]]] | None:
    """The run order split into sections, ``[(section, keys)]``, with the
    sections ordered so everything a section needs from another runs first
    (a constraint's source, a variable a rule reads). Inside a section the
    chain order holds. None when the pack goes in one bundle: sections are
    off, there are fewer than two of them, the pack is small, or two
    sections need each other (then one bundle keeps every rule working)."""
    built = built or {}
    if parse_settings(plan.get("settings"))["structure"] != "sections":
        return None
    chain = chain_order(plan, built)
    items = {i["key"]: i for i in plan["items"]}
    names = [s["name"] for s in plan.get("sections") or []]
    sec_of = {k: items[k].get("section") or "" for k in chain}
    used = [n for n in names if n in sec_of.values()]
    if "" in sec_of.values():
        used.append("")
    if len(used) < 2 or len(chain) < MIN_SECTIONED:
        return None
    after: dict[str, set[str]] = {n: set() for n in used}
    for a, b in _deps(plan, built):
        sa, sb = sec_of.get(a), sec_of.get(b)
        if sa is not None and sb is not None and sa != sb:
            after[sb].add(sa)
    order: list[str] = []
    pending = list(used)
    while pending:
        ready = next((n for n in pending if after[n] <= set(order)), None)
        if ready is None:
            return None
        pending.remove(ready)
        order.append(ready)
    position = {k: n for n, k in enumerate(chain)}
    return [(n, sorted((k for k in chain if sec_of[k] == n), key=position.__getitem__))
            for n in order]


def run_order(plan: dict[str, Any], built: dict[str, Any] | None = None) -> list[str]:
    """Keys in the order the installed pack runs them: section by section
    when it has sub-bundles, else the chain order. The check runs this."""
    parts = sectioned(plan, built)
    if parts is None:
        return chain_order(plan, built)
    return [k for _, keys in parts for k in keys]
