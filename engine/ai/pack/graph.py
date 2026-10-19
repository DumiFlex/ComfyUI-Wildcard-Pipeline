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
    _obj,
    _tag,
    _var,
)
from engine.ai.pack.plan import _slug_var

MAX_SLOTS = 24
MAX_AXES = 4
MAX_VALUES = 12
MAX_RELATIONS = 40
MAX_FIXED = 6
MAX_TEMPLATE_PARTS = 40
MAX_TEXT = 200
#: Relation kinds. The first four key one slot's pick on another's by tag;
#: ``agree`` and ``accepts`` are "goes with" on a shared axis; ``derive``
#: and ``append`` write text from a pick.
RELATIONS = ("exclude", "only", "boost", "reduce", "agree", "accepts", "derive", "append")
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
        for a in s.get("axes") if isinstance(s.get("axes"), list) else []:
            if not isinstance(a, dict):
                continue
            aname = _axis_name(a.get("name"))
            if not aname or any(x["name"] == aname for x in axes):
                if aname:
                    warnings.append(f"{name}: a second axis named {aname}")
                continue
            values = []
            for v in a.get("values") if isinstance(a.get("values"), list) else []:
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
            "sometimes_none": max(0, min(90, none)),
            "axes": axes,
        })
        names.add(name.lower())
        taken_vars.add(var)
        if len(out) >= MAX_SLOTS:
            warnings.append(f"Kept the first {MAX_SLOTS} slots")
            break
    return out


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
    slot = slots.get(sname.lower()) or slots.get(_var(sname).lower()) \
        or slots.get(f"${_var(sname)}".lower())
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
        return None, f"{slot['name']} has no axis {axis or '?'}"
    if need_value and value not in ax["values"]:
        return None, f"{slot['name']}.{ax['name']} has no value {value or '?'}"
    return {"slot": slot, "axis": ax["name"], "value": value if need_value else ""}, ""


def _relations(
    raw: Any, slots: list[dict[str, Any]], fixed_vars: set[str], input_vars: set[str],
    warnings: list[str], bad_refs: list[str],
) -> list[dict[str, Any]]:
    by_name: dict[str, dict[str, Any]] = {}
    for s in slots:
        by_name[s["name"].lower()] = s
        by_name[s["var"].lower()] = s
        by_name[f"${s['var']}".lower()] = s
    slot_vars = {s["var"] for s in slots}
    derived: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict) or r.get("kind") not in RELATIONS:
            continue
        kind = r["kind"]
        src, err = _side(r, "from", by_name, need_value=kind not in ("agree", "accepts"))
        if src is None:
            bad_refs.append(f"{kind}: {err}")
            continue
        rel: dict[str, Any] = {"kind": kind, "from": {"slot": src["slot"]["name"],
                                                      "axis": src["axis"],
                                                      "value": src["value"]}}
        if kind in ("derive", "append"):
            var = _var(r.get("var"))
            text = _clean(r.get("text"), MAX_TEXT)
            if not var or not text:
                bad_refs.append(f"{kind} from {src['slot']['name']}: no variable or text")
                continue
            if kind == "derive" and (var in slot_vars or var in fixed_vars or var in input_vars):
                bad_refs.append(f"derive: ${var} is already set by a slot; derive a new "
                                "variable or use append")
                continue
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
            a_src = next((a for a in src["slot"]["axes"] if a["name"] == axis), None)
            a_dst = next((a for a in dst["slot"]["axes"] if a["name"] == (dst["axis"] or axis)),
                         None)
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


def _rel_key(rel: dict[str, Any]) -> str:
    src = rel["from"]
    dst = rel.get("to") or {}
    return "|".join([rel["kind"], src["slot"], src["axis"], src["value"], dst.get("slot", ""),
                     dst.get("axis", ""), dst.get("value", ""), rel.get("var", ""),
                     rel.get("text", "")])


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
    for part in raw.get("order") if isinstance(raw.get("order"), list) else []:
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
    for s in slots:
        if s["show"] == "prompt" and s["var"] not in order:
            order.append(s["var"])
            warnings.append(f"Added ${s['var']} to the template so {s['name']} shows")
    return {"lead": _clean(raw.get("lead"), MAX_TEXT), "order": order[:MAX_TEMPLATE_PARTS],
            "tail": _clean(raw.get("tail"), MAX_TEXT),
            "negative": _clean(raw.get("negative"), MAX_TEXT * 2)}


def compile_graph(raw: Any) -> dict[str, Any]:
    """The model's graph, cleaned and checked: ``{title, summary, design,
    rating, style, model, anchor, questions, assumptions, from_images,
    research, run, inputs, sections, slots, fixed, relations, template,
    warnings, bad_refs}``. ``bad_refs`` are the relations that named a slot,
    axis or value the graph doesn't declare (left out, for a repair call).
    Raises PlanError when the graph has no slot."""
    if not isinstance(raw, dict):
        raise PlanError("the answer wasn't a pack graph")
    warnings: list[str] = []
    bad_refs: list[str] = []
    inputs: list[dict[str, str]] = []
    for i in raw.get("inputs") if isinstance(raw.get("inputs"), list) else []:
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
    relations = _relations(raw.get("relations"), slots, {f["var"] for f in fixed},
                           {i["var"] for i in inputs}, warnings, bad_refs)
    template = _template(raw.get("template"), slots, fixed, relations, inputs, warnings)
    read_by_relation = {r["from"]["slot"] for r in relations} | {
        r["to"]["slot"] for r in relations if r.get("to")}
    for s in slots:
        if s["show"] == "internal" and s["name"] not in read_by_relation:
            warnings.append(f"{s['name']} is internal but no relation reads it: it does "
                            "nothing")
    sections: list[dict[str, str]] = []
    for sec in raw.get("sections") if isinstance(raw.get("sections"), list) else []:
        if isinstance(sec, dict) and _clean(sec.get("name"), 40) and len(sections) < MAX_SECTIONS:
            sections.append({"name": _clean(sec.get("name"), 40),
                             "about": _clean(sec.get("about"), 200)})
    questions = []
    for q in raw.get("questions") if isinstance(raw.get("questions"), list) else []:
        if isinstance(q, dict) and _clean(q.get("question"), 300):
            questions.append({"header": _clean(q.get("header"), 60),
                              "question": _clean(q.get("question"), 300),
                              "multi": q.get("multi") is True,
                              "choices": [_clean(c, 120) for c in q.get("choices") or []
                                          if _clean(c, 120)][:5]})
    anchor = _var(raw.get("anchor"))
    if anchor and anchor not in {s["var"] for s in slots}:
        anchor = ""
    return {
        "title": _clean(raw.get("title"), MAX_NAME) or "AI pack",
        "summary": _clean(raw.get("summary"), 300),
        "design": _clean(raw.get("design"), 900),
        "rating": raw.get("rating") if raw.get("rating") in ("safe", "nsfw") else "safe",
        "style": raw.get("style") if raw.get("style") in STYLES else "tags",
        "model": _clean(raw.get("model"), 40),
        "anchor": anchor or slots[0]["var"],
        "questions": questions[:MAX_QUESTIONS],
        "assumptions": [_clean(a, 200) for a in raw.get("assumptions") or []
                        if _clean(a, 200)][:6],
        "from_images": [_clean(a, 200) for a in raw.get("from_images") or []
                        if _clean(a, 200)][:4],
        "research": [_clean(a, 200) for a in raw.get("research") or [] if _clean(a, 200)][:2],
        "run": raw.get("run") if isinstance(raw.get("run"), dict) else {"mode": "single",
                                                                       "frames": 0},
        "inputs": inputs,
        "sections": sections,
        "slots": slots,
        "fixed": fixed,
        "relations": relations,
        "template": template,
        "warnings": warnings,
        "bad_refs": bad_refs,
    }


# --- the graph as plan items ------------------------------------------------

def _slot_rel_words(rel: dict[str, Any]) -> str:
    src, dst = rel["from"], rel.get("to") or {}
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
    return f"{src['slot']} {src['value']} {verb} {dst['slot']} {dst['value']}"


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
        if r.get("to") and (r["from"]["slot"], r["to"]["slot"]) not in out:
            out.append((r["from"]["slot"], r["to"]["slot"]))
    return out


def graph_plan(graph: dict[str, Any]) -> dict[str, Any]:
    """The graph as the raw plan ``compile_plan`` takes: one wildcard per
    slot, fixed values, one derivation per written variable, one constraint
    per (source, target) slot pair, and the template."""
    slot_by_name = {s["name"]: s for s in graph["slots"]}
    items: list[dict[str, Any]] = []
    for f in graph["fixed"]:
        items.append({"kind": "fixed_values", "name": f["name"], "var": f["var"],
                      "section": "", "about": f"${f['var']} = {f['text']}", "count": 0,
                      "tags": [], "source": "", "target": "", "use": ""})
    for s in graph["slots"]:
        tags = [v for a in s["axes"] for v in a["values"]]
        about = s["what"] or s["name"]
        if s["axes"]:
            about += ". Axes: " + "; ".join(f"{a['name']}: {', '.join(a['values'])}"
                                            for a in s["axes"])
        items.append({"kind": "wildcard", "name": s["name"], "var": s["var"],
                      "section": s["section"], "about": _clean(about, MAX_ABOUT),
                      "count": s["count"], "tags": tags[:16], "source": "", "target": "",
                      "use": _use(s)})
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
    t = graph["template"]
    items.append({"kind": "template", "name": graph["title"], "var": "", "section": "",
                  "about": _clean("Reads " + ", ".join(f"${v}" for v in t["order"])
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
        return False
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
        if r["from"]["slot"] == slot["name"] and r["kind"] in ("derive", "append", "accepts"):
            kinds[r["from"]["axis"]] = "accepts"
    return kinds


def inbound(graph: dict[str, Any], slot: dict[str, Any]) -> list[dict[str, Any]]:
    """Relations that narrow this slot's pick (it is their target)."""
    return [r for r in graph["relations"] if r.get("to") and r["to"]["slot"] == slot["name"]]


def _dep_ids(plan: dict[str, Any], built: dict[str, Any], var: str) -> str:
    key = next((i["key"] for i in plan["items"] if i.get("var") == var
                and i["kind"] in ("wildcard", "library")), None)
    b = built.get(key) if key else None
    return b["id"] if isinstance(b, dict) and isinstance(b.get("id"), str) else ""


def wired_payload(plan: dict[str, Any], key: str, built: dict[str, Any]) -> dict[str, Any]:
    """``{kind, payload, preview, warnings}`` for an item code writes from
    the graph: a fixed values, a constraint (both wildcards must be built,
    for their ids), a derivation or the template. Raises PlanError when a
    wildcard it needs isn't built yet."""
    graph = plan["graph"]
    item = next(i for i in plan["items"] if i["key"] == key)
    kind = item["kind"]
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
            if not r.get("to") or r["from"]["slot"] != src["name"] \
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
        branches = []
        otherwise = next((r["otherwise"] for r in rels if r.get("otherwise")), "")
        for r in rels:
            src = slot_by_var(graph, next(s["var"] for s in graph["slots"]
                                          if s["name"] == r["from"]["slot"]))
            branches.append({
                "condition": {"var": f"{src['var']}.{r['from']['axis']}", "op": "equals",
                              "value": r["from"]["value"]},
                "action": {"target_var": item["var"],
                           "mode": "replace" if r["kind"] == "derive" else "append",
                           "value": r["text"]},
            })
        rule: dict[str, Any] = {"id": "rule0001", "branches": branches}
        if otherwise:
            rule["else"] = {"action": {"target_var": item["var"], "mode": "replace",
                                       "value": otherwise}}
        return {"kind": kind, "payload": {"rules": [rule]},
                "preview": [_slot_rel_words(r) for r in rels], "warnings": []}
    if kind == "template":
        t = graph["template"]
        sep = ", " if graph["style"] == "tags" else ", "
        body = sep.join(x for x in [t["lead"], *(f"${v}" for v in t["order"]), t["tail"]] if x)
        return {"kind": kind, "payload": {"template_string": body,
                                         "negative_template": t["negative"] or ""},
                "preview": [body], "warnings": []}
    raise PlanError(f"{item['name']} isn't wired by the graph")


# --- the per-slot content call ----------------------------------------------

def slot_schema(graph: dict[str, Any], slot: dict[str, Any]) -> dict[str, Any]:
    """The JSON schema of one slot's options: ``text``, ``weight``,
    ``negative`` and a ``tags`` object with one key per axis, each an enum
    of that axis's values (a list of them on a classify axis, one on an
    accepts axis)."""
    kinds = axis_kinds(graph, slot)
    tag_props: dict[str, Any] = {}
    for a in slot["axes"]:
        enum = {"type": "string", "enum": list(a["values"])}
        if kinds[a["name"]] == "accepts" and not any(
                r["kind"] == "accepts" and r["from"]["slot"] == slot["name"]
                and r["from"]["axis"] == a["name"] for r in graph["relations"]):
            tag_props[a["name"]] = enum
        else:
            tag_props[a["name"]] = {"type": "array", "items": enum, "minItems": 1}
    option = _obj({"text": _STR, "weight": {"type": "number"}, "negative": _STR,
                   "tags": _obj(tag_props)})
    return _obj({"options": {"type": "array", "items": option}})


def compile_slot(
    graph: dict[str, Any], slot: dict[str, Any], answer: Any, *, limit: int | None = None,
) -> dict[str, Any]:
    """The model's options for one slot as a wildcard payload: tags from the
    ``tags`` object (every axis value an option names), tag groups from the
    slot's axes, a fallback chosen by code on a narrowed slot, and the
    ``sometimes_none`` share as a null option. Returns ``{payload, preview,
    warnings}``. Raises ValueError when no option is usable."""
    from engine.ai import wildcard as ai_wildcard
    from engine.modules.wildcard_handler import WildcardHandler

    if not isinstance(answer, dict) or not isinstance(answer.get("options"), list):
        raise ValueError("the model's answer wasn't a list of options")
    kinds = axis_kinds(graph, slot)
    values = {a["name"]: a["values"] for a in slot["axes"]}
    warnings: list[str] = []
    raw_options = []
    for o in answer["options"]:
        if not isinstance(o, dict):
            continue
        tags: list[str] = []
        picked = o.get("tags") if isinstance(o.get("tags"), dict) else {}
        missing = []
        for axis, allowed in values.items():
            got = picked.get(axis)
            got = got if isinstance(got, list) else [got] if isinstance(got, str) else []
            hit = [_tag(g) for g in got if _tag(g) in allowed]
            if kinds[axis] == "accepts" and len(hit) > 1 and not any(
                    r["kind"] == "accepts" and r["from"]["slot"] == slot["name"]
                    for r in graph["relations"]):
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
    compiled = ai_wildcard.compile_options(
        {"options": raw_options},
        existing_payload={"options": [], "sub_categories": [v for vs in values.values()
                                                             for v in vs]},
        limit=limit or slot["count"],
    )
    options = compiled["options"]
    if not options:
        raise ValueError("no usable options" + "".join(
            f"; {s['text'][:40]}: {s['reason']}" for s in compiled["skipped"][:3]))
    taken: set[str] = set()
    rows: list[dict[str, Any]] = []
    for o in options:
        row: dict[str, Any] = {"id": ai_wildcard.new_option_id(taken), "value": o["value"],
                               "weight": o["weight"], "sub_categories": o["tags"]}
        if o["negative"]:
            row["negative"] = o["negative"]
        rows.append(row)
    narrowed = inbound(graph, slot)
    if narrowed and rows:
        # The option that fits the most of what narrows this slot stands in
        # when a rule leaves nothing: it is never empty.
        axes_in = {r["to"]["axis"] for r in narrowed if r["to"].get("axis")}
        best = max(rows, key=lambda r: sum(1 for t in r["sub_categories"]
                                           if any(t in values[a] for a in axes_in
                                                  if a in values)))
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
    WildcardHandler.validate_payload(payload)
    warnings += [f"Left out {s['text'][:60]}: {s['reason']}" for s in compiled["skipped"][:8]]
    return {"payload": payload,
            "preview": [ai_wildcard.option_line(r) for r in rows], "warnings": warnings}


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
    if note.strip():
        lines.append(f"The last version had these problems; fix them: {note.strip()}")
    return "\n".join(lines)
