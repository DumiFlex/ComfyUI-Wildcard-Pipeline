"""Pack graph: the small, typed plan a model writes (slots, axes, relations,
template order) and the code that turns it into a pack plan whose wiring
is right by construction.

The model decides WHAT a pack is about: which slots exist, what they are
called, what they vary on (axes), what depends on what (relations) and the
order the template reads them in. Code decides HOW that is wired: every
slot is one wildcard, every axis a tag group, every relation a constraint
or a derivation keyed on those tags, and the template reads every slot
that shows. Every reference a relation makes is checked against the names
the same graph declares; a reference that resolves to nothing is dropped
and reported (``bad_refs``), never guessed.

``compile_graph`` cleans and checks the model's answer. ``graph_plan``
turns it into the plan items ``compile_plan`` takes, so keys, reserved ids,
sections and the library work as before. ``wired_payload`` writes the
payload of every item but a slot without a model; ``slot_schema`` and
``compile_slot`` are the per-slot content call (options tagged on an enum
of the slot's own axis values).

How a request becomes a graph (``compile_graph_plan``, in order):

1. The model's answer is cleaned: ``compile_graph`` runs ``_slots`` (names,
   variables, pick ranges), ``_infer_axes`` (axes a relation names but no
   slot declared), ``_fixed``, ``_relations`` (each side checked against
   the graph's own names; a miss goes to ``bad_refs``) and ``_template``.
   On a refine, ``apply_locks`` first puts back what the user locked.
2. Code then corrects what models get wrong, each step adding a line to
   ``applied`` so the plan says what changed: the pack settings
   (``apply_settings``), a story's beat (``code_beat``), pick counts the
   request names ("two accessories", ``apply_picks``; ``_COUNTED`` and
   ``_NOT_PICKED``), rules a multi-pick can't take (``drop_multi_pick_rules``),
   quality / negative slots that should be fixed values or the run's own
   (``apply_request_slots``), model-family rules the request never asked for
   (``trim_model``), a person lead on a request with no person
   (``unasked_lead``; ``_PERSON_ASK`` / ``_THING_ASK``) and existing library
   items to reuse (``apply_library``).
3. ``graph_plan`` turns the graph into plan items and ``compile_plan`` gives
   them keys and reserved ids. ``request_gaps`` lists request words the graph
   says nowhere (content words after ``_REQUEST_STOP`` and ``_stems``), which
   the review asks about once.
4. Building: ``wired_payload`` writes constraints, derivations and the
   template from the graph; each slot's options come from the model through
   ``slot_prompt`` / ``slot_schema`` / ``compile_slot``. After the test run,
   ``verify_relations`` checks every relation against the rendered prompts.

The word lists and regexes are tuned from real model answers; the tests
(``test_ai_pack_graph*.py``, ``test_ai_pack_quality.py``) are their record,
so change one together with the test that shows why.
"""
from __future__ import annotations

import re
from typing import Any

from engine.ai.pack._common import (
    _STR,
    _STRS,
    DEFAULT_COUNT,
    MAX_ABOUT,
    MAX_COUNT,
    MAX_INPUTS,
    MAX_NAME,
    MAX_QUESTIONS,
    MAX_SECTIONS,
    MIN_COUNT,
    RUN_MODES,
    STYLES,
    PlanError,
    _clean,
    _model,
    _obj,
    _tag,
    _var,
)
from engine.ai.pack.plan import _NEGATIVEISH, MAX_TAGS, _row_var, _slug_var
from engine.ai.pack.settings import MAX_SWEEP_OPTIONS, parse_run, parse_settings

MAX_SLOTS = 24
MAX_AXES = 4
MAX_VALUES = 12
MAX_RELATIONS = 40
MAX_FIXED = 6
MAX_TEMPLATE_PARTS = 40
MAX_TEXT = 200
MAX_WORDS = 6
#: Relation kinds. The first four key one slot's pick on another's by tag;
#: ``agree`` and ``accepts`` are "goes with" on a shared axis; ``derive``
#: and ``append`` write text from a pick; ``draw`` puts a fresh pick from
#: one slot (a shared list) in front of every option of another.
RELATIONS = ("exclude", "only", "boost", "reduce", "agree", "accepts", "derive", "append",
             "draw")
#: The kinds that narrow the target's pick (one constraint per slot pair).
NARROWING = ("exclude", "only", "boost", "reduce", "agree", "accepts")
#: Source axes the engine reads as ALTERNATIVES (``accepts`` kind): one
#: value is rolled per pick and only that value's row fires. A classify
#: source carrying two values would fire two allow-list rows at once and
#: leave the target nothing (the 84/100 fallback rate of 2026-10-19).
_ROLLED_SOURCE = ("derive", "append", "accepts", "agree", "only")
_WEIGHTED = {"boost": 3.0, "reduce": 0.3}
SHOW = ("prompt", "internal")
_AXIS_NAME = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_PICK = re.compile(r"^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$")

AXIS_SCHEMA: dict[str, Any] = _obj({"name": _STR, "values": _STRS})
SLOT_SCHEMA: dict[str, Any] = _obj({
    "name": _STR,
    "var": _STR,
    "what": _STR,
    "section": _STR,
    "count": {"type": "integer"},
    "show": {"type": "string", "enum": list(SHOW)},
    "pick": _STR,
    "hold": {"type": "boolean"},
    "sweep": {"type": "boolean"},
    "sometimes_none": {"type": "integer"},
    "axes": {"type": "array", "items": AXIS_SCHEMA},
})
FIXED_SCHEMA: dict[str, Any] = _obj({
    "name": _STR, "var": _STR, "text": _STR, "negative": _STR,
})
RELATION_SCHEMA: dict[str, Any] = _obj({
    "kind": {"type": "string", "enum": list(RELATIONS)},
    "from_slot": _STR,
    "from_axis": _STR,
    "from_value": _STR,
    "to_slot": _STR,
    "to_axis": _STR,
    "to_value": _STR,
    "factor": {"type": "number"},
    "var": _STR,
    "text": _STR,
    "otherwise": _STR,
    "words": _STRS,
})
TEMPLATE_SCHEMA: dict[str, Any] = _obj({
    "lead": _STR, "order": _STRS, "tail": _STR, "negative": _STR,
})
GRAPH_SCHEMA: dict[str, Any] = _obj({
    "title": _STR,
    "summary": _STR,
    "design": _STR,
    "rating": {"type": "string", "enum": ["safe", "nsfw"]},
    "style": {"type": "string", "enum": list(STYLES)},
    "model": _STR,
    "anchor": _STR,
    "questions": {"type": "array", "items": _obj({
        "header": _STR, "question": _STR, "multi": {"type": "boolean"}, "choices": _STRS})},
    "assumptions": _STRS,
    "from_images": _STRS,
    "research": _STRS,
    "run": _obj({"mode": {"type": "string", "enum": list(RUN_MODES)},
                 "frames": {"type": "integer"}}),
    "inputs": {"type": "array", "items": _obj({"var": _STR, "about": _STR, "example": _STR})},
    "sections": {"type": "array", "items": _obj({"name": _STR, "about": _STR})},
    "slots": {"type": "array", "items": SLOT_SCHEMA},
    "fixed": {"type": "array", "items": FIXED_SCHEMA},
    "relations": {"type": "array", "items": RELATION_SCHEMA},
    "template": TEMPLATE_SCHEMA,
})


def _axis_name(raw: Any) -> str:
    a = _clean(raw, 40).lower().replace(" ", "_").replace("-", "_").lstrip("$.")
    return a if _AXIS_NAME.match(a) and a != "neg" else ""


def _number(raw: Any, default: float) -> float:
    if isinstance(raw, (int, float)) and not isinstance(raw, bool) and raw >= 0:
        return float(raw)
    return default


def _pick(raw: Any) -> str:
    """``""`` for one pick, else ``"N"`` or ``"A-B"`` (at most 20)."""
    m = _PICK.match(_clean(raw, 10))
    if not m:
        return ""
    lo = max(1, min(20, int(m.group(1))))
    hi = max(lo, min(20, int(m.group(2)))) if m.group(2) else lo
    if lo == hi == 1:
        return ""
    return f"{lo}" if lo == hi else f"{lo}-{hi}"


def _lower_map(names: list[str]) -> dict[str, str]:
    return {n.lower(): n for n in names}


def _slots(raw: Any, warnings: list[str], taken_vars: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    names: set[str] = set()
    for s in raw if isinstance(raw, list) else []:
        if not isinstance(s, dict):
            continue
        name = _clean(s.get("name"), MAX_NAME)
        var = _var(s.get("var")) or _slug_var(name)
        if not name and not var:
            warnings.append("Left out a slot with no name or variable")
            continue
        name = name or f"${var}"
        if var in taken_vars:
            warnings.append(f"Left out slot {name}: ${var} is already set")
            continue
        if name.lower() in names:
            warnings.append(f"Left out a second slot named {name}")
            continue
        axes: list[dict[str, Any]] = []
        used_values: set[str] = set()
        for a in _got if isinstance(_got := s.get("axes"), list) else []:
            if not isinstance(a, dict):
                continue
            aname = _axis_name(a.get("name"))
            if not aname or any(x["name"] == aname for x in axes):
                if aname:
                    warnings.append(f"{name}: a second axis named {aname}")
                continue
            values = []
            for v in _got if isinstance(_got := a.get("values"), list) else []:
                t = _tag(v)
                if not t or t in values:
                    continue
                if t in used_values:
                    warnings.append(f"{name}: {t} is on two axes; kept the first")
                    continue
                values.append(t)
            values = values[:MAX_VALUES]
            if not values:
                continue
            used_values |= set(values)
            axes.append({"name": aname, "values": values})
            if len(axes) >= MAX_AXES:
                break
        count = s.get("count")
        count = int(count) if isinstance(count, (int, float)) and not isinstance(count, bool) \
            else DEFAULT_COUNT
        none = s.get("sometimes_none")
        none = int(none) if isinstance(none, (int, float)) and not isinstance(none, bool) \
            else 0
        out.append({
            "name": name, "var": var, "what": _clean(s.get("what"), MAX_ABOUT),
            "section": _clean(s.get("section"), 40),
            "count": max(MIN_COUNT, min(MAX_COUNT, count)),
            "show": s.get("show") if s.get("show") in SHOW else "prompt",
            "pick": _pick(s.get("pick")), "hold": s.get("hold") is True,
            "sweep": s.get("sweep") is True,
            "sometimes_none": max(0, min(90, none)),
            "axes": axes,
            "self_axis": _self_axis(name, var, axes),
        })
        weights = _weights(s.get("weights"), axes)
        if weights:
            out[-1]["weights"] = weights
        names.add(name.lower())
        taken_vars.add(var)
        if len(out) >= MAX_SLOTS:
            warnings.append(f"Kept the first {MAX_SLOTS} slots")
            break
    return out


def _weights(raw: Any, axes: list[dict[str, Any]]) -> dict[str, float]:
    """A slot's per-value weight factors (``{value: factor}``), set by the
    code from a rule that wrote a number (``_relations``) and kept when
    the graph comes back from the editor."""
    if not isinstance(raw, dict):
        return {}
    values = {v for a in axes for v in a["values"]}
    out: dict[str, float] = {}
    for k, v in raw.items():
        t = _tag(k)
        if t in values and isinstance(v, (int, float)) and not isinstance(v, bool) \
                and 0 < float(v) <= MAX_WEIGHT_FACTOR and float(v) != 1:
            out[t] = round(float(v), 2)
    return out


#: The most a rule's number can weigh a value's options, up or down.
MAX_WEIGHT_FACTOR = 20.0
#: A rule's text that is only a number ("1.5", "x2", "0.5×"): weight intent
#: written as text (9B, 2026-10-20: "$hair_len_prob = 1.5" for "long
#: styles more common", broken on every run).
_WEIGHT_TEXT = re.compile(r"^[x×]?\s*(\d+(?:\.\d+)?)\s*[x×]?$", re.I)


def _self_axis(name: str, var: str, axes: list[dict[str, Any]]) -> str:
    """The axis a slot IS (a Season slot with axis season): its options are
    the axis values, written by the code. "" when it has none."""
    own = set(_axis_name(name).split("_")) | set(var.lower().split("_"))
    own |= {w.rstrip("s") for w in own}
    if len(axes) == 1 and (axes[0]["name"] in own or axes[0]["name"].rstrip("s") in own):
        return axes[0]["name"]
    return ""


def _slot_index(slots: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Slots by lowercase name, variable and $variable."""
    by_name: dict[str, dict[str, Any]] = {}
    for s in slots:
        by_name[s["name"].lower()] = s
        by_name[s["var"].lower()] = s
        by_name[f"${s['var']}".lower()] = s
    return by_name


def _find_slot(sname: str, slots: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    return slots.get(sname.lower()) or slots.get(_var(sname).lower()) \
        or slots.get(f"${_var(sname)}".lower())


def _infer_axes(raw: Any, slots: list[dict[str, Any]], warnings: list[str]) -> None:
    """An axis a relation names on one slot that only the other slot
    declares is copied over (same name, same values), so the model
    declares each axis once: "exclude Season.season=winter →
    Footwear.season=summer" gives Footwear a season axis when it has none,
    and "agree on season Season → Outfit" likewise. Nothing is added when
    the slot already uses a value of it on another axis, or has 4 axes."""
    by_name = _slot_index(slots)
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict) or r.get("kind") not in RELATIONS:
            continue
        kind = r["kind"]
        if kind in ("derive", "append", "draw"):
            continue
        src = _find_slot(_clean(r.get("from_slot"), MAX_NAME), by_name)
        dst = _find_slot(_clean(r.get("to_slot"), MAX_NAME), by_name)
        if src is None or dst is None or src is dst:
            continue
        for slot, other, which in ((dst, src, "to"), (src, dst, "from")):
            axis = _axis_name(r.get(f"{which}_axis")) or _axis_name(r.get("from_axis")) \
                or _axis_name(r.get("to_axis"))
            value = _tag(r.get(f"{which}_value")) if kind not in ("agree", "accepts") else ""
            if not axis or any(a["name"] == axis for a in slot["axes"]):
                continue
            if value and any(value in a["values"] for a in slot["axes"]):
                continue  # the value finds its axis on this slot already
            have = next((a for a in other["axes"] if a["name"] == axis), None)
            if have is None or (value and value not in have["values"]):
                continue
            used = {v for a in slot["axes"] for v in a["values"]}
            if used & set(have["values"]) or len(slot["axes"]) >= MAX_AXES:
                continue
            slot["axes"].append({"name": axis, "values": list(have["values"])})
            slot["self_axis"] = _self_axis(slot["name"], slot["var"], slot["axes"])
            warnings.append(f"{slot['name']}: added the {axis} axis "
                            f"({', '.join(have['values'])}) that its {kind} rule with "
                            f"{other['name']} needs")


#: Slot words of what a story keeps from frame to frame when the model
#: holds everything: the cast and where it is.
_STAYS = {"character", "subject", "person", "girl", "boy", "hero", "protagonist", "race",
          "outfit", "clothes", "clothing", "attire", "costume", "wear", "hair", "face", "body",
          "eye", "skin", "species", "creature", "pet", "animal", "car", "vehicle", "setting",
          "scene", "location", "place", "background", "environment", "style", "quality"}


def _story_holds(slots: list[dict[str, Any]], run: dict[str, Any],
                 warnings: list[str]) -> None:
    """In a story, something must change from frame to frame: when every
    prompt slot is held, the ones that aren't the cast or the place (a
    pose, an angle, the light) are let go, so the frames differ."""
    prompt = [s for s in slots if s["show"] == "prompt"]
    if run["mode"] != "story" or not prompt or not all(s["hold"] for s in prompt):
        return
    freed = []
    for s in prompt:
        words = {w.rstrip("s") for w in re.findall(r"[a-z]+", f"{s['name']} {s['var']}".lower()
                                                    .replace("_", " "))}
        if not words & _STAYS:
            s["hold"] = False
            freed.append(s["name"])
    if freed:
        warnings.append(", ".join(freed) + (" change" if len(freed) > 1 else " changes")
                        + " from frame to frame: a story where every pick is held repeats "
                        "one image")


def _fixed(raw: Any, warnings: list[str], taken_vars: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for f in raw if isinstance(raw, list) else []:
        if not isinstance(f, dict):
            continue
        name = _clean(f.get("name"), MAX_NAME)
        var = _var(f.get("var")) or _slug_var(name)
        text = _clean(f.get("text"), MAX_TEXT * 2)
        if not var or not text:
            warnings.append(f"Left out fixed values {name or '?'}: no variable or no text")
            continue
        if var in taken_vars:
            warnings.append(f"Left out fixed values {name}: ${var} is already set")
            continue
        taken_vars.add(var)
        out.append({"name": name or f"${var}", "var": var, "text": text,
                    "negative": _clean(f.get("negative"), MAX_TEXT)})
        if len(out) >= MAX_FIXED:
            break
    return out


def _side(r: dict[str, Any], which: str, slots: dict[str, dict[str, Any]],
          need_value: bool) -> tuple[dict[str, Any] | None, str]:
    """``(side, error)``: the slot, axis and value a relation names on one
    side, resolved against the declared slots; ``error`` says what failed."""
    sname = _clean(r.get(f"{which}_slot"), MAX_NAME)
    slot = _find_slot(sname, slots)
    if slot is None:
        return None, f"{which} names no slot ({sname or 'empty'})"
    axis = _axis_name(r.get(f"{which}_axis"))
    value = _tag(r.get(f"{which}_value"))
    if not need_value and not axis and not value:
        return {"slot": slot, "axis": "", "value": ""}, ""
    ax = next((a for a in slot["axes"] if a["name"] == axis), None) if axis else None
    if ax is None and value:
        # The axis left out, or wrong: the value finds it when it is unique.
        hits = [a for a in slot["axes"] if value in a["values"]]
        if len(hits) == 1:
            ax = hits[0]
    if ax is None:
        have = ", ".join(a["name"] for a in slot["axes"]) or "none"
        return None, (f"{slot['name']} has no axis {axis}" if axis else
                      f"{slot['name']}: no axis given") + f" (its axes: {have})"
    if need_value and value not in ax["values"]:
        have = ", ".join(ax["values"][:8])
        return None, (f"{slot['name']}.{ax['name']} has no value {value}" if value else
                      f"{slot['name']}.{ax['name']}: no value given") + f" (its values: {have})"
    return {"slot": slot, "axis": ax["name"],
            "value": value if need_value or value in ax["values"] else ""}, ""


#: How each relation kind reads to the user, for `plain_ref`.
_KIND_WORDS = {
    "derive": "A rule that sets a variable", "append": "A rule that adds words to a variable",
    "exclude": "A \"never together\" rule", "only": "An \"only these\" rule",
    "boost": "A \"more likely\" rule", "reduce": "A \"less likely\" rule",
    "agree": "An \"agrees with\" rule", "accepts": "An \"accepts\" rule",
    "draw": "A \"draws from\" rule",
}
_REF_VALUE = re.compile(r"^(\w+)(?: \$(\w+) \"([^\"]*)\")?(?: from \S+)?: (.+?)\.(\w+)"
                        r"(?: has no value (\S+)|: no value given) \(its values: (.*)\)$")
_REF_AXIS = re.compile(r"^(\w+)(?: on \S+)?: (.+?)(?: has no axis (\S+)|: no axis given)"
                       r" \(its axes: (.*)\)$")
_REF_SET = re.compile(r"^derive: \$(\w+) is already set by (?:the (.+) slot|a slot)")


def plain_ref(ref: str) -> str:
    """A relation the compile left out, as the plan shows it to the user.
    `bad_refs` keep the terse form (the repair prompt reads them); this one
    says which rule, why, and what the slot has, in words: "derive:
    Subject.build has no value ?" read like a variable called
    `$subj.build`, and the chat's Explain went looking for one (Dumi
    2026-10-21)."""
    m = _REF_VALUE.match(ref)
    if m:
        kind, var, text, slot, axis, value, have = m.groups()
        who = _KIND_WORDS.get(kind, "A rule")
        if var:
            who = f"A rule that {'adds' if kind == 'append' else 'sets'} ${var} = \"{text}\""
        why = (f"it names {axis} \"{value}\", which {slot} doesn't have" if value
               else f"it names no {axis} value, so it can't say when it applies")
        return (f"Left out a rule: {who} on {slot}'s {axis}: {why} ({slot}'s {axis} "
                f"values: {have}).")
    m = _REF_AXIS.match(ref)
    if m:
        kind, slot, axis, have = m.groups()
        who = _KIND_WORDS.get(kind, "A rule")
        why = (f"it names a {axis} group {slot} doesn't have" if axis
               else "it names no tag group of it")
        return f"Left out a rule: {who} on {slot}: {why} ({slot}'s groups: {have})."
    m = _REF_SET.match(ref)
    if m:
        var, owner = m.groups()
        by = f"the {owner} slot" if owner else "a slot"
        return (f"Left out a rule: A rule that sets ${var}: {by} already picks ${var}, and a "
                "rule can't overwrite a pick. It could add words to it or set a new variable "
                "instead.")
    return f"Left out a rule: {ref}"


#: Derive text that is an instruction, not prompt words.
_RULE_TEXT = re.compile(r"^\s*(?:(?:exclude|include|avoid|allow|forbid|never|only)s?|not)\b",
                        re.I)


def _relations(
    raw: Any, slots: list[dict[str, Any]], fixed_vars: set[str], input_vars: set[str],
    warnings: list[str], bad_refs: list[str],
) -> list[dict[str, Any]]:
    by_name = _slot_index(slots)
    slot_vars = {s["var"] for s in slots}
    derived: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict) or r.get("kind") not in RELATIONS:
            continue
        kind = r["kind"]
        src, err = _side(r, "from", by_name,
                         need_value=kind not in ("agree", "accepts", "draw"))
        if src is None:
            # A rule that writes a variable says which and what, so the note
            # (and a Fix with AI from it) can name the rule it means.
            wvar, wtext = _var(r.get("var")), _clean(r.get("text"), 60).replace('"', "'")
            what = f' ${wvar} "{wtext}"' if kind in ("derive", "append") and wvar else ""
            bad_refs.append(f"{kind}{what}: {err}")
            continue
        rel: dict[str, Any] = {"kind": kind, "from": {"slot": src["slot"]["name"],
                                                      "axis": src["axis"],
                                                      "value": src["value"]},
                               "words": _words(r.get("words"))}
        if kind in ("derive", "append"):
            var = _var(r.get("var"))
            text = _clean(r.get("text"), MAX_TEXT)
            m = _WEIGHT_TEXT.match(text) if kind == "derive" and src["value"] else None
            if m and 0 < float(m.group(1)) <= MAX_WEIGHT_FACTOR:
                # A number is a weight, not text: it goes on the options
                # tagged with the value, and the rule is spent.
                factor = round(float(m.group(1)), 2)
                if factor != 1:
                    src["slot"].setdefault("weights", {})[src["value"]] = factor
                warnings.append(f"{src['slot']['name']}: {src['value']} options weigh "
                                f"\u00d7{factor:g} (the rule wrote a number, so it is a weight"
                                " on the options, not text)")
                continue
            if not var or not text:
                bad_refs.append(f"{kind} from {src['slot']['name']}: no variable or text")
                continue
            if _RULE_TEXT.match(text):
                # "exclude pastels" written into $color_rule is a rule said as
                # words: the prompt would print it and nothing excludes
                # anything (9B smoke, 2026-10-24). The request check asks
                # for the real rule.
                warnings.append(f"Left out ${var} \"{text[:40]}\": a rule written as prompt "
                                "text; a relation between the slots does that")
                continue
            if kind == "derive" and (var in slot_vars or var in fixed_vars or var in input_vars):
                # A pick can't be overwritten, but the rule's words can still
                # be added to it: the code turns it into an append instead of
                # dropping it (Dumi 2026-10-21: "how do we actually fix these?").
                owner = next((x["name"] for x in slots if x["var"] == var), "")
                kind = rel["kind"] = "append"
                warnings.append(f"{src['slot']['name']} → ${var}: the rule adds its words to "
                                f"${var} instead of replacing it, since "
                                + (f"the {owner} slot" if owner else "something else")
                                + " already sets it")
            if kind == "append" and var not in slot_vars | derived | fixed_vars:
                bad_refs.append(f"append: nothing sets ${var} before it")
                continue
            if not src["axis"]:
                bad_refs.append(f"{kind} from {src['slot']['name']} names no axis value")
                continue
            rel.update({"var": var, "text": text,
                        "otherwise": _clean(r.get("otherwise"), MAX_TEXT)
                        if kind == "derive" else ""})
            derived.add(var)
            out.append(rel)
            continue
        if kind == "draw":
            dst, err = _side(r, "to", by_name, need_value=False)
            if dst is None:
                bad_refs.append(f"draw: {err}")
                continue
            if dst["slot"] is src["slot"]:
                bad_refs.append(f"draw: {src['slot']['name']} from itself")
                continue
            rel["to"] = {"slot": dst["slot"]["name"], "axis": "", "value": ""}
            out.append(rel)
            continue
        if kind in ("agree", "accepts"):
            dst, err = _side(r, "to", by_name, need_value=False)
            if dst is None:
                bad_refs.append(f"{kind}: {err}")
                continue
            if dst["slot"] is src["slot"]:
                bad_refs.append(f"{kind}: {src['slot']['name']} with itself")
                continue
            axis = src["axis"] or dst["axis"] or _axis_name(r.get("from_axis")) \
                or _axis_name(r.get("to_axis"))
            a_src = next((a for a in src["slot"]["axes"] if a["name"] == (src["axis"] or axis)),
                         None)
            a_dst = next((a for a in dst["slot"]["axes"] if a["name"] == (dst["axis"] or axis)),
                         None)
            if a_src is None or a_dst is None:
                # Named on neither side, or only one: the one axis the two
                # slots share by values is the one meant.
                pairs = [(a, b) for a in src["slot"]["axes"] for b in dst["slot"]["axes"]
                         if set(a["values"]) & set(b["values"])]
                if len(pairs) == 1:
                    a_src, a_dst = pairs[0]
            if a_src is None or a_dst is None:
                missing = src["slot"]["name"] if a_src is None else dst["slot"]["name"]
                bad_refs.append(f"{kind} on {axis or '?'}: {missing} has no such axis")
                continue
            shared = [v for v in a_src["values"] if v in a_dst["values"]]
            if not shared:
                bad_refs.append(f"{kind} on {axis}: {src['slot']['name']} and "
                                f"{dst['slot']['name']} share no value")
                continue
            rel.update({"from": {"slot": src["slot"]["name"], "axis": a_src["name"],
                                 "value": ""},
                        "to": {"slot": dst["slot"]["name"], "axis": a_dst["name"],
                               "value": ""},
                        "values": shared})
            out.append(rel)
            continue
        dst, err = _side(r, "to", by_name, need_value=True)
        if dst is None:
            bad_refs.append(f"{kind}: {err}")
            continue
        if dst["slot"] is src["slot"]:
            bad_refs.append(f"{kind}: {src['slot']['name']} with itself")
            continue
        rel["to"] = {"slot": dst["slot"]["name"], "axis": dst["axis"], "value": dst["value"]}
        if kind in _WEIGHTED:
            f = _number(r.get("factor"), _WEIGHTED[kind])
            if kind == "boost" and f < 1:
                f = _WEIGHTED[kind]
            if kind == "reduce" and (f >= 1 or f == 0):
                f = _WEIGHTED[kind]
            rel["factor"] = f
        out.append(rel)
    dupes: set[str] = set()
    kept: list[dict[str, Any]] = []
    for rel in out:
        sig = _rel_key(rel)
        if sig in dupes:
            continue
        dupes.add(sig)
        kept.append(rel)
    if len(kept) > MAX_RELATIONS:
        warnings.append(f"Kept the first {MAX_RELATIONS} relations")
    return kept[:MAX_RELATIONS]


def _words(raw: Any) -> list[str]:
    """The things a relation is about, as an option would say them
    ("sandals", "shorts"): lowercase, distinct, at most 6."""
    out: list[str] = []
    for w in raw if isinstance(raw, list) else []:
        t = _clean(w, 40).lower().strip("\"'")
        if t and t not in out:
            out.append(t)
    return out[:MAX_WORDS]


def _has_word(text: str, word: str) -> bool:
    return re.search(r"(?<!\w)" + re.escape(word) + r"(?!\w)", text) is not None


def _rel_key(rel: dict[str, Any]) -> str:
    src = rel["from"]
    dst = rel.get("to") or {}
    return "|".join([rel["kind"], src["slot"], src["axis"], src["value"], dst.get("slot", ""),
                     dst.get("axis", ""), dst.get("value", ""), rel.get("var", ""),
                     rel.get("text", "")])


_LORA_INPUT = re.compile(r"lora|lycoris|locon", re.I)


def _template(raw: Any, slots: list[dict[str, Any]], fixed: list[dict[str, Any]],
              relations: list[dict[str, Any]], inputs: list[dict[str, str]],
              warnings: list[str]) -> dict[str, Any]:
    """The template's parts in order, each resolved to a variable."""
    raw = raw if isinstance(raw, dict) else {}
    by_name: dict[str, str] = {}
    for s in slots:
        if s["show"] == "prompt":
            by_name[s["name"].lower()] = s["var"]
            by_name[s["var"].lower()] = s["var"]
    for f in fixed:
        by_name[f["name"].lower()] = f["var"]
        by_name[f["var"].lower()] = f["var"]
    for r in relations:
        if r["kind"] == "derive":
            by_name[r["var"].lower()] = r["var"]
    for i in inputs:
        by_name[i["var"].lower()] = i["var"]
    internal = {s["var"] for s in slots if s["show"] == "internal"} | {
        s["name"].lower() for s in slots if s["show"] == "internal"}
    order: list[str] = []
    for part in _got if isinstance(_got := raw.get("order"), list) else []:
        p = _clean(part, MAX_NAME).lstrip("$").strip()
        var = by_name.get(p.lower())
        if var is None:
            if p.lower() in internal:
                warnings.append(f"The template doesn't read {p}: it's internal")
            elif p:
                warnings.append(f"The template names {p}, which nothing sets")
            continue
        if var not in order:
            order.append(var)
    lead = _placeholders(_clean(raw.get("lead"), MAX_TEXT), by_name, warnings)
    tail = _placeholders(_clean(raw.get("tail"), MAX_TEXT), by_name, warnings)
    lead, tail, order, read = _text_reads(lead, tail, order, by_name, warnings)
    for s in slots:
        if s["show"] == "prompt" and s["var"] not in order and s["var"] not in read:
            order.append(s["var"])
            warnings.append(f"Added ${s['var']} to the template so {s['name']} shows")
    # A fixed value and a derived variable exist to be read: the code
    # owns the template, so none is left out of it.
    for f in fixed:
        if f["var"] not in order and f["var"] not in read:
            order.append(f["var"])
            warnings.append(f"Added ${f['var']} to the template so {f['name']} shows")
    for var in dict.fromkeys(r["var"] for r in relations if r["kind"] == "derive"):
        if var not in order and var not in read:
            order.append(var)
            warnings.append(f"Added ${var} to the template so the rule writing it shows")
    # What the user gives (a subject, a name) is there to be shown, first;
    # a LoRA input stands in for a pick and is read by its swap rule.
    for i in reversed(inputs):
        if i["var"] not in order and i["var"] not in read \
                and not _LORA_INPUT.search(f"{i['var']} {i['about']}"):
            order.insert(0, i["var"])
            warnings.append(f"Added ${i['var']} to the template so what the user gives shows")
    negative = _clean(raw.get("negative"), MAX_TEXT * 2)
    # "{{inputs.neg_prompt}} {{fixed.default_neg}}" or "$neg = ugly, …" in
    # the negative (9B, 2026-10-21): a placeholder resolves or goes like in
    # the lead, and an assignment keeps its right-hand side.
    assigned = re.match(r"^\s*\$?[A-Za-z_]\w*\s*(?:=|:)\s*(?=\S)", negative)
    if assigned:
        warnings.append(f"Kept the words of \"{negative[:30]}\" as the negative: it was written "
                        "as an assignment")
        negative = negative[assigned.end():]
    negative = _placeholders(negative, by_name, warnings)
    rule_words = {w for r in relations for w in r.get("words") or []}
    if negative and rule_words:
        # "sandals, shorts in winter" is a relation, not a defect.
        kept, gone = [], []
        for chunk in negative.split(","):
            c = chunk.strip()
            if c and any(_has_word(c.lower(), w) for w in rule_words):
                gone.append(c)
            elif c:
                kept.append(c)
        if gone:
            warnings.append(f"Took \"{', '.join(gone)}\" out of the negative: a rule's words "
                            "belong in a relation, the negative is for defects")
            negative = ", ".join(kept)
    lead, tail, negative = _defects_to_negative(lead, tail, negative, warnings)
    lead, tail = _fixed_repeats(lead, tail, fixed, order, read, warnings)
    return {"lead": lead, "order": order[:MAX_TEMPLATE_PARTS], "tail": tail,
            "negative": negative}


def _fixed_repeats(lead: str, tail: str, fixed: list[dict[str, Any]], order: list[str],
                   read: set[str], warnings: list[str]) -> tuple[str, str]:
    """A part of the lead or tail that a fixed value the template prints
    already says ("clean lineart" in the lead of a pack whose style preset
    holds it, Sonnet walkthrough 2026-10-21) prints twice; it goes."""
    said: dict[str, str] = {}
    for f in fixed:
        if f["var"] in order or f["var"] in read:
            for chunk in f["text"].split(","):
                c = chunk.strip()
                m = _WEIGHTED_PART.match(c)
                word = (m.group(1) if m else c).strip().lower().replace("_", " ")
                if word:
                    said.setdefault(word, f["name"])
    if not said:
        return lead, tail
    gone: list[str] = []

    def fix(text: str) -> str:
        kept = []
        for chunk in text.split(","):
            c = chunk.strip()
            if not c:
                continue
            m = _WEIGHTED_PART.match(c)
            word = (m.group(1) if m else c).strip().lower().replace("_", " ")
            if word in said:
                gone.append(f"{c} ({said[word]})")
            else:
                kept.append(c)
        return ", ".join(kept)

    lead, tail = fix(lead), fix(tail)
    if gone:
        warnings.append(f"Took {', '.join(gone)} out of the template text: the fixed value "
                        "already says it, so it printed twice")
    return lead, tail


def _text_reads(lead: str, tail: str, order: list[str], by_name: dict[str, str],
                warnings: list[str]) -> tuple[str, str, list[str], set[str]]:
    """A pick's name written as plain text in the lead or tail
    ("quality_tags, style_preset, pose" led a bikini pack's prompt, 9B
    NSFW eval 2026-10-21) is a read of it: it becomes ``$var``. A variable
    the lead or tail reads leaves the order, so nothing prints twice; the
    set of them is returned so the order isn't told to add them back."""
    read: list[str] = []
    bare: list[str] = []

    def fix(text: str) -> str:
        parts = []
        for chunk in text.split(","):
            c = chunk.strip()
            var = by_name.get(c.lstrip("$").lower()) if c else None
            if var and _IDENT_PART.match(c):
                if not c.startswith("$"):
                    bare.append(c)
                c = f"${var}"
                read.append(var)
            if c:
                parts.append(c)
        return ", ".join(parts)

    lead, tail = fix(lead), fix(tail)
    if bare:
        warnings.append(f"The template text names {', '.join(bare)} as words: read as "
                        + ", ".join(f"${by_name[b.lower()]}" for b in bare) + " instead")
    order = [v for v in order if v not in read]
    return lead, tail, order, set(read)


_IDENT_PART = re.compile(r"^\$*[A-Za-z_][\w ]*$")

#: Standing-negative tags that have no place in a positive prompt. Only
#: whole comma-parts count ("bad anatomy", "(ugly:1.2)"), never a word
#: inside a phrase ("blurry background" is a look).
_DEFECTS = frozenset({
    "lowres", "low res", "worst quality", "low quality", "normal quality", "bad anatomy",
    "bad hands", "bad proportions", "bad feet", "bad fingers", "extra fingers", "extra digits",
    "fewer digits", "missing fingers", "extra limbs", "extra arms", "extra legs",
    "missing limbs", "mutated", "mutation", "mutated hands", "deformed", "disfigured",
    "malformed", "ugly", "blurry", "jpeg artifacts", "jpeg artifact", "watermark",
    "signature", "username", "artist name", "error", "cropped", "out of frame",
    "poorly drawn", "poorly drawn face", "poorly drawn hands", "long neck", "cloned face",
    "gross proportions", "bad eyes", "cross-eyed", "dehydrated", "duplicate", "morbid",
    "mutilated", "text", "logo",
})
_WEIGHTED_PART = re.compile(r"^\(\s*(.+?)\s*(?::\s*[\d.]+)?\s*\)$")


def _defects_to_negative(lead: str, tail: str, negative: str,
                         warnings: list[str]) -> tuple[str, str, str]:
    """Defect tags written into the lead or tail ("ugly, deformed, bad
    anatomy" in an OC pack's positive prompt, 9B NSFW eval 2026-10-21) go
    to the negative, where they belong."""
    moved: list[str] = []

    def fix(text: str) -> str:
        kept = []
        for chunk in text.split(","):
            c = chunk.strip()
            if not c:
                continue
            m = _WEIGHTED_PART.match(c)
            word = (m.group(1) if m else c).strip().lower().replace("_", " ")
            if word in _DEFECTS:
                moved.append(c)
            else:
                kept.append(c)
        return ", ".join(kept)

    lead, tail = fix(lead), fix(tail)
    if moved:
        have = {w.strip().lower() for w in negative.split(",")}
        add = [w for w in moved if w.lower() not in have]
        negative = ", ".join(x for x in [negative.strip(" ,"), *add] if x)
        warnings.append(f"Moved {', '.join(moved)} from the template text to the negative: "
                        "those are defects, not the picture")
    return lead, tail, negative


_PLACEHOLDER = re.compile(r"\{\{\s*\$?([A-Za-z][\w .]*?)\s*\}\}|\{\s*\$?([A-Za-z][\w.]*)\s*\}")


def _placeholders(text: str, by_name: dict[str, str], warnings: list[str]) -> str:
    """``{{quality}}`` / ``{subject}`` written into the lead or tail: a
    variable the graph has becomes ``$var``; the rest is taken out, since
    the Assembler would print it as it is."""
    gone: list[str] = []

    def repl(m: re.Match[str]) -> str:
        name = (m.group(1) or m.group(2) or "").strip()
        var = by_name.get(name.lower()) or by_name.get(name.lower().replace(" ", "_"))
        if var:
            return f"${var}"
        gone.append(name)
        return ""

    out = _PLACEHOLDER.sub(repl, text)
    if gone:
        warnings.append(f"Took {', '.join('{' + g + '}' for g in gone)} out of the template "
                        "text: nothing sets it, and it would print as it is")
        out = re.sub(r"\s*,\s*(?=,|$)", "", re.sub(r"^\s*,\s*", "", out)).strip()
        out = re.sub(r",\s*,", ",", out).strip(" ,")
    return out


_PERSON_LEAD = re.compile(r"^\s*(?:\d*\s*(?:girls?|boys?|others?)|solo|\(?looking at viewer"
                          r"(?::\d+(?:\.\d+)?\)?)?)\s*$", re.I)


_PERSON_ASK = re.compile(
    r"\b(?:subjects?|characters?|people|persons?|figures?|m[ae]n|wom[ae]n|heroe?s?|"
    r"heroines?|someone|protagonists?|models?|who|\d*girls?|\d*boys?|solo|couples?|"
    r"pin-?ups?|lingerie|nude|nsfw|lewd|erotic|sexy|ecchi|hentai|waifus?|oc|outfits?|"
    r"hair\w*|faces?|selfies?|poses?|cosplay\w*|idols?|warriors?|knights?|wizards?|"
    r"witch\w*|elf|elves|dwar(?:f|ves)|orcs?|maids?|nurses?|pirates?|samurai|ninjas?|"
    r"soldiers?|athletes?|dancers?|portraits? of (?:a |the )?(?:wom|m|girl|boy|person))\b",
    re.I)
_THING_ASK = re.compile(
    r"\b(?:animals?|wildlife|creatures?|cats?|dogs?|lions?|tigers?|wolves|birds?|horses?|"
    r"cars?|vehicles?|motorcycles?|ships?|planes?|landscapes?|scenery|sceneries|interiors?|"
    r"rooms?|architecture|buildings?|cityscapes?|food|dish(?:es)?|meals?|desserts?|drinks?|"
    r"still life|products?|logos?|patterns?|textures?|plants?|flowers?|weapons? (?:only|alone)|"
    r"props?|furniture|gadgets?|planets?|space ?ships?|mechs?|robots? only)\b", re.I)


def unasked_lead(lead: str, request: str) -> tuple[str, list[str]]:
    """A person the request never asked for ("1girl, solo" on an animal
    pack): those parts of the lead are taken out, only when the request
    names no person and does name a thing (an animal, a car, a room, a
    dish). Returns the lead and the parts taken."""
    if not request.strip() or _PERSON_ASK.search(request) or not _THING_ASK.search(request):
        return lead, []
    kept, gone = [], []
    for chunk in lead.split(","):
        c = chunk.strip()
        if c and _PERSON_LEAD.match(c):
            gone.append(c)
        elif c:
            kept.append(c)
    return (", ".join(kept), gone) if gone else (lead, [])


def _compiled(raw: dict[str, Any]) -> bool:
    """Whether ``raw`` is a graph ``compile_graph`` made (relations carry
    ``from`` objects) rather than one the model wrote."""
    rels = raw.get("relations")
    if isinstance(rels, list) and any(isinstance(r, dict) and isinstance(r.get("from"), dict)
                                      for r in rels):
        return True
    # No relation at all, but ``bad_refs``: only ``compile_graph`` writes
    # that key (``graph_answer`` and the plan's graph never carry it).
    return isinstance(raw.get("bad_refs"), list) and not rels


def compile_graph(raw: Any) -> dict[str, Any]:
    """The model's graph, cleaned and checked: ``{title, summary, design,
    rating, style, model, anchor, questions, assumptions, from_images,
    research, run, inputs, sections, slots, fixed, relations, template,
    warnings, bad_refs}``. ``bad_refs`` are the relations that named a slot,
    axis or value the graph doesn't declare (left out, for a repair call).
    Raises PlanError when the graph has no slot."""
    if not isinstance(raw, dict):
        raise PlanError("the answer wasn't a pack graph")
    dropped = [b for b in raw.get("dropped") or [] if isinstance(b, str)] \
        if isinstance(raw.get("dropped"), list) else []
    if _compiled(raw):
        # A graph compiled before (a plan sent back): read it as written,
        # remembering what it had already dropped.
        dropped += [b for b in raw.get("bad_refs") or [] if isinstance(b, str)]
        raw = graph_answer({"graph": raw})
    warnings: list[str] = []
    bad_refs: list[str] = []
    inputs: list[dict[str, str]] = []
    for i in _got if isinstance(_got := raw.get("inputs"), list) else []:
        if isinstance(i, dict) and _var(i.get("var")) and len(inputs) < MAX_INPUTS \
                and not any(x["var"] == _var(i.get("var")) for x in inputs):
            inputs.append({"var": _var(i.get("var")), "about": _clean(i.get("about"), 200),
                           "example": _clean(i.get("example"), 200)})
    taken = {i["var"] for i in inputs}
    slots = _slots(raw.get("slots"), warnings, taken)
    if not slots:
        raise PlanError("the graph has no slot: add one wildcard slot per choice the image "
                        "makes")
    fixed = _fixed(raw.get("fixed"), warnings, taken)
    _infer_axes(raw.get("relations"), slots, warnings)
    relations = _relations(raw.get("relations"), slots, {f["var"] for f in fixed},
                           {i["var"] for i in inputs}, warnings, bad_refs)
    _onto_lists(slots, relations, warnings)
    _list_slots(slots, relations, raw.get("template"), warnings)
    template = _template(raw.get("template"), slots, fixed, relations, inputs, warnings)
    _story_holds(slots, parse_run(raw.get("run")), warnings)
    read_by_relation = {r["from"]["slot"] for r in relations} | {
        r["to"]["slot"] for r in relations if r.get("to")}
    for s in slots:
        if s["show"] == "internal" and s["name"] not in read_by_relation:
            warnings.append(f"{s['name']} is internal but no relation reads it: it does "
                            "nothing")
    sections: list[dict[str, str]] = []
    for sec in _got if isinstance(_got := raw.get("sections"), list) else []:
        if isinstance(sec, dict) and _clean(sec.get("name"), 40) and len(sections) < MAX_SECTIONS:
            sections.append({"name": _clean(sec.get("name"), 40),
                             "about": _clean(sec.get("about"), 200)})
    questions = []
    for q in _got if isinstance(_got := raw.get("questions"), list) else []:
        if isinstance(q, dict) and _clean(q.get("question"), 300):
            questions.append({"header": _clean(q.get("header"), 60),
                              "question": _clean(q.get("question"), 300),
                              "multi": q.get("multi") is True,
                              "choices": [_clean(c, 120) for c in q.get("choices") or []
                                          if _clean(c, 120)][:5]})
    anchor = _var(raw.get("anchor"))
    if anchor and anchor not in {s["var"] for s in slots}:
        anchor = ""
    if not anchor:
        # The first pick the prompt shows, never a list or a driver.
        anchor = next((s["var"] for s in slots if s["show"] == "prompt"), "")
    graph: dict[str, Any] = {
        "title": _clean(raw.get("title"), MAX_NAME) or "AI pack",
        "summary": _clean(raw.get("summary"), 300),
        "design": _clean(raw.get("design"), 900),
        "rating": raw.get("rating") if raw.get("rating") in ("safe", "nsfw") else "safe",
        "style": raw.get("style") if raw.get("style") in STYLES else "tags",
        "model": _model(raw.get("model")),
        "anchor": anchor or slots[0]["var"],
        "questions": questions[:MAX_QUESTIONS],
        "assumptions": [_clean(a, 200) for a in raw.get("assumptions") or []
                        if _clean(a, 200)][:6],
        "from_images": [_clean(a, 200) for a in raw.get("from_images") or []
                        if _clean(a, 200)][:4],
        "research": [_clean(a, 200) for a in raw.get("research") or [] if _clean(a, 200)][:2],
        "run": _got if isinstance(_got := raw.get("run"), dict) else {"mode": "single",
                                                                       "frames": 0},
        "inputs": inputs,
        "sections": sections,
        "slots": slots,
        "fixed": fixed,
        "relations": relations,
        "template": template,
        "warnings": warnings,
        "bad_refs": bad_refs,
        "dropped": list(dict.fromkeys(dropped)),
    }
    if _clean(raw.get("quality_words"), MAX_TEXT):
        # The pack's own quality words, kept by the code when the per-family
        # rule takes over $quality: the rule's "otherwise".
        graph["quality_words"] = _clean(raw.get("quality_words"), MAX_TEXT)
    return graph


# --- the graph as plan items ------------------------------------------------

def _onto_lists(slots: list[dict[str, Any]], relations: list[dict[str, Any]],
                warnings: list[str]) -> None:
    """A rule on a drawer's tag that the list it draws from also carries
    goes onto the list: the drawn pick is what the prompt shows, and a rule
    on the drawer's own tag never sees it ("winter never pastel" on Shirt
    while the colour came in through the Color List ref: 4 of 10 winter
    runs pastel, 9B smoke 2026-10-24). A rule on the list reaches every
    drawer's draw."""
    by_name = {s["name"]: s for s in slots}
    lists: dict[str, list[str]] = {}
    for r in relations:
        if r["kind"] == "draw":
            lists.setdefault(r["to"]["slot"], []).append(r["from"]["slot"])
    for r in relations:
        to = r.get("to") or {}
        if r["kind"] not in ("exclude", "only", "boost", "reduce") or not to.get("value") \
                or to["slot"] not in lists:
            continue
        # "soft_pastel" on the drawer is the list's "soft" (9B smoke,
        # 2026-10-24): a part of the value names the list's value.
        parts = [to["value"], *re.split(r"[_\- ]+", to["value"])]
        for name in lists[to["slot"]]:
            hit = next(((a, p) for p in parts for a in by_name[name]["axes"]
                        if p in a["values"]), None)
            if hit is None or name == r["from"]["slot"]:
                continue
            ax, value = hit
            warnings.append(f"{r['from']['slot']} → {to['slot']} {to['value']}: the rule goes on "
                            f"{name} {value}, the list {to['slot']} draws its {ax['name']} from")
            r["to"] = {"slot": name, "axis": ax["name"], "value": value}
            break


def _list_slots(slots: list[dict[str, Any]], relations: list[dict[str, Any]],
                raw_template: Any, warnings: list[str]) -> None:
    """A slot other slots only draw from is a list, not a pick of its own:
    it goes internal unless the template names it. A rule that narrows the
    list (it is the rule's target: "colours fit the season") keeps it a
    list; a rule it drives (its pick is a source) makes it a pick."""
    named: set[str] = set()
    order = raw_template.get("order") if isinstance(raw_template, dict) else None
    for part in order if isinstance(order, list) else []:
        named.add(_clean(part, MAX_NAME).lstrip("$").strip().lower())
    for s in slots:
        drawn = [r for r in relations if r["kind"] == "draw" and r["from"]["slot"] == s["name"]]
        other = [r for r in relations if r["kind"] != "draw" and r["from"]["slot"] == s["name"]]
        if drawn and not other and s["show"] == "prompt" \
                and not {s["name"].lower(), s["var"].lower()} & named:
            s["show"] = "internal"
            warnings.append(f"{s['name']} is a list the others draw from, so it isn't a "
                            "pick of its own: internal")


def draw_sources(graph: dict[str, Any], slot: dict[str, Any]) -> list[dict[str, Any]]:
    """The ``draw`` relations that put a pick in front of this slot's options."""
    return [r for r in graph["relations"] if r["kind"] == "draw"
            and r["to"]["slot"] == slot["name"]]


def draw_refs(plan: dict[str, Any], built: dict[str, Any]) -> dict[str, str]:
    """Slot name → built wildcard id, for the refs a ``draw`` writes."""
    graph = plan.get("graph")
    if not isinstance(graph, dict):
        return {}
    out: dict[str, str] = {}
    for s in graph["slots"]:
        sid = _dep_ids(plan, built, s["var"])
        if sid:
            out[s["name"]] = sid
    return out


def _slot_rel_words(rel: dict[str, Any]) -> str:
    src, dst = rel["from"], rel.get("to") or {}
    if rel["kind"] == "draw":
        return (f"{dst['slot']} options each start with a fresh {src['slot']} pick"
                + (f" ({src['value']})" if src["value"] else ""))
    if rel["kind"] in ("agree", "accepts"):
        return (f"{dst['slot']} goes with {src['slot']} on {src['axis']} "
                f"({', '.join(rel['values'])})")
    if rel["kind"] == "derive":
        return (f"${rel['var']} is \"{rel['text']}\" when {src['slot']}.{src['axis']} is "
                f"{src['value']}" + (f", else \"{rel['otherwise']}\"" if rel["otherwise"]
                                     else ""))
    if rel["kind"] == "append":
        return (f"\"{rel['text']}\" is added to ${rel['var']} when {src['slot']}.{src['axis']} "
                f"is {src['value']}")
    verb = {"exclude": "never gets", "only": "only gets", "boost": "favours",
            "reduce": "rarely gets"}[rel["kind"]]
    words = f" ({', '.join(rel['words'])})" if rel.get("words") else ""
    return f"{src['slot']} {src['value']} {verb} {dst['slot']} {dst['value']}{words}"


def _use(slot: dict[str, Any]) -> str:
    parts = []
    if slot["pick"]:
        parts.append(f"pick {slot['pick']}")
    if slot["hold"]:
        parts.append("hold")
    if slot["show"] == "internal":
        parts.append("internal")
    return "; ".join(parts)


def derived_vars(graph: dict[str, Any]) -> list[str]:
    """Variables the relations write, in first-mention order."""
    return list(dict.fromkeys(r["var"] for r in graph["relations"]
                              if r["kind"] in ("derive", "append")))


def constraint_pairs(graph: dict[str, Any]) -> list[tuple[str, str]]:
    """(source slot, target slot) pairs that get one constraint each."""
    out: list[tuple[str, str]] = []
    for r in graph["relations"]:
        if r["kind"] in NARROWING and (r["from"]["slot"], r["to"]["slot"]) not in out:
            out.append((r["from"]["slot"], r["to"]["slot"]))
    return out


# --- what the run style and the model setting need, wired by the code ------

#: The story-beat derivation of a story run: the model writes only the
#: beats; the template reads $beat last.
BEAT_VAR = "beat"
#: The per-model-family quality derivation (settings ``model: family``).
QUALITY_VAR = "quality"


def _graph_sets(graph: dict[str, Any]) -> set[str]:
    return {s["var"] for s in graph["slots"]} | {f["var"] for f in graph["fixed"]} | set(
        derived_vars(graph)) | {i["var"] for i in graph["inputs"]}


def _graph_text(graph: dict[str, Any]) -> str:
    return " ".join([*(s["what"] for s in graph["slots"]),
                     *(f["text"] for f in graph["fixed"]),
                     *(r.get("text") or "" for r in graph["relations"]),
                     *(r.get("var") or "" for r in graph["relations"])]).lower()


def code_beat(graph: dict[str, Any]) -> list[str]:
    """On a story run the code sets $beat from $iteration: a slot, fixed
    value or relation the planner wrote for $beat is taken out (browser
    check 2026-10-19: a refine turned the code's beat derivation into a
    plain Beat wildcard that never read $iteration, so the story finding
    came back after every Fix all). Returns the applied lines."""
    if parse_run(graph["run"])["mode"] != "story":
        return []
    gone: list[str] = []
    names = {s["name"] for s in graph["slots"] if s["var"] == BEAT_VAR}
    if names:
        graph["slots"] = [s for s in graph["slots"] if s["var"] != BEAT_VAR]
        gone += sorted(names)
    fixed = [f["name"] for f in graph["fixed"] if f["var"] == BEAT_VAR]
    if fixed:
        graph["fixed"] = [f for f in graph["fixed"] if f["var"] != BEAT_VAR]
        gone += fixed
    kept = []
    for r in graph["relations"]:  # compiled: {"from": {"slot", …}, "to": {…} | None, "var"}
        ends = {(r.get("from") or {}).get("slot"), (r.get("to") or {}).get("slot")}
        if r.get("var") == BEAT_VAR or ends & names:
            if r.get("var") == BEAT_VAR and f"${BEAT_VAR} rule" not in gone:
                gone.append(f"${BEAT_VAR} rule")
            continue
        kept.append(r)
    graph["relations"] = kept
    if not gone:
        return []
    return [f"The code sets ${BEAT_VAR} from $iteration on a story: dropped the planner's "
            + ", ".join(gone)]


def story_beat(graph: dict[str, Any]) -> bool:
    """Whether the code adds the story-beat derivation: a story run whose
    graph doesn't set $beat itself."""
    return parse_run(graph["run"])["mode"] == "story" and BEAT_VAR not in _graph_sets(graph)


def model_families(graph: dict[str, Any]) -> list[str]:
    """The image model families the graph's ``model`` names ("pony, flux"
    → pony, flux), in the guide's keys."""
    from engine.ai import guide as ai_guide
    out: list[str] = []
    for part in re.split(r"[,/&+]|\band\b|\bor\b", graph.get("model") or ""):
        fam = ai_guide.family(part.strip())
        if fam and fam not in out:
            out.append(fam)
    return out


def request_families(request: str) -> list[str]:
    """The image model families a request names, in the guide's keys."""
    from engine.ai import guide as ai_guide
    return [key for rx, key in ai_guide._FAMILY if rx.search(request or "")]


def trim_model(graph: dict[str, Any], request: str) -> list[str]:
    """The graph's ``model`` keeps only the families the request names when
    the planner wrote two or more the request didn't ask for ("flux, sd3"
    on a request naming no model; 9B, 2026-10-21, 9 packs): two families
    would add the per-family quality rule, and with no WP Model Info the
    template then read a $quality no run set. Returns the lines saying so."""
    if not (request or "").strip() or len(model_families(graph)) < 2:
        return []
    asked = set(request_families(request))
    if len(asked & set(model_families(graph))) >= 2:
        return []
    from engine.ai import guide as ai_guide
    parts = [p.strip() for p in re.split(r"[,/&+]|\band\b|\bor\b", graph["model"])
             if p.strip()]
    kept = [p for p in parts if ai_guide.family(p) in asked] or parts[:1]
    was, graph["model"] = graph["model"], ", ".join(kept)
    return [f"Model: {graph['model']} (the planner wrote \"{was}\", but the request names "
            "no second family, so there is no per-family quality rule)"]


def model_quality(graph: dict[str, Any], settings: Any) -> bool:
    """Whether the code adds the per-model-family quality derivation: the
    model setting asks for it, or the request names two families (a pack
    for Pony and Flux), and nothing in the graph reads the model
    variables."""
    if parse_settings(settings)["model"] != "family" and len(model_families(graph)) < 2:
        return False
    text = _graph_text(graph)
    return "model_variant" not in text and "model_family" not in text


def sweep_axes(graph: dict[str, Any]) -> list[str]:
    """The slot variables a sweep sheet compares: the slots marked
    ``sweep``, else the 2 shortest prompt slots that roll one pick. []
    outside a sweep run."""
    if parse_run(graph["run"])["mode"] != "sweep":
        return []
    prompt = [s for s in graph["slots"] if s["show"] == "prompt"]
    marked = [s["var"] for s in prompt if s.get("sweep")]
    if marked:
        return marked[:3]
    free = [s for s in prompt if not s["hold"] and not s["pick"]]
    return [s["var"] for s in sorted(free, key=lambda s: s["count"])[:2]]


def template_order(graph: dict[str, Any], settings: Any = None) -> list[str]:
    """The template's variables in order, with what the run style and the
    model setting add: $quality first, $beat last."""
    order = list(graph["template"]["order"])
    if model_quality(graph, settings) and QUALITY_VAR not in order:
        order.insert(0, QUALITY_VAR)
    if story_beat(graph) and BEAT_VAR not in order:
        order.append(BEAT_VAR)
    return order[:MAX_TEMPLATE_PARTS]


def run_items(graph: dict[str, Any], settings: Any = None) -> list[dict[str, Any]]:
    """The items the run style and the model setting need that the graph
    doesn't carry: the story beat and the model-family quality derivations
    (the model writes their branches; the code wires the rest)."""
    items: list[dict[str, Any]] = []
    if model_quality(graph, settings):
        fams = model_families(graph)
        items.append({
            "kind": "derivation", "name": "Model quality", "var": QUALITY_VAR, "section": "",
            "about": "Sets $quality from $model_variant"
                     + (f" (the pack runs on {', '.join(fams)})" if len(fams) > 1 else "")
                     + ": pony → score_9, score_8_up, score_7_up; illustrious or noobai → "
                     "masterpiece, best quality, very aesthetic; else the pack's own quality "
                     "words.",
            "count": 0, "tags": [], "source": "", "target": "", "use": ""})
    if story_beat(graph):
        n = parse_run(graph["run"])["frames"]
        # A beat that describes the hero gives every frame a different one
        # (9B smoke, 2026-10-24: a young man, then a young woman, while
        # Hero was held): the held slots print themselves.
        held = [s["var"] for s in graph["slots"] if s["hold"] and s["show"] == "prompt"]
        keep = (" Never describe what " + ", ".join(f"${v}" for v in held) + " already say "
                "(they are the same in every frame and print themselves): only what happens."
                if held else "")
        items.append({
            "kind": "derivation", "name": "Story beat", "var": BEAT_VAR, "section": "",
            "about": f"Sets $beat from $iteration, one branch per frame 1 to {n} (equals "
                     "\"1\", \"2\", …), each one short step of the story in order." + keep,
            "count": 0, "tags": [], "source": "", "target": "", "use": ""})
    return items


def library_slots(graph: dict[str, Any], library: list[dict[str, Any]] | None,
                  settings: Any) -> dict[str, dict[str, Any]]:
    """Slot variable → the user's own wildcard that stands in for it
    (settings library "reuse"): a prompt slot with no axes that no relation
    names, matched by name, else by variable, to exactly one library
    wildcard. A slot with axes or rules keeps its tags, which the user's
    wildcard doesn't carry."""
    if parse_settings(settings)["library"] != "reuse" or not library:
        return {}
    rows = [r for r in library if r.get("type") == "wildcard"
            and isinstance(r.get("payload"), dict) and _row_var(r)]
    named = {r["from"]["slot"] for r in graph["relations"]} | {
        r["to"]["slot"] for r in graph["relations"] if r.get("to")}
    out: dict[str, dict[str, Any]] = {}
    for s in graph["slots"]:
        if s["axes"] or s["show"] != "prompt" or s["name"] in named or s.get("self_axis"):
            continue
        hits = [r for r in rows if str(r.get("name") or "").lower() == s["name"].lower()]
        if not hits:
            hits = [r for r in rows if _row_var(r) == s["var"]]
        if len(hits) == 1:
            out[s["var"]] = hits[0]
    return out


def apply_library(graph: dict[str, Any], library: list[dict[str, Any]] | None,
                  settings: Any) -> list[str]:
    """Reuse what fits, on the graph: a slot the library already has takes
    that wildcard's variable (the template and the anchor follow), and the
    plan item for it is the user's own (``graph_plan``). Returns the lines
    saying so."""
    lines: list[str] = []
    for var, row in library_slots(graph, library, settings).items():
        slot = slot_by_var(graph, var)
        mine = _row_var(row)
        if slot is None:
            continue
        if mine != var:
            slot["var"] = mine
            graph["template"]["order"] = [mine if v == var else v
                                          for v in graph["template"]["order"]]
            if graph["anchor"] == var:
                graph["anchor"] = mine
        lines.append(f"{slot['name']}: your wildcard {row.get('name')} (${mine}) is used as "
                     "it is")
    return lines


def graph_plan(graph: dict[str, Any], settings: Any = None,
               library: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The graph as the raw plan ``compile_plan`` takes: one wildcard per
    slot (the user's own, ``library``, where ``library_slots`` says so),
    fixed values, one derivation per written variable, one constraint per
    (source, target) slot pair, and the template. A story run adds the
    story-beat derivation, a sweep run marks its axes and holds the rest,
    and the model setting adds the quality derivation (``run_items``)."""
    slot_by_name = {s["name"]: s for s in graph["slots"]}
    axes = sweep_axes(graph)
    mine = library_slots(graph, library, settings)
    items: list[dict[str, Any]] = []
    for f in graph["fixed"]:
        items.append({"kind": "fixed_values", "name": f["name"], "var": f["var"],
                      "section": "", "about": f"${f['var']} = {f['text']}", "count": 0,
                      "tags": [], "source": "", "target": "", "use": ""})
    drawn = {r["from"]["slot"] for r in graph["relations"] if r["kind"] == "draw"}
    for s in sorted(graph["slots"], key=lambda s: 0 if s["name"] in drawn else 1):
        tags = [v for a in s["axes"] for v in a["values"]]
        about = s["what"] or s["name"]
        if s["axes"]:
            about += ". Axes: " + "; ".join(f"{a['name']}: {', '.join(a['values'])}"
                                            for a in s["axes"])
        count, use = s["count"], _use(s)
        if s["var"] in axes:
            about += ". Sweep axis"
            count = min(count, MAX_SWEEP_OPTIONS)
        elif axes and s["show"] == "prompt" and "hold" not in use:
            use = "; ".join(x for x in [use, "hold"] if x)
        if s["var"] in mine:
            row = mine[s["var"]]
            items.append({"kind": "library", "name": str(row.get("name") or s["name"]),
                          "var": _row_var(row), "section": s["section"],
                          "about": _clean(about, MAX_ABOUT), "count": 0, "tags": [],
                          "source": "", "target": "", "use": use})
            continue
        items.append({"kind": "wildcard", "name": s["name"], "var": s["var"],
                      "section": s["section"], "about": _clean(about, MAX_ABOUT),
                      "count": count, "tags": tags[:MAX_TAGS], "source": "", "target": "",
                      "use": use})
    for src, dst in constraint_pairs(graph):
        rels = [r for r in graph["relations"] if r.get("to") and r["from"]["slot"] == src
                and r["to"]["slot"] == dst]
        items.append({"kind": "constraint", "name": f"{src} → {dst}", "var": "",
                      "section": slot_by_name[dst]["section"],
                      "about": _clean("; ".join(_slot_rel_words(r) for r in rels), MAX_ABOUT),
                      "count": 0, "tags": [], "source": slot_by_name[src]["var"],
                      "target": slot_by_name[dst]["var"], "use": ""})
    for var in derived_vars(graph):
        rels = [r for r in graph["relations"] if r.get("var") == var]
        title = var.replace("_", " ").title()
        items.append({"kind": "derivation", "name": f"{title} rule", "var": var,
                      "section": "",
                      "about": _clean("; ".join(_slot_rel_words(r) for r in rels), MAX_ABOUT),
                      "count": 0, "tags": [], "source": "", "target": "", "use": ""})
    items += run_items(graph, settings)
    t = graph["template"]
    items.append({"kind": "template", "name": graph["title"], "var": "", "section": "",
                  "about": _clean("Reads " + ", ".join(f"${v}" for v in
                                                      template_order(graph, settings))
                                  + (f". Standing negative: {t['negative']}"
                                     if t["negative"] else ""), MAX_ABOUT),
                  "count": 0, "tags": [], "source": "", "target": "", "use": ""})
    return {
        "title": graph["title"], "summary": graph["summary"], "design": graph["design"],
        "rating": graph["rating"], "style": graph["style"], "model": graph["model"],
        "anchor": graph["anchor"], "questions": graph["questions"],
        "assumptions": graph["assumptions"], "from_images": graph["from_images"],
        "research": graph["research"], "run": graph["run"], "inputs": graph["inputs"],
        "sections": graph["sections"], "items": items,
    }


# --- wiring: payloads code writes ------------------------------------------

def _slot_of(graph: dict[str, Any], item: dict[str, Any]) -> dict[str, Any] | None:
    return next((s for s in graph["slots"] if s["var"] == item.get("var")), None)


def slot_for(plan: dict[str, Any], key: str) -> dict[str, Any] | None:
    """The graph slot a plan item builds, or None for a wired item."""
    graph = plan.get("graph")
    item = next((i for i in plan["items"] if i["key"] == key), None)
    if not isinstance(graph, dict) or item is None or item["kind"] != "wildcard":
        return None
    return _slot_of(graph, item)


def is_wired(plan: dict[str, Any], key: str) -> bool:
    """Whether code writes this item's payload (everything but a slot and
    a library item in a graph plan)."""
    graph = plan.get("graph")
    item = next((i for i in plan["items"] if i["key"] == key), None)
    if not isinstance(graph, dict) or item is None or item["kind"] == "library":
        return False
    if item["kind"] == "wildcard":
        slot = _slot_of(graph, item)
        return bool(slot and slot.get("self_axis"))
    if item["kind"] == "constraint":
        return bool(slot_by_var(graph, item["source"]) and slot_by_var(graph, item["target"]))
    if item["kind"] == "derivation":
        return item["var"] in derived_vars(graph)
    if item["kind"] == "fixed_values":
        return any(f["var"] == item["var"] for f in graph["fixed"])
    return item["kind"] == "template"


def slot_by_var(graph: dict[str, Any], var: str) -> dict[str, Any] | None:
    return next((s for s in graph["slots"] if s["var"] == var), None)


def axis_kinds(graph: dict[str, Any], slot: dict[str, Any]) -> dict[str, str]:
    """Each axis of ``slot`` as ``classify`` (an option IS one or more of
    its values) or ``accepts`` (one value per option, rolled, readable as
    ``$var.AXIS``: what a derivation keys on, or what the slot OFFERS a
    partner in an ``accepts`` relation)."""
    kinds = {a["name"]: "classify" for a in slot["axes"]}
    for r in graph["relations"]:
        if r["from"]["slot"] == slot["name"] and r["kind"] in _ROLLED_SOURCE \
                and r["from"]["axis"] in kinds:
            kinds[r["from"]["axis"]] = "accepts"
    return kinds


def inbound(graph: dict[str, Any], slot: dict[str, Any]) -> list[dict[str, Any]]:
    """Relations that narrow this slot's pick (it is their target)."""
    return [r for r in graph["relations"] if r["kind"] in NARROWING
            and r["to"]["slot"] == slot["name"]]


def _dep_ids(plan: dict[str, Any], built: dict[str, Any], var: str) -> str:
    key = next((i["key"] for i in plan["items"] if i.get("var") == var
                and i["kind"] in ("wildcard", "library")), None)
    b = built.get(key) if key else None
    return b["id"] if isinstance(b, dict) and isinstance(b.get("id"), str) else ""


def wired_payload(plan: dict[str, Any], key: str, built: dict[str, Any]) -> dict[str, Any]:
    """``{kind, payload, preview, warnings}`` for an item code writes from
    the graph: a fixed values, a constraint (both wildcards must be built,
    for their ids), a derivation or the template. Raises PlanError when a
    wildcard it needs isn't built yet. In a pack rated nsfw the item gets
    the adult pass the model-written items get (`adult_pack.adult_check`:
    minor words out, the youth negative on the template; ValueError when
    nothing would be left)."""
    out = _wired(plan, key, built)
    if plan.get("rating") == "nsfw":
        from engine.ai.pack.adult_pack import adult_check
        payload, said = adult_check(out["kind"], out["payload"], plan)
        if said:
            out = {**out, "payload": payload, "warnings": [*out["warnings"], *said]}
    return out


def _wired(plan: dict[str, Any], key: str, built: dict[str, Any]) -> dict[str, Any]:
    graph = plan["graph"]
    item = next(i for i in plan["items"] if i["key"] == key)
    kind = item["kind"]
    if kind == "wildcard":
        slot = _slot_of(graph, item)
        if slot is None or not slot.get("self_axis"):
            raise PlanError(f"{item['name']} isn't wired by the graph")
        return {"kind": kind, **axis_payload(graph, slot)}
    if kind == "fixed_values":
        f = next(x for x in graph["fixed"] if x["var"] == item["var"])
        row: dict[str, Any] = {"id": "val00001", "name": f["var"], "value": f["text"]}
        if f["negative"]:
            row["negative"] = f["negative"]
        return {"kind": kind, "payload": {"values": [row]},
                "preview": [f"${f['var']} = {f['text']}"], "warnings": []}
    if kind == "constraint":
        src, dst = slot_by_var(graph, item["source"]), slot_by_var(graph, item["target"])
        sid, tid = _dep_ids(plan, built, item["source"]), _dep_ids(plan, built, item["target"])
        if not sid or not tid:
            raise PlanError(f"build {src['name'] if not sid else dst['name']} before "
                            f"{item['name']}")
        matrix: dict[str, dict[str, dict[str, Any]]] = {}
        preview = []
        for r in graph["relations"]:
            # Only narrowing relations are cells: a "draw" between the same
            # two slots wrote a draw cell with no target tag, which failed
            # every run (9B smoke, shirts by season, 2026-10-24).
            if r["kind"] not in NARROWING or r["from"]["slot"] != src["name"] \
                    or r["to"]["slot"] != dst["name"]:
                continue
            if r["kind"] in ("agree", "accepts"):
                for v in r["values"]:
                    matrix.setdefault(v, {})[v] = {"mode": "only", "factor": 1}
            else:
                cell = {"mode": r["kind"], "factor": 0 if r["kind"] == "exclude"
                        else r.get("factor", 1)}
                matrix.setdefault(r["from"]["value"], {})[r["to"]["value"]] = cell
            preview.append(_slot_rel_words(r))
        return {"kind": kind, "payload": {"source_wildcard_id": sid, "target_wildcard_id": tid,
                                         "matrix": matrix, "exceptions": []},
                "preview": preview, "warnings": []}
    if kind == "derivation":
        rels = [r for r in graph["relations"] if r.get("var") == item["var"]]
        otherwise = _otherwise(rels)
        # One rule per source axis: rows keyed on a second axis of the slot
        # (or another slot) ADD to the variable in a rule of their own.
        # In one if/elif the first axis always won and every row on the
        # other was "broken" (9B, 2026-10-21, $habitat_preference).
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for r in rels:
            groups.setdefault((r["from"]["slot"], r["from"]["axis"]), []).append(r)
        rules: list[dict[str, Any]] = []
        warnings: list[str] = []
        for n, ((_sname, axis), rows) in enumerate(groups.items()):
            branches = []
            for r in rows:
                src = next((s for s in graph["slots"] if s["name"] == r["from"]["slot"]), None)
                if src is None:
                    raise PlanError(f"{item['name']} reads {r['from']['slot']}, which the "
                                    "graph no longer has")
                branches.append({
                    "condition": {"var": f"{src['var']}.{axis}", "op": "equals",
                                  "value": r["from"]["value"]},
                    "action": {"target_var": item["var"],
                               "mode": "replace" if r["kind"] == "derive" and n == 0
                               else "append",
                               "value": r["text"]},
                })
            rule: dict[str, Any] = {"id": f"rule{n + 1:04d}", "branches": branches}
            if n == 0 and otherwise:
                rule["else"] = {"action": {"target_var": item["var"], "mode": "replace",
                                           "value": otherwise}}
            if n > 0:
                warnings.append(f"${item['var']} is also written from {_sname}.{axis}: those "
                                "rows add to it (one rule per axis, so both fire)")
            rules.append(rule)
        others = sorted({r["otherwise"] for r in rels
                         if r.get("otherwise") and r["otherwise"] != otherwise})
        if others:
            warnings.append(f"${item['var']} has one \"otherwise\": kept \"{otherwise}\", not "
                            + ", ".join(f'"{o}"' for o in others))
        return {"kind": kind, "payload": {"rules": rules},
                "preview": [_slot_rel_words(r) for r in rels], "warnings": warnings}
    if kind == "template":
        t = graph["template"]
        order = template_order(graph, plan.get("settings"))
        body = ", ".join(x for x in [t["lead"], *(f"${v}" for v in order), t["tail"]] if x)
        # Negatives "none": the planner was told to leave it empty; a 9B
        # writes one anyway.
        negative = "" if parse_settings(plan.get("settings"))["negatives"] == "none" \
            else t["negative"] or ""
        return {"kind": kind, "payload": {"template_string": body,
                                         "negative_template": negative},
                "preview": [body], "warnings": []}
    raise PlanError(f"{item['name']} isn't wired by the graph")


def axis_payload(graph: dict[str, Any], slot: dict[str, Any]) -> dict[str, Any]:
    """The wildcard of a self-axis slot: one option per axis value, tagged
    with it, no model call. ``{payload, preview, warnings}``."""
    from engine.ai import wildcard as ai_wildcard

    axis = next(a for a in slot["axes"] if a["name"] == slot["self_axis"])
    taken: set[str] = set()
    rows = [{"id": ai_wildcard.new_option_id(taken), "value": v.replace("_", " "),
             "weight": 1, "sub_categories": [v]} for v in axis["values"]]
    payload, warnings = _finish_rows(graph, slot, rows, taken)
    return {"payload": payload, "preview": [ai_wildcard.option_line(r) for r in
                                            payload["options"]], "warnings": warnings}


def _finish_rows(graph: dict[str, Any], slot: dict[str, Any], rows: list[dict[str, Any]],
                 taken: set[str]) -> tuple[dict[str, Any], list[str]]:
    """The payload of a slot from its option rows: the fallback a narrowed
    slot needs (never an option a rule excludes), the null option of
    ``sometimes_none``, tag groups from the axes, and the warnings about
    axis values and rule words no option carries."""
    from engine.ai import wildcard as ai_wildcard
    from engine.modules.wildcard_handler import WildcardHandler

    kinds = axis_kinds(graph, slot)
    values = {a["name"]: a["values"] for a in slot["axes"]}
    warnings: list[str] = []
    for value, factor in (slot.get("weights") or {}).items():
        for r in rows:
            if value in r["sub_categories"] and not r.get("is_null"):
                r["weight"] = round(float(r.get("weight") or 1) * factor, 2)
    narrowed = inbound(graph, slot)
    if narrowed and rows:
        # The option that fits the most of what narrows this slot, and
        # nothing excludes, stands in when a rule leaves nothing: it is
        # never empty, and never the one a rule said no to.
        wanted = {r["to"]["value"] for r in narrowed if r["kind"] in ("only", "boost")
                  if r["to"].get("value")}
        wanted |= {v for r in narrowed if r["kind"] in ("agree", "accepts")
                   for v in r.get("values") or []}
        banned = {r["to"]["value"] for r in narrowed if r["kind"] in ("exclude", "reduce")
                  if r["to"].get("value")}
        best = max(rows, key=lambda r: (
            sum(1 for t in r["sub_categories"] if t in wanted)
            - 2 * sum(1 for t in r["sub_categories"] if t in banned),
            float(r.get("weight") or 0)))
        best["fallback"] = True
    if slot["sometimes_none"]:
        total = sum(float(r["weight"]) for r in rows) or 1.0
        share = slot["sometimes_none"] / 100
        rows.append({"id": ai_wildcard.new_option_id(taken), "value": "", "is_null": True,
                     "weight": round(total * share / (1 - share), 2), "sub_categories": []})
    used = {t for r in rows for t in r["sub_categories"]}
    payload: dict[str, Any] = {
        "var_binding": slot["var"],
        "options": rows,
        "sub_categories": [v for vs in values.values() for v in vs if v in used],
    }
    groups = {a: [v for v in vs if v in used] for a, vs in values.items()}
    groups = {a: vs for a, vs in groups.items() if vs}
    if groups:
        payload["tag_groups"] = groups
        payload["tag_group_kinds"] = {a: kinds[a] for a in groups}
    for axis, allowed in values.items():
        gone = [v for v in allowed if v not in used]
        if gone:
            warnings.append(f"No option is {', '.join(gone)} on {axis}")
    for value, axis, word in rule_words(graph, slot):
        if not any(not r.get("is_null") and value in r["sub_categories"]
                   and _has_word(_norm(r["value"]), word) for r in rows):
            warnings.append(f"No option mentions {word} tagged {value} on {axis}")
    WildcardHandler.validate_payload(payload)
    return payload, warnings


def rule_words(graph: dict[str, Any], slot: dict[str, Any]) -> list[tuple[str, str, str]]:
    """``(value, axis, word)`` for every word a relation on this slot is
    about: an option saying that word must carry that value."""
    out: list[tuple[str, str, str]] = []
    for r in inbound(graph, slot):
        if r["kind"] not in ("exclude", "only", "boost", "reduce"):
            continue
        for w in r.get("words") or []:
            t = (r["to"]["value"], r["to"]["axis"], w)
            if t not in out:
                out.append(t)
    return out


# --- the per-slot content call ----------------------------------------------

def slot_schema(graph: dict[str, Any], slot: dict[str, Any],
                fill: dict[str, list[str]] | None = None) -> dict[str, Any]:
    """The JSON schema of one slot's options: ``text``, ``weight``,
    ``negative`` and a ``tags`` object with one key per axis, each an enum
    of that axis's values (a list of them on a classify axis, one on an
    accepts axis). With ``fill`` (``{axis: [values]}``) it is a fill call's
    schema: an ``add`` list whose options can only carry those values on
    that axis, so every new option plugs a gap."""
    kinds = axis_kinds(graph, slot)
    tag_props: dict[str, Any] = {}
    for a in slot["axes"]:
        allowed = (fill or {}).get(a["name"]) or list(a["values"])
        enum = {"type": "string", "enum": list(allowed)}
        if kinds[a["name"]] == "accepts" and not any(
                r["kind"] == "accepts" and r["from"]["slot"] == slot["name"]
                and r["from"]["axis"] == a["name"] for r in graph["relations"]):
            tag_props[a["name"]] = enum
        else:
            tag_props[a["name"]] = {"type": "array", "items": enum, "minItems": 1}
    option = _obj({"text": _STR, "weight": {"type": "number"}, "negative": _STR,
                   "tags": _obj(tag_props)})
    return _obj({("add" if fill else "options"): {"type": "array", "items": option}})


def fill_gaps(graph: dict[str, Any], slot: dict[str, Any],
              payload: dict[str, Any] | None) -> dict[str, list[str]]:
    """The axis values no option of ``payload`` carries: ``{axis: [values]}``,
    only the axes with a gap. A relation that names such a value would
    match nothing, so the fill call (``slot_request`` with ``built``) asks
    for options tagged with them."""
    if not isinstance(payload, dict):
        return {}
    used = {t for o in payload.get("options") or [] if isinstance(o, dict)
            and not o.get("is_null") for t in o.get("sub_categories") or []}
    out: dict[str, list[str]] = {}
    for a in slot["axes"]:
        gone = [v for v in a["values"] if v not in used]
        if gone:
            out[a["name"]] = gone
    return out


_COVERAGE = re.compile(r"^No option (is|mentions) ")


def fill_targets(graph: dict[str, Any], slot: dict[str, Any],
                 payload: dict[str, Any] | None) -> dict[str, dict[str, list[str]]]:
    """What a fill call must add: ``{axis: {value: [words]}}``, the values
    no option carries (``fill_gaps``, words ``[]``) and the rule words no
    option tagged with their value says."""
    out: dict[str, dict[str, list[str]]] = {}
    for axis, gone in fill_gaps(graph, slot, payload).items():
        out[axis] = {v: [] for v in gone}
    if not isinstance(payload, dict):
        return out
    rows = [o for o in payload.get("options") or [] if isinstance(o, dict)
            and not o.get("is_null") and isinstance(o.get("value"), str)]
    for value, axis, word in rule_words(graph, slot):
        if not any(value in (r.get("sub_categories") or []) and _has_word(_norm(r["value"]), word)
                   for r in rows):
            out.setdefault(axis, {}).setdefault(value, []).append(word)
    return out


def _coverage_only(note: str) -> bool:
    """Whether a repair note asks for nothing but axis coverage."""
    parts = [x.strip() for x in note.split(";") if x.strip()]
    return bool(parts) and all(_COVERAGE.match(x) for x in parts)


def coverage_split(note: str) -> tuple[list[str], list[str]]:
    """A repair note's parts: the ones asking for axis coverage (a value
    or rule word no option carries) and the rest. Coverage is what a fill
    call adds; the rest rides along as what the new options must mind."""
    parts = [x.strip() for x in (note or "").split(";") if x.strip()]
    return ([x for x in parts if _COVERAGE.match(x)],
            [x for x in parts if not _COVERAGE.match(x)])


def fills(plan: dict[str, Any], key: str, note: str) -> bool:
    """Whether a repair note on a built graph slot would be a fill call
    (``slot_request``): the route tells the browser, which then gives a
    rebuilt slot one fill when coverage is still missing."""
    return slot_for(plan, key) is not None and bool(coverage_split(note)[0])


def _norm(text: Any) -> str:
    return " ".join(str(text or "").split()).lower()


#: A rebuild note about scope: this slot names what another slot picks.
_SCOPE_NOTE = re.compile(r"already name what|names what|leave th(?:ose|at) to", re.I)
#: The most of another slot's words one rebuild is shown.
MAX_CLASH_WORDS = 12


def clash_words(plan: dict[str, Any], built: dict[str, Any], key: str) -> dict[str, list[str]]:
    """For a slot being rebuilt over scope: the words of every other built
    slot that talks about the same things (the same words, or a head noun
    this slot's options share: "eyes", "skin"), by slot name, at most
    ``MAX_CLASH_WORDS`` each. The rebuild is told all of them at once; told
    only the words of the problem it fixes, a rebuild of Body picked up
    Race's "freckles" right after Race gave up Body's "eyes" (Sonnet rules
    pack, 2026-10-21: two rounds of ping-pong before it settled)."""
    own = built.get(key)
    if not isinstance(own, dict):
        return {}
    mine = {c.strip() for o in own["payload"].get("options") or [] if isinstance(o, dict)
            for c in _norm(o.get("value")).split(",") if c.strip()}
    heads = {c.split()[-1] for c in mine}
    out: dict[str, list[str]] = {}
    for name, texts in other_texts(plan, built, key).items():
        chunks = list(dict.fromkeys(c.strip() for t in texts for c in t.split(",") if c.strip()))
        shared = [c for c in chunks if c in mine or c.split()[-1] in heads]
        if shared:
            out[name] = shared[:MAX_CLASH_WORDS]
    return out


def other_texts(plan: dict[str, Any], built: dict[str, Any], key: str) -> dict[str, list[str]]:
    """The option texts of every other built slot, by slot name: what a
    slot's options must not repeat (``compile_slot``'s ``others``)."""
    graph = plan.get("graph")
    if not isinstance(graph, dict):
        return {}
    out: dict[str, list[str]] = {}
    for i in plan["items"]:
        if i["key"] == key or i["kind"] != "wildcard" or i["key"] not in built:
            continue
        slot = _slot_of(graph, i)
        if slot is None or slot.get("self_axis"):
            continue
        out[slot["name"]] = [_norm(o.get("value")) for o in
                             built[i["key"]]["payload"].get("options") or []
                             if isinstance(o, dict) and _norm(o.get("value"))]
    return out


def scope_notes(rows: list[dict[str, Any]], others: dict[str, list[str]]
                ) -> tuple[list[dict[str, Any]], list[str]]:
    """Scope bleed, checked by code: an option that IS one of another
    slot's options is left out (that slot owns it); an option that names
    one of them inside its text ("red dress" next to a Colours slot with
    "red") is kept with a warning the rebuild is told. Returns ``(rows,
    warnings)``."""
    if not others:
        return rows, []
    owned = {t: name for name, texts in others.items() for t in texts}
    chunks = {name: sorted({c for t in texts for c in t.split(",")
                            if len(c.strip()) >= 4}, key=len, reverse=True)
              for name, texts in others.items()}
    kept: list[dict[str, Any]] = []
    warnings: list[str] = []
    for r in rows:
        text = _norm(r.get("value"))
        if r.get("is_null") or not text:
            kept.append(r)
            continue
        if text in owned:
            warnings.append(f"Left out \"{text[:40]}\": {owned[text]} already has it")
            continue
        hit = next(((name, c.strip()) for name, cs in chunks.items() for c in cs
                    if re.search(r"(?<!\w)" + re.escape(c.strip()) + r"(?!\w)", text)), None)
        if hit is not None:
            warnings.append(f"\"{text[:40]}\" names what {hit[0]} picks (\"{hit[1]}\"); "
                            f"leave that to {hit[0]}")
        kept.append(r)
    return kept, warnings


def compile_slot(
    graph: dict[str, Any], slot: dict[str, Any], answer: Any, *, limit: int | None = None,
    existing: dict[str, Any] | None = None, others: dict[str, list[str]] | None = None,
    refs: dict[str, str] | None = None,
) -> dict[str, Any]:
    """The model's options for one slot as a wildcard payload: tags from the
    ``tags`` object (every axis value an option names), tag groups from the
    slot's axes, a fallback chosen by code on a narrowed slot, the
    ``sometimes_none`` share as a null option, and the ``@{list:tag}``
    pick a ``draw`` relation puts in front of every option (``refs``:
    slot name → built id, ``draw_refs``). A fill answer (``add``
    instead of ``options``) is merged into ``existing``, keeping its
    options and ids. ``others`` (``other_texts``) is what the other slots
    hold, for the scope check. Returns ``{payload, preview, warnings}``.
    Raises ValueError when no option is usable."""
    from engine.ai import wildcard as ai_wildcard

    if not isinstance(answer, dict):
        raise ValueError("the model's answer wasn't a list of options")
    adding = isinstance(answer.get("add"), list) and not isinstance(answer.get("options"), list)
    if adding and not (isinstance(existing, dict) and existing.get("options")):
        answer, adding = {**answer, "options": answer["add"]}, False
    if not adding and not isinstance(answer.get("options"), list):
        raise ValueError("the model's answer wasn't a list of options")
    kinds = axis_kinds(graph, slot)
    values = {a["name"]: a["values"] for a in slot["axes"]}
    warnings: list[str] = []
    raw_options = []
    for o in answer["add" if adding else "options"]:
        if not isinstance(o, dict):
            continue
        tags: list[str] = []
        picked = _got if isinstance(_got := o.get("tags"), dict) else {}
        missing = []
        for axis, allowed in values.items():
            got = picked.get(axis)
            got = got if isinstance(got, list) else [got] if isinstance(got, str) else []
            hit = [_tag(g) for g in got if _tag(g) in allowed]
            if kinds[axis] == "accepts" and len(hit) > 1 and not any(
                    r["kind"] in ("accepts", "agree") and r["from"]["slot"] == slot["name"]
                    and r["from"]["axis"] == axis for r in graph["relations"]):
                hit = hit[:1]
            if not hit:
                missing.append(axis)
            tags += [h for h in hit if h not in tags]
        if missing:
            warnings.append(f"Left out \"{_clean(o.get('text'), 40)}\": no {', '.join(missing)}"
                            " value")
            continue
        raw_options.append({"text": o.get("text"), "weight": o.get("weight", 1),
                            "tags": tags, "negative": o.get("negative") or ""})
    # A fill keeps what is there: its options stay, ids and all, and the
    # new ones join them (the null option and the fallback are redone).
    kept: list[dict[str, Any]] = []
    if adding and existing is not None:
        for o in existing["options"]:
            if isinstance(o, dict) and isinstance(o.get("value"), str) and not o.get("is_null"):
                kept.append({k: v for k, v in o.items() if k != "fallback"})
    compiled = ai_wildcard.compile_options(
        {"options": raw_options},
        existing_payload={"options": kept, "sub_categories": [v for vs in values.values()
                                                             for v in vs]},
        limit=len(raw_options) if adding else limit or slot["count"],
    )
    options = compiled["options"]
    if not options and not kept:
        raise ValueError("no usable options" + "".join(
            f"; {s['text'][:40]}: {s['reason']}" for s in compiled["skipped"][:3]))
    taken: set[str] = {o["id"] for o in kept}
    rows: list[dict[str, Any]] = []
    for o in options:
        row: dict[str, Any] = {"id": ai_wildcard.new_option_id(taken), "value": o["value"],
                               "weight": o["weight"], "sub_categories": o["tags"]}
        if o["negative"]:
            row["negative"] = o["negative"]
        rows.append(row)
    rows, scoped = scope_notes(rows, others or {})
    warnings += scoped
    if not rows and not kept:
        raise ValueError("every option names what another slot picks: " + "; ".join(scoped[:3]))
    warnings += _draw_prefix(graph, slot, rows, refs or {})
    rows = [*kept, *rows]
    payload, more = _finish_rows(graph, slot, rows, taken)
    warnings += more
    warnings += [f"Left out {s['text'][:60]}: {s['reason']}" for s in compiled["skipped"][:8]]
    return {"payload": payload,
            "preview": [ai_wildcard.option_line(r) for r in payload["options"]],
            "warnings": warnings}


def _draw_prefix(graph: dict[str, Any], slot: dict[str, Any], rows: list[dict[str, Any]],
                 refs: dict[str, str]) -> list[str]:
    """The ``@{id:tag}`` pick of every ``draw`` relation on this slot, put
    in front of each option's text (once: a fill's kept options already
    carry theirs). A source not built yet is a warning."""
    warnings: list[str] = []
    for r in draw_sources(graph, slot):
        sid = refs.get(r["from"]["slot"])
        if not sid:
            warnings.append(f"{r['from']['slot']} isn't built yet, so its pick isn't in "
                            f"front of {slot['name']}'s options")
            continue
        ref = "@{" + sid + (":" + r["from"]["value"] if r["from"]["value"] else "") + "}"
        for row in rows:
            if row.get("is_null") or not isinstance(row.get("value"), str):
                continue
            if ref in row["value"]:
                continue
            row["value"] = f"{ref} {row['value']}".strip()
    return warnings


def slot_prompt(graph: dict[str, Any], slot: dict[str, Any], *, note: str = "") -> str:
    """The user prompt of one slot's content call."""
    others = [s["name"] for s in graph["slots"] if s is not slot]
    lines = [f"Write {slot['count']} options for the wildcard \"{slot['name']}\" of the pack "
             f"\"{graph['title']}\" ({graph['summary'] or 'no summary'}).",
             f"What it holds: {slot['what'] or slot['name']}.",
             f"Style: {'short comma tags' if graph['style'] == 'tags' else 'short sentences'}; "
             f"rating: {graph['rating']}."]
    for a in slot["axes"]:
        lines.append(f"Tag every option on {a['name']} with "
                     + ("the one value" if axis_kinds(graph, slot)[a["name"]] == "accepts"
                        else "every value") + f" that fits: {', '.join(a['values'])}.")
    if others:
        lines.append("Other wildcards cover " + ", ".join(others[:12])
                     + ": keep those words out of these options.")
    for r in inbound(graph, slot):
        lines.append("Rule on it: " + _slot_rel_words(r) + ".")
    for r in draw_sources(graph, slot):
        src = next((s for s in graph["slots"] if s["name"] == r["from"]["slot"]), None)
        what = (src["what"] if src and src["what"] else r["from"]["slot"]).rstrip(".")
        lines.append(f"The code puts a fresh pick from {r['from']['slot']}"
                     + (f" ({r['from']['value']})" if r["from"]["value"] else "")
                     + f" in front of every option, so write no {what.lower()} in them.")
    by_value: dict[tuple[str, str], list[str]] = {}
    for value, axis, word in rule_words(graph, slot):
        by_value.setdefault((value, axis), []).append(word)
    for (value, axis), ws in by_value.items():
        lines.append(f"Include options that mention {', '.join(ws)}, tagged {value} on {axis}: "
                     "a rule is about them.")
    if note.strip():
        lines.append(f"The last version had these problems; fix them: {note.strip()}")
    return "\n".join(lines)


# --- relations checked on engine runs ----------------------------------------

#: A ``@{…}`` reference inside an option (what a ``draw`` puts in front).
_REF = re.compile(r"@\{[^}]*\}\s*")


def _otherwise(rels: list[dict[str, Any]]) -> str:
    """The one ``else`` a variable's derive rows compile to: the first
    given (a rule has one else, however many rows name one)."""
    return next((r["otherwise"] for r in rels if r.get("otherwise")), "")


def _picked_tags(graph: dict[str, Any], payloads: dict[str, dict[str, Any]], slot_name: str,
                 ctx: dict[str, Any]) -> tuple[set[str], bool] | None:
    """The tags the run's pick for a slot carries, and whether that pick
    was the fallback option. None when the slot isn't built; an empty set
    when it picked nothing (a null option)."""
    slot = next(s for s in graph["slots"] if s["name"] == slot_name)
    payload = payloads.get(slot_name)
    if payload is None:
        return None
    value = _norm(ctx.get(slot["var"]))
    if not value:
        return set(), False
    chunks = {c.strip() for c in value.split(",")}
    tags: set[str] = set()
    fallback = False
    for o in payload.get("options") or []:
        if not isinstance(o, dict) or o.get("is_null"):
            continue
        text = _norm(_REF.sub("", str(o.get("value") or "")))
        if text and (text == value or text in chunks
                     or re.search(r"(?<!\w)" + re.escape(text) + r"(?!\w)", value)):
            tags |= set(o.get("sub_categories") or [])
            fallback = fallback or o.get("fallback") is True
    kinds = axis_kinds(graph, slot)
    for a in slot["axes"]:
        got = ctx.get(f"{slot['var']}.{a['name']}")
        if isinstance(got, str) and got:
            if kinds.get(a["name"]) == "accepts":
                # The option offered alternatives; this run rolled one.
                tags -= set(a["values"])
            tags.add(got)
    return tags, fallback


def _drawn_tags(graph: dict[str, Any], payloads: dict[str, dict[str, Any]], list_name: str,
                ctx: dict[str, Any]) -> list[set[str]]:
    """The tags of each pick a ``draw`` put in front of a drawer's text
    this run (the list's option the drawer's value starts with), one set
    per drawer that drew. A rule on the list must hold for these too: they
    are what the prompt shows."""
    payload = payloads.get(list_name)
    if payload is None:
        return []
    options = sorted(((_norm(str(o.get("value") or "")), set(o.get("sub_categories") or []))
                      for o in payload.get("options") or []
                      if isinstance(o, dict) and not o.get("is_null") and o.get("value")),
                     key=lambda x: -len(x[0]))
    out: list[set[str]] = []
    for r in graph["relations"]:
        if r["kind"] != "draw" or r["from"]["slot"] != list_name:
            continue
        drawer = next((s for s in graph["slots"] if s["name"] == (r.get("to") or {}).get("slot")),
                      None)
        value = _norm(ctx.get(drawer["var"])) if drawer else ""
        hit = next((tags for text, tags in options if text and (
            value == text or value.startswith(text + " "))), None)
        if hit is not None:
            out.append(hit)
    return out


def verify_relations(plan: dict[str, Any], built: dict[str, Any],
                     runs: list[dict[str, Any]],
                     rendered: list[str] | None = None) -> list[dict[str, Any]]:
    """Every relation of a graph plan checked against engine runs (the
    contexts ``PipelineEngine.run`` returned): ``[{text, kind, checked,
    seen, broken, holds}]``. ``exclude`` must never co-occur, ``only``
    rows must leave the target in the row (or on its fallback), ``agree``
    / ``accepts`` must share a value (or fall back), ``derive`` /
    ``append`` must write their text when their value fires and the
    ``otherwise`` when none does. With ``rendered`` (the prompt of each
    run), an ``exclude`` with ``words`` also fails when a word shows in a
    prompt its source value fired in. A relation that never fired in the
    runs doesn't hold either (``why`` says so): a rule about things no
    option has is no rule. ``boost`` / ``reduce`` are odds, not rules, so
    they are not checked; nor is a relation whose slots aren't built."""
    graph = plan.get("graph")
    if not isinstance(graph, dict) or not runs:
        return []
    payloads: dict[str, dict[str, Any]] = {}
    for i in plan["items"]:
        if i["kind"] == "wildcard" and i["key"] in built:
            slot = _slot_of(graph, i)
            if slot is not None:
                payloads[slot["name"]] = built[i["key"]]["payload"]
    only_rows: dict[tuple[str, str, str], set[str]] = {}
    for r in graph["relations"]:
        if r["kind"] == "only":
            only_rows.setdefault((r["from"]["slot"], r["from"]["value"], r["to"]["slot"]),
                                 set()).add(r["to"]["value"])
    by_var: dict[str, list[dict[str, Any]]] = {}
    for r in graph["relations"]:
        if r["kind"] == "derive":
            by_var.setdefault(r["var"], []).append(r)
    out: list[dict[str, Any]] = []
    for r in graph["relations"]:
        kind, src, dst = r["kind"], r["from"], r.get("to") or {}
        row = {"text": _slot_rel_words(r), "kind": kind,
               "checked": kind not in _WEIGHTED and kind != "draw",
               "seen": 0, "broken": 0, "holds": True, "why": ""}
        out.append(row)
        if not row["checked"]:
            continue
        words = r.get("words") or [] if kind == "exclude" else []
        # "casual" in the words of "casual never gets heels" is the source,
        # not a forbidden thing: it showed in every casual prompt, so the rule
        # counted broken in 27 of 27 runs (9B smoke, 2026-10-24).
        src_slot = next((s for s in graph["slots"] if s["name"] == src["slot"]), None)
        src_vals = {v.lower() for a in (src_slot or {}).get("axes") or [] for v in a["values"]}
        words = [w for w in words if w.lower() not in src_vals]
        for n, ctx in enumerate(runs):
            got_src = _picked_tags(graph, payloads, src["slot"], ctx)
            if got_src is None:
                row["checked"] = False
                break
            st, _ = got_src
            if kind in ("exclude", "only"):
                if src["value"] not in st:
                    continue
                got_dst = _picked_tags(graph, payloads, dst["slot"], ctx)
                if got_dst is None:
                    row["checked"] = False
                    break
                dt, fell = got_dst
                prompt = rendered[n] if rendered and n < len(rendered) else ""
                own = str(ctx.get(src_slot["var"]) or "").lower() if src_slot else ""
                said = [w for w in words if _has_word(prompt, w)
                        and not _has_word(own, w)] if prompt else []
                nested = _drawn_tags(graph, payloads, dst["slot"], ctx)
                if not dt and not said and not nested:
                    continue
                row["seen"] += 1
                allowed = only_rows.get((src["slot"], src["value"], dst["slot"]), set())
                if kind == "exclude" and not fell and (dst["value"] in dt or said):
                    row["broken"] += 1
                elif kind == "only" and not fell and dt and not (dt & allowed):
                    row["broken"] += 1
                elif kind == "exclude" and any(dst["value"] in t for t in nested):
                    row["broken"] += 1
                elif kind == "only" and any(t and not (t & allowed) for t in nested):
                    row["broken"] += 1
            elif kind in ("agree", "accepts"):
                got_dst = _picked_tags(graph, payloads, dst["slot"], ctx)
                if got_dst is None:
                    row["checked"] = False
                    break
                dt, fell = got_dst
                shared = set(r["values"])
                nested = [t & shared for t in _drawn_tags(graph, payloads, dst["slot"], ctx)]
                if not (st & shared) or not (dt or any(nested)):
                    continue
                row["seen"] += 1
                if (dt and not (st & dt & shared) and not fell) \
                        or any(t and not (st & t) for t in nested):
                    row["broken"] += 1
            else:
                got = _norm(ctx.get(r["var"]))
                if src["value"] in st:
                    row["seen"] += 1
                    if _norm(r["text"]) not in got:
                        row["broken"] += 1
                elif kind == "derive" and _otherwise(by_var[r["var"]]):
                    fired = False
                    for d in by_var[r["var"]]:
                        t = _picked_tags(graph, payloads, d["from"]["slot"], ctx)
                        fired = fired or bool(t and d["from"]["value"] in t[0])
                    if not fired:
                        row["seen"] += 1
                        if _norm(_otherwise(by_var[r["var"]])) not in got:
                            row["broken"] += 1
        if row["checked"] and row["seen"] == 0:
            row["why"] = f"never fired in {len(runs)} runs"
        row["holds"] = row["checked"] and row["broken"] == 0 and row["seen"] > 0
    return out


# --- the planner call -------------------------------------------------------

GRAPH_BLUEPRINTS = """\
Worked examples (shapes to adapt, never a menu to pick from; the request \
decides what the slots are):
1. "Fantasy heroes; elves never use guns; mages get a title": slots Race \
(axis kind: elf, dwarf, human), Class (axis role: caster, martial), Weapon \
(axis type: gun, blade, staff), Outfit, Setting; relations exclude \
Race.kind=elf → Weapon.type=gun; only Class.role=caster → Weapon.type=staff; \
derive $title "Archmage" when Class.role=caster, otherwise "Adventurer"; \
template order Quality, title, Race, Class, Outfit, Weapon, Setting.
2. "Outfits by season; never sandals or shorts in winter, never a parka in \
summer": slot Season (internal, axis season: winter, spring, summer, \
autumn; its options are those values), Outfit (axis season with the same \
values; an outfit lists every season it fits), Footwear (axis season), \
Weather (axis season); relations agree on season Season → Outfit and \
Season → Weather; exclude Season.season=winter → Footwear.season=summer with \
words ["sandals"]; exclude Season.season=winter → Outfit.season=summer, \
words ["shorts"]; exclude Season.season=summer → Outfit.season=winter, words \
["parka"]; append ", scarf" to $outfit when Season.season=winter.
3. "Shoes that match the outfit": Outfit (axis shoes: sneakers, boots, \
heels, loafers: what each outfit goes with), Shoes (axis shoes, the same \
values: what each pair is); relation accepts Outfit → Shoes on shoes.
4. "A 4-frame story of one hero": run {mode: story, frames: 4}; Hero and \
Outfit with hold true; a Beat slot of 4 options read per frame is planned \
by the code from the run, so leave $beat out.
5. "The user types the subject": inputs [{var: subject, about: who, \
example: "a red-haired knight"}]; no Subject slot; template order starts \
with subject.
6. "A scarf, a hat and mittens, each in a warm colour from one shared colour \
list": slot Colours (axis warmth: warm, cool; its options are colours), \
Scarf, Hat, Mittens; relations draw Colours.warmth=warm → Scarf, draw \
Colours.warmth=warm → Hat, draw Colours.warmth=warm → Mittens; order Scarf, \
Hat, Mittens (Colours is the list, not a pick of its own).
7. "An anime style preset with quality tags and its own negatives, for Pony \
and Flux": model "pony, flux"; fixed [{name: Anime preset, var: preset, \
text: "anime screencap, clean lineart, flat colors", negative: "photo, \
realistic, 3d render"}]; order starts with preset.
"""

GRAPH_SYSTEM = """\
You plan prompt packs for Wildcard Pipeline, a ComfyUI extension that builds \
image-generation prompts from modules that run in order on a WP Context node \
and set $variables; a WP Prompt Assembler renders a template from them. You \
write the pack as a graph; the code wires it. Decide WHAT: which slots, what \
they vary on, what depends on what, the prompt order. Never write option \
text, tags on options, rule syntax or the template string: the code and a \
later call per slot do that.

Answer with:
- title (short pack name), summary (one sentence), design (2-4 sentences on \
how the pack fits together: which pick decides which, and why each relation \
is there).
- rating: "nsfw" if sexual or explicit, else "safe". style: "tags" \
(comma-separated Danbooru-style tags: Pony, Illustrious, NoobAI) or \
"sentences" (short natural phrases: Flux, SD3, Qwen-Image); follow the \
settings, else the request, else "tags". model: the image model family or \
families the request names ("pony", "pony, flux"; two families get a \
per-family quality rule from the code) or "". anchor: the slot variable the \
others follow (setting, class, season), or "".
- questions: up to 4 things you can't guess that would change the pack \
(header 1-3 words; 2-5 short choices; multi true when several apply \
together). Never re-ask a question listed under "Decided". [] when nothing \
important is open. Write the full graph anyway with the likeliest answers.
- assumptions (up to 6 short lines on what you guessed), from_images (up to \
4 lines on what you took from attached images, else []), research (up to 2 \
web queries when web search is on and facts would help, else []).
- run: {mode: "single", frames: 0} for one image per run; {mode: "story", \
frames: 2-12} for a story or sequence a WP Context Loop plays frame by \
frame (the code adds the story beat per frame, so plan no beat slot and \
no $iteration rule; mark what stays the same with hold); {mode: "sweep", \
frames: 0} for a sheet comparing options (the code holds everything but \
the sweep slots).
- inputs: what comes from outside at run time (a subject the user types, a \
LoRA): {var, about, example}. A named fixed subject or "whatever I give it" \
is an input and gets no slot; a LoRA is an input named <slot>_lora. [] when \
the pack makes everything itself.
- sections: the pack's parts ({name, about}), each a sub-bundle; [] for a \
small pack. Every slot names its section or "".
- slots: one per choice the image makes (setting, character, outfit, pose, \
lighting, …), up to 24. Each: name; var (its variable, letters digits _); \
what (what its options are, one concept only: poses hold poses, not hair); \
section; count (options to write, 4-40); show "prompt" (read by the \
template) or "internal" (a driver rules need but the prompt shouldn't say: \
a season, a mood, a rating); pick "" for one pick, "2" or "2-3" for several \
("2 to 3 accessories" is pick "2-3" on Accessories); \
hold true when the pick must stay the same for a whole batch or story; \
sweep true on the 2 or 3 short slots a sweep sheet compares (run mode \
sweep only); sometimes_none 0, or the percent of runs that get nothing (a hat 30% of the \
time); axes: the ways its options are sorted that a relation or another \
slot needs, each {name (a lowercase word), values (2-12 lowercase words)}. \
An axis exists only for a relation: no relation, no axis. Two slots that \
must agree share an axis NAME and VALUES (Season.season and Outfit.season: \
winter, summer). Values are tags, so keep them single words. A slot whose \
only axis is itself (a Season slot with axis season) gets its options from \
the axis values by the code, no option call: its options ARE winter, spring, \
summer, autumn, never outfits.
- fixed: variables set to the same text every run ({name, var, text, \
negative}): quality tags, a style preset. negative is what that preset keeps \
out of the image (its own negative words), "" when it has none. Up to 6.
- relations, each with every field ("" / 0 where unused):
  - exclude / only / boost / reduce: from_slot.from_axis = from_value → \
to_slot.to_axis = to_value, with factor for boost (>1) and reduce (<1). \
"never" is exclude; "just these" / "goes with" is only. "X only in Y" \
restricts X, so X is the source: "snow only in cold biomes" is only \
Weather.kind=snow → Biome.climate=cold (the code picks the source first), \
never only Biome.climate=cold → Weather.kind=snow, which would make every \
cold biome snow.
  - agree: from_slot and to_slot share an axis (from_axis): the target's \
pick carries the source's value (shoes for the outfit, outfit for the \
season). The code adds a fallback so the target is never empty.
  - accepts: like agree, but the source's options each LIST the values they \
go with (an outfit: sneakers, boots) while the target's options ARE one \
value each.
  - derive: var (a NEW variable), text (what it becomes) when \
from_slot.from_axis = from_value; otherwise (text for every other pick, or \
"" to leave it unset). Several derive rows on one var are its cases.
  - append: text added to var (a slot's or a derived variable) when \
from_slot.from_axis = from_value.
  - draw: every option of to_slot starts with a fresh pick from from_slot, a \
shared list (colours, materials, names), narrowed to from_axis = from_value \
when given ("each in a warm colour from one colour list": draw Colours.warmth\
=warm → Scarf, and the same for Hat and Mittens). The list slot's options are \
the things drawn; the target's options then say nothing of them.
  Every relation also has words: the things it is about as an option would \
say them, taken from the request ("sandals", "shorts" for "no sandals or \
shorts in winter"; "parka"), up to 6, or [] when it is about a whole axis \
value. The code makes the target slot hold options saying those words, \
tagged with to_value, and checks the finished prompts for them.
  Every slot, axis and value a relation names must be declared on the slot \
it names: a relation that names something else is dropped.
- template: lead (always-first words, never a slot name: for tag models the \
count the request implies, "1girl, solo" for one woman, "1boy, 1girl" for a \
couple, "solo" only with one person; or ""), order (slot names, fixed names, \
derived variables and inputs in the order the image model should read them: \
subject and quality first, then character, outfit, pose, setting, lighting, \
style; internal slots never), tail (always-last words or ""), negative (the \
standing negative prompt in the pack's style: usual defects only, which never \
go in the lead or tail; "" for none). A rule ("no sandals in winter") is \
never a negative: it is a relation.

Plan what the request needs. Don't add commentary; the output is data.

A pack rated nsfw is for adults only: every character is an adult, and no \
child or real-person subject is ever planned. A costume or role the user \
asks for (a school uniform, a maid) is worn by an adult.

""" + GRAPH_BLUEPRINTS

SLOT_SYSTEM = """\
You write the options of one wildcard in a prompt pack for Wildcard Pipeline \
(image-generation prompts). Answer with options, each {text, weight, \
negative, tags}: text is the option as it appears in the prompt (short, in \
the pack's style, one concept, no quotes, no $variables, no braces); weight \
is 1 for usual, 2-3 for common, 0.5 for rare; negative is what to keep out \
of the image when this option is picked ("" when nothing); tags gives, for \
every axis named, the value(s) that fit this option, from that axis's own \
values only. Spread the options over the axis values so no value is left \
without options. Never list another slot's words (hair in an outfit, a \
pose in a setting). Vary the options; no two should mean the same thing.\
"""


def slot_request(plan: dict[str, Any], key: str, note: str = "",
                 built: dict[str, Any] | None = None) -> dict[str, Any]:
    """``{system, user, schema, schema_name, temperature}`` of one slot's
    content call. When the note asks for nothing but axis coverage and the
    slot is built (``built``), it is a FILL call: the model adds options
    tagged with the missing values and the rest stays as it is."""
    slot = slot_for(plan, key)
    if slot is None:
        raise PlanError(f"{key} isn't a slot")
    from engine.ai import guide as ai_guide
    graph = plan["graph"]
    old = (built or {}).get(key)
    coverage, rest = coverage_split(note)
    # A coverage part makes it a fill whatever else the note says: a
    # value no option carries breaks every rule on it, so the options
    # that are there stay and the new ones mind the rest of the note.
    targets = fill_targets(graph, slot, old["payload"]) if isinstance(old, dict) \
        and coverage else {}
    if targets:
        axis = max(targets, key=lambda a: len(targets[a]))
        user = fill_prompt(graph, slot, old["payload"], targets, axis, also=rest)
        schema = slot_schema(graph, slot, fill={axis: list(targets[axis])})
        name = "pack_slot_fill"
    else:
        user = slot_prompt(graph, slot, note=note)
        if _SCOPE_NOTE.search(note or "") and built:
            for other, words in clash_words(plan, built, key).items():
                user += "\n" + (f"{other} already says: {', '.join(words)}. Keep every one of "
                                f"these out of these options; they are {other}'s.")
        schema = slot_schema(graph, slot)
        name = "pack_slot"
    for r in draw_sources(graph, slot):
        # What the code will put in front, so the options read well with it
        # ("red" + "flannel shirt") and say nothing of it.
        src = next((x for x in graph["slots"] if x["name"] == r["from"]["slot"]), None)
        key_of = next((i["key"] for i in plan["items"] if src and i.get("var") == src["var"]
                       and i["kind"] in ("wildcard", "library")), None)
        payload = ((built or {}).get(key_of) or {}).get("payload") if key_of else None
        drawn = [str(o.get("value")) for o in (payload or {}).get("options") or []
                 if isinstance(o, dict) and o.get("value") and not o.get("is_null")
                 and (not r["from"]["value"] or r["from"]["value"] in (
                     o.get("sub_categories") or []))][:12]
        if drawn:
            user += (f"\nWhat goes in front: {r['from']['slot']} options like "
                     + ", ".join(f'"{d[:30]}"' for d in drawn) + ".")
    if parse_settings(plan.get("settings"))["negatives"] != "auto":
        user += "\nLeave every negative \"\": the pack keeps one standing negative."
    fmt = ai_guide.format_line(plan.get("model") or "")
    if fmt:
        user += f"\nThe image model: {fmt}"
    if plan.get("rating") == "nsfw":
        user += "\n" + ai_guide.NSFW.strip()
    return {"system": SLOT_SYSTEM, "user": user, "schema": schema,
            "schema_name": name, "temperature": 0.8}


def fill_prompt(graph: dict[str, Any], slot: dict[str, Any], payload: dict[str, Any],
                targets: dict[str, dict[str, list[str]]], axis: str,
                also: list[str] | None = None) -> str:
    """The user prompt of a fill call: add options for the values of
    ``axis`` no option carries, and ones saying the rule words no option
    tagged with their value says (``fill_targets``; other axes' gaps are
    mentioned)."""
    want = targets[axis]
    count = min(MAX_COUNT, sum(max(2, len(ws)) for ws in want.values()))
    lines = [f"Add {count} options to the wildcard \"{slot['name']}\" of the pack "
             f"\"{graph['title']}\" ({graph['summary'] or 'no summary'}).",
             f"What it holds: {slot['what'] or slot['name']}.",
             f"Style: {'short comma tags' if graph['style'] == 'tags' else 'short sentences'}; "
             f"rating: {graph['rating']}."]
    bare = [v for v, ws in want.items() if not ws]
    if bare:
        lines.append(f"No option is {', '.join(bare)} on {axis} yet: every new option must be "
                     "one of those (at least two for each).")
    for v, ws in want.items():
        if ws:
            lines.append(f"No option mentions {', '.join(ws)} yet: add at least one option "
                         f"saying each, tagged {v} on {axis} (a rule is about them).")
    for a in slot["axes"]:
        if a["name"] != axis:
            lines.append(f"Tag every option on {a['name']} with "
                         + ("the one value" if axis_kinds(graph, slot)[a["name"]] == "accepts"
                            else "every value") + f" that fits: {', '.join(a['values'])}"
                         + (f" (none is {', '.join(targets[a['name']])} yet)"
                            if a["name"] in targets else "") + ".")
    have = [_norm(o.get("value")) for o in payload.get("options") or []
            if isinstance(o, dict) and _norm(o.get("value"))]
    if have:
        lines.append("Already there, so don't repeat them: " + "; ".join(have[:MAX_COUNT]) + ".")
    others = [s["name"] for s in graph["slots"] if s is not slot]
    if others:
        lines.append("Other wildcards cover " + ", ".join(others[:12])
                     + ": keep those words out of these options.")
    if also:
        lines.append("The last options had these problems; the new ones must not: "
                     + "; ".join(also)[:400] + ".")
    return "\n".join(lines)


# --- picks the request counts ----------------------------------------------

_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
                 "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_NUM = r"(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)"
#: "2 to 3 accessories", "2-3 accessories", "two or three accessories",
#: "three accessories each".
_COUNTED = re.compile(
    _NUM + r"(?:\s*(?:to|or|-|–)\s*" + _NUM + r")?\s+([a-z][a-z-]{2,})", re.I)
#: Counted things that are no pick of a slot: how the pack runs, not what
#: an image holds.
_NOT_PICKED = frozenset("""
frames frame images image pictures picture panels panel steps step scenes scene runs run
options option slots slot items item choices choice values value seeds seed words word
lines line tags tag sentences sentence prompts prompt variations variation wildcards
wildcard packs pack times time kinds kind types type sets set lists list axes axis
""".split())


def _count(raw: str) -> int:
    return int(raw) if raw.isdigit() else _NUMBER_WORDS.get(raw.lower(), 0)


def request_picks(request: str) -> list[tuple[int, int, str]]:
    """``(low, high, noun)`` for every counted thing the request asks for
    ("2 to 3 accessories" → (2, 3, "accessories")), at least 2 of
    something, up to 20."""
    out: list[tuple[int, int, str]] = []
    for m in _COUNTED.finditer(request or ""):
        lo, hi, noun = _count(m.group(1)), _count(m.group(2) or m.group(1)), m.group(3).lower()
        if hi < lo:
            lo, hi = hi, lo
        if hi < 2 or hi > 20 or noun in _NOT_PICKED or noun in _REQUEST_STOP:
            continue
        out.append((max(1, lo), hi, noun))
    return out


def drop_multi_pick_rules(graph: dict[str, Any]) -> list[str]:
    """A derive or append rule keyed on a slot that picks several options
    goes: the engine sets ``$var.axis`` for one pick only, so the rule never
    fired (9B, 2026-10-21: $animal_biome on a 1-3 pick, broken 11-17 runs
    in 14-21). A variable nothing writes any more leaves the order."""
    lines: list[str] = []
    multi = {s["name"]: s for s in graph["slots"] if s["pick"] and s["pick"] != "1"}
    gone = [r for r in graph["relations"] if r["kind"] in ("derive", "append")
            and r["from"]["slot"] in multi]
    if not gone:
        return []
    graph["relations"] = [r for r in graph["relations"] if r not in gone]
    still = {r["var"] for r in graph["relations"] if r["kind"] == "derive"}
    for r in gone:
        s = multi[r["from"]["slot"]]
        lines.append(f"{s['name']} picks {s['pick']}, so ${r['var']} can't follow one "
                     f"{s['name']}.{r['from']['axis']} value: that rule went")
        if r["kind"] == "derive" and r["var"] not in still:
            graph["template"]["order"] = [v for v in graph["template"]["order"]
                                          if v != r["var"]]
    return lines


def apply_picks(graph: dict[str, Any], request: str,
                locked: list[str] | tuple[str, ...] = ()) -> list[str]:
    """A slot the request counts ("2 to 3 accessories") picks that many
    when the model left its ``pick`` empty, and a slot a rule runs between
    picks one when the model gave it several the request doesn't count
    (unless the user set it by hand, ``locked``). Returns the lines saying
    so."""
    lines: list[str] = []
    counted = request_picks(request)
    # A slot the model gave several picks that a rule runs between, with no
    # count for it in the request: both rows fire, and only an option fit
    # for every pick is left ("pick 2" outfits, 9B smoke 2026-10-24: one
    # casual and one formal outfit, boots in every run).
    # A derive / append keyed on a multi-pick goes (drop_multi_pick_rules),
    # so its source counts too (hair lengths "pick 2-3": nine length rules
    # dropped and the length never shown, 9B smoke 2026-10-24).
    ruled = {x for r in graph["relations"] if r["kind"] in NARROWING
             for x in (r["from"]["slot"], r["to"]["slot"])} | {
        r["from"]["slot"] for r in graph["relations"] if r["kind"] in ("derive", "append")}
    for s in graph["slots"]:
        if request.strip() and s["pick"] and s["pick"] != "1" and s["name"] in ruled \
                and s["var"] not in locked and not any(
                _stems(noun) & _stems(w) for _, _, noun in counted
                for w in re.findall(r"[a-z]+", f"{s['name']} {s['var']} {s['what']}".lower())):
            lines.append(f"{s['name']} picks one: the request doesn't ask for {s['pick']}, and "
                         "its rules need one pick")
            s["pick"] = ""
    for lo, hi, noun in counted:
        stems = _stems(noun)
        for s in graph["slots"]:
            if s["pick"] or s.get("self_axis"):
                continue
            words = set(re.findall(r"[a-z]+", f"{s['name']} {s['var']} {s['what']}".lower()))
            if not any(stems & _stems(w) for w in words):
                continue
            s["pick"] = f"{lo}-{hi}" if lo != hi else f"{hi}"
            lines.append(f"{s['name']}: pick {s['pick']}, from the request")
            break
    return lines


# --- slots that aren't picks -------------------------------------------------

#: Slot names (or variables) that hold what never rolls: quality words
#: are the same every run, a negative prompt is the template's.
_QUALITY_SLOT = frozenset({"quality", "qualities", "quality_tags", "quality_tag", "qual"})
_NEGATIVE_SLOT = frozenset({"negative", "negatives", "negative_prompt", "neg_prompt",
                            "negative_tags", "neg"})
_PRESET_NEGATIVES = re.compile(r"\bpresets?\b.{0,80}\b(?:its|their)\s+own\s+negatives?\b"
                               r"|\b(?:its|their)\s+own\s+negatives?\b.{0,80}\bpresets?\b",
                               re.I | re.S)


def _negative_name(name: str, var: str) -> bool:
    """Whether a name or variable says negative: ``compile_plan``'s test
    (``_NEGATIVEISH``) or a bare "neg" word ("default_neg", "neg_tags")."""
    words = set(re.split(r"[\s_\-]+", f"{name} {var}".lower()))
    return bool(_NEGATIVEISH.search(f"{name} {var}")) or bool(words & {"neg", "negs"})


def _slot_key(slot: dict[str, Any]) -> set[str]:
    return {slot["var"].lower(), _axis_name(slot["name"]), slot["name"].lower()}


def _in_relations(graph: dict[str, Any], slot: dict[str, Any]) -> bool:
    return any(r["from"]["slot"] == slot["name"] or (r.get("to") or {}).get("slot")
               == slot["name"] for r in graph["relations"])


def apply_request_slots(graph: dict[str, Any], request: str) -> list[str]:
    """What the code lands when the planner wrote a pick for something
    that never rolls (an evals finding on small models): a Quality slot
    is fixed values (its text, or the style's usual quality words), a
    Negative slot is the template's negative, and a preset asked to
    carry "its own negatives" carries the standing negative itself
    instead of the template. A slot that has axes or sits in a relation
    is left alone: the model meant it. Returns the lines saying so."""
    lines: list[str] = []
    for s in list(graph["slots"]):
        key = _slot_key(s)
        if key & _NEGATIVE_SLOT or _negative_name(s["name"], s["var"]):
            # The same test ``compile_plan`` drops the wildcard by: a slot
            # it would drop can't stay in the order or a relation, or the
            # template reads a variable nothing sets (7 of 39 packs).
            graph["slots"].remove(s)
            graph["template"]["order"] = [v for v in graph["template"]["order"]
                                          if v != s["var"]]
            gone = [r for r in graph["relations"] if r["from"]["slot"] == s["name"]
                    or (r.get("to") or {}).get("slot") == s["name"]]
            graph["relations"] = [r for r in graph["relations"] if r not in gone]
            if not graph["template"]["negative"] and "," in s["what"]:
                graph["template"]["negative"] = s["what"]
            lines.append(f"{s['name']} is the negative prompt, not a pick: it went to the "
                         "template's negative"
                         + (f" (and its {len(gone)} rule{'s' if len(gone) > 1 else ''} "
                            "went with it)" if gone else ""))
            continue
        if s["axes"] or _in_relations(graph, s):
            continue
        if key & _QUALITY_SLOT and len(graph["fixed"]) < MAX_FIXED \
                and not any(f["var"] == s["var"] for f in graph["fixed"]):
            words = s["what"] if "," in s["what"] else (
                "masterpiece, best quality" if graph["style"] == "tags"
                else "high quality, detailed")
            graph["slots"].remove(s)
            graph["fixed"].append({"name": s["name"], "var": s["var"], "text": words,
                                   "negative": ""})
            lines.append(f"{s['name']} is fixed values: quality words are the same every run")
    for f in list(graph["fixed"]):
        if _negative_name(f["name"], f["var"]):
            # Dropped by compile_plan like the slot above; the graph kept
            # it in the order, so the template read $neg (9 packs).
            graph["fixed"].remove(f)
            graph["template"]["order"] = [v for v in graph["template"]["order"]
                                          if v != f["var"]]
            neg = graph["template"]["negative"]
            if f["text"] and _norm(f["text"]) not in _norm(neg):
                graph["template"]["negative"] = f"{neg}, {f['text']}" if neg else f["text"]
            lines.append(f"{f['name']} is the negative prompt, not a preset: its words went "
                         "to the template's negative")
    for i in list(graph["inputs"]):
        if _negative_name(i["var"], i["about"]):
            graph["inputs"].remove(i)
            graph["template"]["order"] = [v for v in graph["template"]["order"]
                                          if v != i["var"]]
            lines.append(f"${i['var']} is a negative, not an input: negatives are the "
                         "template's")
    if _PRESET_NEGATIVES.search(request or "") and graph["fixed"] \
            and graph["template"]["negative"] and not any(f["negative"] for f in graph["fixed"]):
        f = graph["fixed"][0]
        f["negative"] = graph["template"]["negative"]
        graph["template"]["negative"] = ""
        lines.append(f"{f['name']} carries its own negative (it was the template's), as asked")
    return lines


# --- the request against the graph -------------------------------------------

#: Request words that name no content: function words, builder-speak and
#: how-often words. The rest ("sandals", "winter", "cabin") must show up
#: somewhere in the graph.
_REQUEST_STOP = frozenset("""
a an the and or but nor not no yes of to in on at by for as is are be been being was
were do does did done have has had having can could will would shall should may might
must let lets it its i me my mine we us our you your he she his her they them their
one ones two three four five six seven eight nine ten this that these those there here
from into onto over under about around between through across after before during per
via with within without when where which while than then so if either neither own such
very just really quite rather also too else out up down off how what why who whom whose
whether please thanks thank ok okay etc eg ie something anything everything nothing
some any all both more less most least few many several much lot lots every each other
another same different various variety varied mix mixed matching match matches matched
fit fits fitting suit suits suited belong belongs goes go with come comes out keep keeps
stay stays get gets got give gives given make makes made making create creates created
generate generates generated build builds built write writes written use uses used using
want wants wanted need needs needed like likes would prefer include includes included
including featuring feature features show shows showing look looks looking seem seems
based draw drawn drawing random randomly chance always never sometimes often rarely rare
common usually mostly only just about around roughly percent time times once twice
pack packs prompt prompts image images picture pictures render renders set sets list
lists option options choose chooses pick picks picked choice choices slot slots variable
variables rule rules template wildcard wildcards bundle bundles story frame frames sweep
sheet series sequence loop batch hold held whole same single simple style styles tag
tags tagged sentence sentences quality negative negatives preset presets model models
checkpoint checkpoints family families lora loras works work working pony flux sdxl
illustrious noobai nsfw sfw safe adult explicit way ways thing things stuff bit kind
kinds type types sort sorts shared type typed myself itself must empty narrow
none call decide decides decided either any whatever default defaults small large big
specialized specialised specific general separation separate separated concern concerns
structure structured section sections held vary varies varying varied each
""".split())


def _stems(word: str) -> set[str]:
    """The word and the singulars it may be the plural of ("heroes" →
    hero, heroe; "ponies" → pony), so either spelling matches. A British
    "-our" also matches its American "-or" ("colours" → color: the shirts
    pack's "colour" was a request gap next to a Color List, 9B smoke
    2026-10-24)."""
    out = {word, word.replace("-", "")}
    if len(word) > 4 and word.endswith("ies"):
        out.add(word[:-3] + "y")
    if len(word) > 3 and word.endswith("es"):
        out.add(word[:-2])
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        out.add(word[:-1])
    if len(word) > 5 and "our" in word[2:]:
        out |= {w.replace("our", "or") for w in out}
    return out


def _content_words(text: str) -> list[str]:
    out: list[str] = []
    for w in re.findall(r"[a-z][a-z'-]*[a-z]|[a-z]", text.lower()):
        # "character's" is the character (9B and Sonnet, 2026-10-21: the
        # possessive never matched the graph's "character" and the gap
        # came back on every Fix all).
        w = re.sub(r"'s?$", "", w.strip("'-"))
        if len(w) < 3 or w in _REQUEST_STOP:
            continue
        if w not in out:
            out.append(w)
    return out


def request_gaps(graph: dict[str, Any], request: str) -> list[str]:
    """The content words of the request that the graph says nowhere: not
    in a slot (name, variable, what), an axis (name, values), a relation
    (words, text, variable), fixed text, the template's lead or tail or
    an input. "no sandals in winter" with no "sandals" anywhere is a design
    gap the build can't repair; the planner gets the list back."""
    if not request.strip():
        return []
    said: list[str] = []
    for s in graph["slots"]:
        said += [s["name"], s["var"], s["what"]]
        for a in s["axes"]:
            said += [a["name"], *a["values"]]
    for r in graph["relations"]:
        said += [*(r.get("words") or []), r.get("text") or "", r.get("var") or ""]
    for f in graph["fixed"]:
        said += [f["name"], f["var"], f["text"]]
    said += [graph["template"]["lead"], graph["template"]["tail"]]
    for i in graph["inputs"]:
        said += [i["var"], i["about"], i["example"]]
    have: set[str] = set()
    for w in re.findall(r"[a-z]+", " ".join(said).lower().replace("_", " ")):
        have |= _stems(w)
    return [w for w in _content_words(request) if not _stems(w) & have][:MAX_GAPS]


#: Gaps past this many mean the request is prose, not a list of things.
MAX_GAPS = 8


# --- the settings and the user's hand edits, applied by the code ----------

#: What a hand edit may lock: slots by variable, relations by signature,
#: relations the user took out, and template fields.
LOCK_KEYS = ("slots", "relations", "removed_relations", "template")
TEMPLATE_FIELDS = ("lead", "order", "tail", "negative")


def parse_locks(raw: Any) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {k: [] for k in LOCK_KEYS}
    if isinstance(raw, dict):
        for k in LOCK_KEYS:
            v = raw.get(k)
            if isinstance(v, list):
                out[k] = list(dict.fromkeys(x for x in v if isinstance(x, str) and x))[:200]
    out["template"] = [f for f in out["template"] if f in TEMPLATE_FIELDS]
    return out


def raw_rel_sig(r: dict[str, Any]) -> str:
    """A relation's signature in the model's shape, equal to ``_rel_key``
    of its compiled form (and to the manager's ``relSig``)."""
    return "|".join(str(r.get(k) or "") for k in (
        "kind", "from_slot", "from_axis", "from_value", "to_slot", "to_axis", "to_value",
        "var", "text"))


def _sig_like(a: str, b: str) -> bool:
    """Whether two relation signatures name the same relation: the same
    kind, slots, values, variable and text, case aside, and the same
    axis where both give one (the model may leave an axis blank, the
    value finds it)."""
    pa, pb = a.lower().split("|"), b.lower().split("|")
    if len(pa) != 9 or len(pb) != 9:
        return a == b
    for n, (x, y) in enumerate(zip(pa, pb, strict=True)):
        if x.strip() == y.strip():
            continue
        if n in (2, 5) and (not x.strip() or not y.strip()):
            continue  # an axis one side left blank
        return False
    return True


def apply_locks(raw: dict[str, Any], previous: dict[str, Any],
                locks: dict[str, list[str]]) -> list[str]:
    """Put what the user set by hand (``locks``, parts of ``previous``'s
    graph) back over a new model answer ``raw`` (the model's shape, edited
    in place): locked slots replace the answer's by variable (added when
    the answer dropped them), locked relations are added when missing,
    removed ones are taken out, locked template fields are copied. Returns
    the lines saying what was kept."""
    kept: list[str] = []
    prev = graph_answer({"graph": previous})
    slots = _got if isinstance(_got := raw.get("slots"), list) else []
    raw["slots"] = slots
    for var in locks["slots"]:
        mine = next((s for s in prev["slots"] if s["var"] == var), None)
        if mine is None:
            continue
        at = next((i for i, s in enumerate(slots)
                   if isinstance(s, dict) and (_var(s.get("var")) == var
                                               or str(s.get("name") or "").lower()
                                               == mine["name"].lower())), -1)
        if at >= 0:
            slots[at] = dict(mine)
        else:
            slots.append(dict(mine))
        kept.append(mine["name"])
    rels = [r for r in (raw.get("relations") if isinstance(raw.get("relations"), list) else [])
            if isinstance(r, dict)]
    gone = set(locks["removed_relations"])
    rels = [r for r in rels if not any(_sig_like(raw_rel_sig(r), g) for g in gone)]
    have = {raw_rel_sig(r) for r in rels}
    added = 0
    for sig in locks["relations"]:
        mine = next((r for r in prev["relations"] if raw_rel_sig(r) == sig), None)
        if mine is not None and not any(_sig_like(h, sig) for h in have):
            rels.append(dict(mine))
            have.add(sig)
            added += 1
    raw["relations"] = rels
    lines = []
    if kept:
        lines.append("Kept your " + ", ".join(kept) + (" slots" if len(kept) > 1 else " slot"))
    if added:
        lines.append(f"Kept {added} relation{'s' if added > 1 else ''} you set")
    if locks["template"]:
        tpl = _got if isinstance(_got := raw.get("template"), dict) else {}
        for f in locks["template"]:
            tpl[f] = prev["template"][f]
        raw["template"] = tpl
        lines.append("Kept the template " + ", ".join(locks["template"]) + " you set")
    return lines


def apply_settings(graph: dict[str, Any], settings: Any) -> list[str]:
    """The pack settings landed on the compiled graph, so nothing the model
    wrote contradicts them: style and rating when set, the option count as
    a cap on every slot, no sections for a flat pack. Returns the lines
    saying what changed."""
    cfg = parse_settings(settings)
    lines: list[str] = []
    if cfg["style"] != "auto" and graph["style"] != cfg["style"]:
        graph["style"] = cfg["style"]
        lines.append(f"Style {cfg['style']}, as set")
    if cfg["rating"] != "auto" and graph["rating"] != cfg["rating"]:
        graph["rating"] = cfg["rating"]
        lines.append(f"Rated {cfg['rating']}, as set")
    if cfg["count"]:
        capped = []
        for s in graph["slots"]:
            if s["count"] > cfg["count"] and not s.get("self_axis"):
                s["count"] = cfg["count"]
                capped.append(s["name"])
        if capped:
            lines.append(f"{cfg['count']} options: capped " + ", ".join(capped))
    if cfg["structure"] == "flat" and (graph["sections"] or any(s["section"]
                                                                 for s in graph["slots"])):
        graph["sections"] = []
        for s in graph["slots"]:
            s["section"] = ""
        lines.append("One bundle: no sections")
    return lines


def locks_note(plan: dict[str, Any]) -> str:
    """What a refine tells the model about the parts the user set by hand."""
    locks = parse_locks(plan.get("locks"))
    g = _got if isinstance(_got := plan.get("graph"), dict) else None
    if g is None or not any(locks[k] for k in LOCK_KEYS):
        return ""
    bits = []
    names = [s["name"] for s in g["slots"] if s["var"] in locks["slots"]]
    if names:
        bits.append("the slots " + ", ".join(names))
    if locks["relations"]:
        bits.append(f"{len(locks['relations'])} relation(s)")
    if locks["removed_relations"]:
        bits.append(f"{len(locks['removed_relations'])} relation(s) they removed (don't "
                    "write them again)")
    if locks["template"]:
        bits.append("the template " + ", ".join(locks["template"]))
    return ("The user set these by hand and they stay as they are: " + "; ".join(bits)
            + ". Change the rest only.")


# --- questions the code asks (and the browser answers by code) -------------

_STORY_WORDS = re.compile(
    r"\b(story|stories|storyboard|sequence|comic|panels?|frames?|step[- ]by[- ]step|"
    r"progression|episodes?|over (?:a|the) loop)\b", re.I)
_FRAMES = re.compile(r"\b(\d{1,2})\s*(?:frames?|panels?|steps|images|pictures|scenes)\b", re.I)
STORY_QUESTION = ("The request reads like a story. Run it as a story over a Loop (one frame "
                  "per step, the cast held), or as single images?")
SWEEP_QUESTION = ("Which slots does the sweep sheet compare? Pick 2 or 3 short ones; the rest "
                  "are held.")


def code_questions(graph: dict[str, Any], request: str,
                   decisions: Any = None) -> list[dict[str, Any]]:
    """Questions the code asks when the graph has a fork the request didn't
    settle, each with ``binds`` saying what the answer sets (the browser
    applies it; no model call): the run style when the request reads like
    a story but runs as single images; the sweep axes when a sweep run has
    none marked. One already answered (``decisions``) is not asked again."""
    from engine.ai.pack.settings import DEFAULT_FRAMES, MAX_FRAMES, MIN_FRAMES, parse_decisions
    asked = {d["question"] for d in parse_decisions(decisions)}
    run = parse_run(graph["run"])
    out: list[dict[str, Any]] = []
    if run["mode"] == "single" and _STORY_WORDS.search(request or "") \
            and STORY_QUESTION not in asked:
        m = _FRAMES.search(request or "")
        frames = max(MIN_FRAMES, min(MAX_FRAMES, int(m.group(1)))) if m else DEFAULT_FRAMES
        out.append({"header": "Story or single", "question": STORY_QUESTION, "multi": False,
                    "choices": [f"A story of {frames} frames", "Single images"],
                    "binds": {"set": "run", "frames": frames}})
    prompt = [s for s in graph["slots"] if s["show"] == "prompt"]
    if run["mode"] == "sweep" and len(prompt) >= 3 and not any(s.get("sweep") for s in prompt) \
            and SWEEP_QUESTION not in asked:
        out.append({"header": "Sweep axes", "question": SWEEP_QUESTION, "multi": True,
                    "choices": [s["name"] for s in prompt][:8], "binds": {"set": "sweep"}})
    return out


_LOOP_ASK = re.compile(
    r"\b(?:every|each|all)\s+(?:image|frame|panel|picture|shot)s?\s+(?:of|in|over)\s+"
    r"(?:a|the)\s+loop\b|\b(?:over|across|in)\s+(?:a|the)\s+loop\b", re.I)


def loop_run(graph: dict[str, Any], request: str, decisions: Any = None) -> list[str]:
    """A first answer that runs single images when the request asks for a
    Loop ("the same hero in every image of a loop") runs as a story
    instead, so what the request holds stays held (single images clear
    every hold). Not when the user already answered the story question."""
    from engine.ai.pack.settings import DEFAULT_FRAMES, MAX_FRAMES, MIN_FRAMES, parse_decisions
    if parse_run(graph["run"])["mode"] != "single" or not _LOOP_ASK.search(request) \
            or any(d["question"] == STORY_QUESTION for d in parse_decisions(decisions)):
        return []
    m = _FRAMES.search(request)
    frames = max(MIN_FRAMES, min(MAX_FRAMES, int(m.group(1)))) if m else DEFAULT_FRAMES
    graph["run"] = {"mode": "story", "frames": frames}
    return [f"Runs as a story of {frames} frames: the request asks for a Loop"]


def compile_graph_plan(raw: Any, **kw: Any) -> dict[str, Any]:
    """A graph answer as a plan (``compile_plan`` on its items), carrying
    the graph as ``plan["graph"]``, the settings applied to it
    (``apply_settings``), the user's hand edits kept over a new answer
    (``apply_locks``, from ``previous["locks"]``) and ``applied``, the
    lines saying what the code did. ``kw`` goes to ``compile_plan``
    (library, previous, decisions, settings, base, canvas)."""
    from engine.ai.pack.plan import compile_plan
    sent_back = isinstance(raw, dict) and isinstance(raw.get("graph"), dict)
    graph = raw["graph"] if sent_back else raw
    previous = _got if isinstance(_got := kw.get("previous"), dict) else None
    for field in ("settings", "decisions"):
        # A caller that leaves them out means the plan's own (a graph plan's
        # items never carry them, so ``compile_plan`` can't fall back).
        if kw.get(field) is None:
            kw[field] = (raw.get(field) if sent_back else None) \
                or (previous.get(field) if previous else None)
    locks = parse_locks(raw.get("locks") if sent_back else
                        previous.get("locks") if previous else None)
    applied: list[str] = []
    if not sent_back and previous is not None and isinstance(previous.get("graph"), dict) \
            and isinstance(graph, dict) and not _compiled(graph):
        applied += apply_locks(graph, previous["graph"], locks)
    graph = compile_graph(graph)
    if isinstance(raw, dict) and isinstance(raw.get("graph"), dict) \
            and isinstance(raw.get("run"), dict):
        # A plan sent back: "Runs as" is edited on the plan, so it wins
        # over what the graph carried.
        graph["run"] = parse_run(raw["run"], graph["run"])
    elif isinstance(kw.get("previous"), dict) and isinstance(kw["previous"].get("run"), dict):
        # A refine: how the pack runs is the user's setting by now, never
        # re-decided by the model's next answer.
        graph["run"] = parse_run(kw["previous"]["run"], graph["run"])
    else:
        applied += loop_run(graph, kw.get("request") or "", kw.get("decisions"))
    applied += apply_settings(graph, kw.get("settings"))
    applied += code_beat(graph)
    applied += apply_picks(graph, kw.get("request") or "", locks["slots"])
    applied += drop_multi_pick_rules(graph)
    applied += apply_request_slots(graph, kw.get("request") or "")
    from engine.ai.pack.request_needs import apply_request_needs
    applied += apply_request_needs(graph, kw.get("request") or "")
    applied += trim_model(graph, kw.get("request") or "")
    if model_quality(graph, kw.get("settings")):
        own = [f["name"] for f in graph["fixed"] if f["var"] == QUALITY_VAR]
        if own:
            # The per-model-family rule writes $quality; a fixed value of
            # the same name would be written over every run. Its words
            # become the rule's "otherwise" (``compile_item``).
            graph["quality_words"] = next(f["text"] for f in graph["fixed"]
                                          if f["var"] == QUALITY_VAR)
            graph["fixed"] = [f for f in graph["fixed"] if f["var"] != QUALITY_VAR]
            applied.append(", ".join(own) + ": the per-model-family rule writes $quality, so "
                           "the fixed value went")
    if parse_run(graph["run"])["mode"] == "single":
        # A hold only means something over a Loop: in single images it
        # just makes every prompt the same.
        held = [s["name"] for s in graph["slots"] if s["hold"]]
        for s in graph["slots"]:
            s["hold"] = False
        if held:
            applied.append("Single images: nothing held (" + ", ".join(held) + " vary)")
    lead, gone = unasked_lead(graph["template"]["lead"], kw.get("request") or "")
    if gone:
        graph["template"]["lead"] = lead
        applied.append("Took \"" + ", ".join(gone) + "\" out of the lead: the request names "
                       "no person")
    applied += apply_library(graph, kw.get("library"), kw.get("settings"))
    _story_holds(graph["slots"], parse_run(graph["run"]), graph["warnings"])
    if graph["anchor"] not in {s["var"] for s in graph["slots"]}:
        # The code took the anchor's slot out (a Quality slot now fixed
        # values, a Beat slot the story owns): the first prompt pick leads.
        graph["anchor"] = next((s["var"] for s in graph["slots"] if s["show"] == "prompt"), "")
    plan = compile_plan(graph_plan(graph, kw.get("settings"), kw.get("library")), **kw)
    plan["graph"] = {k: v for k, v in graph.items() if k not in ("warnings", "bad_refs")}
    plan["locks"] = locks
    plan["applied"] = applied
    plan["questions"] = [*plan["questions"],
                         *code_questions(graph, kw.get("request") or "", plan["decisions"])]
    plan["warnings"] = [*graph["warnings"],
                        *(plain_ref(b) for b in [*graph["dropped"], *graph["bad_refs"]]),
                        *plan["warnings"]]
    plan["bad_refs"] = graph["bad_refs"]
    # Request words the graph says nowhere, and the ones a refine was
    # already asked about and left unplaced: the review asks once, then
    # stops calling them a fix (Sonnet 5.5 and the 9B, 2026-10-21: "give
    # each a slot" came back on every Fix all).
    prior = previous if previous is not None else (raw if sent_back else None)
    gaps = request_gaps(graph, kw.get("request") or "")
    before = set(prior.get("request_gaps") or []) if isinstance(prior, dict) else set()
    tried = set(prior.get("gaps_tried") or []) if isinstance(prior, dict) else set()
    if previous is not None:
        tried |= before & set(gaps)
    plan["request_gaps"] = gaps
    plan["gaps_tried"] = sorted(tried & set(gaps))
    return plan


def graph_answer(plan: dict[str, Any]) -> dict[str, Any]:
    """The plan's graph in the shape the model wrote it, to replay a
    hand-edited plan as the model's last answer."""
    g = plan["graph"]
    rels = []
    for r in g["relations"]:
        dst = r.get("to") or {}
        rels.append({"kind": r["kind"], "from_slot": r["from"]["slot"],
                     "from_axis": r["from"]["axis"], "from_value": r["from"]["value"],
                     "to_slot": dst.get("slot", ""), "to_axis": dst.get("axis", ""),
                     "to_value": dst.get("value", ""), "factor": r.get("factor", 0),
                     "var": r.get("var", ""), "text": r.get("text", ""),
                     "otherwise": r.get("otherwise", ""), "words": list(r.get("words") or [])})
    var_name = {s["var"]: s["name"] for s in g["slots"]}
    var_name.update({f["var"]: f["name"] for f in g["fixed"]})
    return {k: g[k] for k in ("title", "summary", "design", "rating", "style", "model",
                              "anchor", "questions", "assumptions", "from_images", "research",
                              "run", "inputs", "sections", "slots", "fixed")} | {
        "relations": rels,
        "template": {**g["template"], "order": [var_name.get(v, v)
                                                for v in g["template"]["order"]]}}


def refs_schema(graph: dict[str, Any]) -> dict[str, Any]:
    """The relation schema with every slot, axis and value field an enum of
    what the graph declares: the repair call for ``bad_refs`` can only
    write references that resolve."""
    slots = [s["name"] for s in graph["slots"]]
    axes = sorted({a["name"] for s in graph["slots"] for a in s["axes"]}) or [""]
    values = sorted({v for s in graph["slots"] for a in s["axes"] for v in a["values"]}) or [""]
    rel = _obj({
        "kind": {"type": "string", "enum": list(RELATIONS)},
        "from_slot": {"type": "string", "enum": slots},
        "from_axis": {"type": "string", "enum": axes},
        "from_value": {"type": "string", "enum": [*values, ""]},
        "to_slot": {"type": "string", "enum": [*slots, ""]},
        "to_axis": {"type": "string", "enum": [*axes, ""]},
        "to_value": {"type": "string", "enum": [*values, ""]},
        "factor": {"type": "number"},
        "var": _STR,
        "text": _STR,
        "otherwise": _STR,
        "words": _STRS,
    })
    return _obj({"relations": {"type": "array", "items": rel}})


def refs_prompt(graph: dict[str, Any]) -> str:
    """The repair ask: the dropped relations and what the graph declares."""
    lines = ["These relations named a slot, axis or value the graph doesn't declare and "
             "were dropped:"]
    lines += [f"- {b}" for b in graph["bad_refs"]]
    lines.append("The graph declares:")
    for s in graph["slots"]:
        axes = "; ".join(f"{a['name']}: {', '.join(a['values'])}" for a in s["axes"]) \
            or "no axes"
        lines.append(f"- {s['name']} (${s['var']}): {axes}")
    lines.append("Write each dropped relation again using only those names, or leave it out "
                 "when none fits. Answer with the relations to add.")
    return "\n".join(lines)


def with_refs(graph: dict[str, Any], answer: Any) -> dict[str, Any]:
    """``graph`` with the repair call's relations added (re-checked like
    the rest; what still doesn't resolve stays out)."""
    extra = answer.get("relations") if isinstance(answer, dict) else None
    if not isinstance(extra, list) or not extra:
        return graph
    raw = graph_answer({"graph": graph})
    raw["relations"] = [*raw["relations"], *extra]
    raw["dropped"] = list(graph.get("dropped") or [])
    fixed = compile_graph(raw)
    if len(fixed["relations"]) - len(graph["relations"]) < len(graph["bad_refs"]):
        # Fewer came back than were asked for: the ones not written again
        # stay listed as left out (which ones, the messages can't say).
        fixed["dropped"] = list(dict.fromkeys([*fixed["dropped"], *graph["bad_refs"]]))
    fixed["warnings"] = graph.get("warnings", [])
    return fixed
