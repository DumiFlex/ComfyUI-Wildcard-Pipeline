"""Narrow model calls on a graph plan.

A whole re-plan asks a small model to decide the pack again, and it
decides differently each time. These calls ask for ONE part on its own
small schema, with the rest of the graph as read-only context, and the
code merges the answer into the graph and compiles the plan again:

- ``change`` (``/pack/change`` on a graph plan): one slot (with the
  relations that touch it), one fixed value, one item's relations or the
  template changed as the user asks; with no key, slots / fixed values /
  relations added.
- ``images`` (``/pack/images``): what reference images added after the
  first plan should become (slots, fixed values, ``from_images`` lines).

The changed slot is locked like a hand edit, so the next re-plan keeps it.
"""
from __future__ import annotations

import re
from typing import Any

from engine.ai.pack._common import _STRS, MAX_NAME, PlanError, _clean, _obj
from engine.ai.pack.graph import (
    FIXED_SCHEMA,
    GRAPH_SYSTEM,
    MAX_TEXT,
    RELATION_SCHEMA,
    SLOT_SCHEMA,
    TEMPLATE_SCHEMA,
    _content_words,
    _slot_rel_words,
    _stems,
    compile_graph_plan,
    graph_answer,
    parse_locks,
    raw_rel_sig,
    slot_never,
)
from engine.ai.pack.prompts import decisions_note, run_note, settings_note
from engine.ai.pack.settings import parse_run

CHANGE_SYSTEM = GRAPH_SYSTEM + """

Now you change ONE part of an existing pack graph, as the user asks, and \
answer with that part only; the rest of the graph stays as it is. Keep \
everything about the part the user didn't ask to change. Name slots, axes \
and values exactly as the graph lists them."""

IMAGES_SYSTEM = GRAPH_SYSTEM + """

Now the user added reference images to an existing pack graph. Answer \
with what they add: from_images (one short line per thing you took from \
them), slots the pack lacks for what they show (none for what a listed \
slot already covers), and fixed values for a look every prompt should \
carry. Nothing else; the rest of the graph stays as it is."""

_RELS = {"type": "array", "items": RELATION_SCHEMA}
_SLOTS = {"type": "array", "items": SLOT_SCHEMA}
_FIXEDS = {"type": "array", "items": FIXED_SCHEMA}
IMAGES_SCHEMA: dict[str, Any] = _obj({"from_images": _STRS, "slots": _SLOTS, "fixed": _FIXEDS})
MAX_IMAGE_SLOTS = 6


def graph_lines(plan: dict[str, Any]) -> list[str]:
    """The graph as the model reads it: every slot with its axes, the
    fixed values, the relations in words and the template."""
    g = plan["graph"]
    lines = [f"Pack: {g['title']}: {g['summary']}",
             f"Style: {g['style']}; rating: {g['rating']}; anchor: "
             f"{('$' + g['anchor']) if g['anchor'] else 'none'}"]
    note = run_note(parse_run(g["run"]))
    if note:
        lines.append(note)
    if g["sections"]:
        lines.append("Sections: " + ", ".join(s["name"] for s in g["sections"]))
    lines.append("Slots:")
    for s in g["slots"]:
        axes = "; ".join(f"{a['name']}: {', '.join(a['values'])}" for a in s["axes"]) \
            or "no axes"
        bits = [f"{s['count']} options", s["show"]]
        if s["pick"]:
            bits.append(f"pick {s['pick']}")
        if s["hold"]:
            bits.append("held")
        if s["section"]:
            bits.append(f"in {s['section']}")
        lines.append(f"- {s['name']} (${s['var']}): {s['what']} · {', '.join(bits)} · {axes}")
    if g["fixed"]:
        lines.append("Fixed values:")
        lines += [f"- {f['name']} (${f['var']}): {f['text']}"
                  + (f" · negative: {f['negative']}" if f.get("negative") else "")
                  for f in g["fixed"]]
    if g["relations"]:
        lines.append("Relations:")
        lines += [f"- {_slot_rel_words(r)}" for r in g["relations"]]
    t = g["template"]
    lines.append(f"Template: {t['lead']} | {', '.join(t['order'])} | {t['tail']}"
                 + (f" · negative: {t['negative']}" if t["negative"] else ""))
    if plan.get("decisions"):
        lines += ["", decisions_note(plan["decisions"])]
    lines += ["", settings_note(plan.get("settings") or {}, graph=True)]
    return lines


def _item(plan: dict[str, Any], key: str) -> dict[str, Any]:
    item = next((i for i in plan["items"] if i["key"] == key), None)
    if item is None:
        raise PlanError("no such item in the plan")
    return item


def change_target(plan: dict[str, Any], key: str) -> tuple[str, str]:
    """What a plan item is on the graph: ``("slot", var)``, ``("fixed",
    var)``, ``("relations", "src|dst")`` for a constraint, ``("relations",
    "$var")`` for a derivation the relations write, ``("template", "")``,
    or ``("add", "")`` with no key. A rule the code wires (the story beat,
    the model quality) can't be changed here."""
    if not key:
        return "add", ""
    item = _item(plan, key)
    g = plan["graph"]
    if item["kind"] == "wildcard" and any(s["var"] == item["var"] for s in g["slots"]):
        return "slot", item["var"]
    if item["kind"] == "fixed_values" and any(f["var"] == item["var"] for f in g["fixed"]):
        return "fixed", item["var"]
    if item["kind"] == "template":
        return "template", ""
    names = {s["var"]: s["name"] for s in g["slots"]}
    if item["kind"] == "constraint" and item["source"] in names and item["target"] in names:
        return "relations", f"{names[item['source']]}|{names[item['target']]}"
    if item["kind"] == "derivation" and any(r.get("var") == item["var"] for r in g["relations"]):
        return "relations", f"${item['var']}"
    raise PlanError(f"{item['name']} is wired by the code from the run and the settings; "
                    "change those instead")


def _touches(rel: dict[str, Any], what: str) -> bool:
    """Whether a raw relation (the model's shape) is the part ``what``
    names: a slot's name, "src|dst" or "$var"."""
    if what.startswith("$"):
        return rel.get("var") == what[1:] and rel.get("kind") in ("derive", "append")
    if "|" in what:
        src, dst = what.split("|", 1)
        return rel.get("from_slot") == src and rel.get("to_slot") == dst
    return what in (rel.get("from_slot"), rel.get("to_slot"))


def change_schema(plan: dict[str, Any], key: str) -> dict[str, Any]:
    kind, _what = change_target(plan, key)
    if kind == "slot":
        return _obj({"slot": SLOT_SCHEMA, "relations": _RELS})
    if kind == "fixed":
        return _obj({"fixed": FIXED_SCHEMA})
    if kind == "relations":
        return _obj({"relations": _RELS})
    if kind == "template":
        return _obj({"template": TEMPLATE_SCHEMA})
    return _obj({"slots": _SLOTS, "fixed": _FIXEDS, "relations": _RELS})


def change_prompt(plan: dict[str, Any], key: str, instruction: str) -> str:
    kind, what = change_target(plan, key)
    lines = graph_lines(plan) + [""]
    ask = instruction.strip()
    if kind == "slot":
        s = next(s for s in plan["graph"]["slots"] if s["var"] == what)
        lines += [f"Change the slot {s['name']} (${s['var']}) as the user asks, and answer "
                  "with the slot and the relations that touch it (every relation that "
                  "should still exist between it and another slot; the ones listed now that "
                  "touch it are replaced by your answer).", f"The user asks: {ask}"]
    elif kind == "fixed":
        f = next(f for f in plan["graph"]["fixed"] if f["var"] == what)
        lines += [f"Change the fixed value {f['name']} (${f['var']}) as the user asks.",
                  f"The user asks: {ask}"]
    elif kind == "relations":
        part = f"the rule writing {what}" if what.startswith("$") \
            else "the relations from {} to {}".format(*what.split("|", 1))
        lines += [f"Change {part} as the user asks; answer with the relations that replace "
                  "them (all of them, changed or not).", f"The user asks: {ask}"]
    elif kind == "template":
        lines += ["Change the template (lead, order of slot names, tail, negative) as the "
                  "user asks.", f"The user asks: {ask}"]
    else:
        lines += ["Add to the graph what the user asks: new slots (with axes), fixed values "
                  "and relations; nothing the graph already has.", f"The user asks: {ask}"]
    return "\n".join(lines)


def _rename(raw: dict[str, Any], old: str, new: str) -> None:
    """A slot renamed: relations and the template follow it by name."""
    if old == new:
        return
    for r in raw["relations"]:
        for k in ("from_slot", "to_slot"):
            if r.get(k) == old:
                r[k] = new
    raw["template"]["order"] = [new if o == old else o for o in raw["template"]["order"]]


def _recompile(plan: dict[str, Any], raw: dict[str, Any], lock_slots: list[str],
               touched: str = "", template_fields: list[str] | None = None,
               **kw: Any) -> dict[str, Any]:
    """The edited raw graph compiled as the plan again, with the hand-edit
    locks kept, the changed parts unlocked for this compile (so the change
    lands: the changed slots, the locked relations on the part ``touched``
    names, the template fields the answer set) and then locked again (so
    the next re-plan keeps them)."""
    locks = parse_locks(plan.get("locks"))
    old_rels = [r for r in graph_answer(plan)["relations"]
                if touched and _touches(r, touched)]
    freed = {raw_rel_sig(r) for r in old_rels} & set(locks["relations"])
    fields = set(template_fields or [])
    free = {**locks, "slots": [v for v in locks["slots"] if v not in lock_slots],
            "relations": [sig for sig in locks["relations"] if sig not in freed],
            "template": [f for f in locks["template"] if f not in fields]}
    new = compile_graph_plan(raw, previous={**plan, "locks": free},
                             settings=plan.get("settings"), decisions=plan.get("decisions"),
                             **kw)
    rel_locks = list(new["locks"]["relations"])
    if freed:
        # The user had locked a relation on this part and asked for the
        # change: what replaced it is theirs too.
        have = {raw_rel_sig(r) for r in graph_answer(new)["relations"]}
        rel_locks += [raw_rel_sig(r) for r in raw["relations"]
                      if isinstance(r, dict) and _touches(r, touched)
                      and raw_rel_sig(r) in have]
    new["locks"] = {**new["locks"],
                    "slots": list(dict.fromkeys(
                        [*locks["slots"], *(v for v in lock_slots
                                            if any(s["var"] == v
                                                   for s in new["graph"]["slots"]))])),
                    "relations": list(dict.fromkeys(rel_locks)),
                    "template": list(dict.fromkeys([*new["locks"]["template"],
                                                    *(f for f in locks["template"]
                                                      if f in fields)]))}
    return new


#: "drop fur", "remove the fur", "no more fur", "without fur": what goes.
_DROP = re.compile(r"\b(?:drop|remove|lose|cut|ban|exclude|no more|no|without|less|fewer|"
                   r"get rid of|take out)\s+(?:the\s+|any\s+|all\s+)?([a-z][a-z' -]{1,40})",
                   re.I)
#: "more sporty", "add a rain jacket", "with hats", "keep the fur": what stays or grows.
_MORE = re.compile(r"\b(?:more|add|adds|adding|with|keep|include|plus|extra|also)\s+"
                   r"(?:a\s+|an\s+|the\s+|some\s+)?([a-z][a-z' -]{1,40})", re.I)
#: The verbs that take a word out of a slot for good ("drop fur").
_DROP_LAND = re.compile(r"\b(?:drop|remove|lose|get rid of|take out|no more)\s+"
                        r"(?:the\s+|any\s+|all\s+)?([a-z][a-z' -]{1,40})", re.I)
#: What makes a dropped word a rule instead ("… in winter", "… when it rains").
_CONDITION = re.compile(r"(?:in|for|on|when|during|with|if|unless|at)\b", re.I)
_CUE_END = re.compile(r"\s*(?:,|\band\b|\bbut\b|\bfor\b|\bin\b|\bto\b|\bon\b|$)", re.I)


def _cue_words(rx: re.Pattern[str], instruction: str) -> set[str]:
    out: set[str] = set()
    for m in rx.finditer(instruction or ""):
        phrase = _CUE_END.split(m.group(1), maxsplit=1)[0]
        for w in _content_words(phrase):
            out |= _stems(w)
    return out


def against_ask(instruction: str, relations: list[dict[str, Any]],
                old: set[str]) -> tuple[list[dict[str, Any]], list[str]]:
    """New relations (signature not in ``old``) that go against what the
    user asked: an exclude or reduce on what they asked MORE of ("more
    sporty" became "winter never gets sporty shoes", 9B bench P3), a boost
    or only on what they asked to DROP. Those go; the rest stay. Returns
    the relations kept and the lines saying what went."""
    more, less = _cue_words(_MORE, instruction), _cue_words(_DROP, instruction)
    more -= less
    kept: list[dict[str, Any]] = []
    lines: list[str] = []
    for r in relations:
        if raw_rel_sig(r) in old:
            kept.append(r)
            continue
        kind = str(r.get("kind") or "")
        said: set[str] = set()
        for w in _content_words(" ".join([str(r.get("to_value") or ""),
                                          *(str(x) for x in r.get("words") or [])])):
            said |= _stems(w)
        if kind in ("exclude", "reduce") and said & more:
            lines.append(f"Left out a new \"{kind}\" on {r.get('to_slot')} "
                         f"{r.get('to_value')}: you asked for more of it")
            continue
        if kind in ("boost", "only") and said & less:
            lines.append(f"Left out a new \"{kind}\" on {r.get('to_slot')} "
                         f"{r.get('to_value')}: you asked to drop it")
            continue
        kept.append(r)
    return kept, lines


def land_drops(slot: dict[str, Any], instruction: str) -> list[str]:
    """What the user drops from a slot ("drop fur") is written on the slot
    as "Never: fur.", which every build, fill and repair of it keeps out
    (``graph.slot_never``): asked as words alone, the model invented a
    self-exclude and fur came back in the repair pass (9B bench P5)."""
    words = []
    for m in _DROP_LAND.finditer(instruction or ""):
        parts = _CUE_END.split(m.group(1), maxsplit=1)
        phrase = parts[0].strip(" '")
        rest = (instruction or "")[m.start(1) + len(parts[0]):].lstrip()
        # "drop sandals in winter" is a rule for a relation, not a word the
        # slot never has.
        if _CONDITION.match(rest):
            continue
        if phrase and len(phrase) >= 3 and len(phrase.split()) <= 3:
            words.append(phrase.lower())
    words = [w for w in dict.fromkeys(words) if w not in slot_never(slot)]
    if not words:
        return []
    what = str(slot.get("what") or "").rstrip(" .")
    slot["what"] = (f"{what}. Never: {', '.join(words)}." if what
                    else f"Never: {', '.join(words)}.")[:MAX_TEXT]
    return [f"{slot.get('name')}: never {', '.join(words)}, as you asked"]


def apply_change(plan: dict[str, Any], key: str, answer: Any, *, instruction: str = "",
                 **kw: Any) -> dict[str, Any]:
    """The plan with the model's answer merged into its graph and compiled
    again (``kw``: library, base, canvas, request). ``instruction`` (the
    user's words for this change) lands what the code can settle: words
    the user drops from a slot, and new relations against the ask go.
    Raises PlanError when the answer has no usable part."""
    if not isinstance(answer, dict):
        raise PlanError("the answer wasn't a change")
    kind, what = change_target(plan, key)
    raw = graph_answer(plan)
    old_sigs = {raw_rel_sig(r) for r in raw["relations"]}
    said: list[str] = []
    if instruction and isinstance(answer.get("relations"), list):
        answer = dict(answer)
        answer["relations"], said = against_ask(
            instruction, [r for r in answer["relations"] if isinstance(r, dict)], old_sigs)
    lock: list[str] = []
    touched = ""
    fields: list[str] = []
    if kind == "slot":
        slot = answer.get("slot")
        if not isinstance(slot, dict):
            raise PlanError("the answer had no slot")
        at = next(n for n, s in enumerate(raw["slots"]) if s["var"] == what)
        old = raw["slots"][at]["name"]
        new_name = _clean(slot.get("name"), MAX_NAME) or old
        raw["slots"][at] = {**slot, "var": what, "name": new_name}
        if instruction:
            said += land_drops(raw["slots"][at], instruction)
        _rename(raw, old, new_name)
        rels = [r for r in (answer.get("relations") or []) if isinstance(r, dict)] \
            if isinstance(answer.get("relations"), list) else None
        if rels is not None:
            raw["relations"] = [r for r in raw["relations"] if not _touches(r, new_name)] + rels
            touched = old
        lock = [what]
    elif kind == "fixed":
        fixed = answer.get("fixed")
        if not isinstance(fixed, dict):
            raise PlanError("the answer had no fixed value")
        at = next(n for n, f in enumerate(raw["fixed"]) if f["var"] == what)
        raw["fixed"][at] = {**fixed, "var": what}
    elif kind == "relations":
        rels = answer.get("relations")
        if not isinstance(rels, list):
            raise PlanError("the answer had no relations")
        raw["relations"] = [r for r in raw["relations"] if not _touches(r, what)] \
            + [r for r in rels if isinstance(r, dict)]
        touched = what
    elif kind == "template":
        tpl = answer.get("template")
        if not isinstance(tpl, dict):
            raise PlanError("the answer had no template")
        raw["template"] = {**raw["template"], **tpl}
        fields = [f for f in tpl if isinstance(f, str)]
    else:
        slots = [s for s in (answer.get("slots") or []) if isinstance(s, dict)]
        fixed = [f for f in (answer.get("fixed") or []) if isinstance(f, dict)]
        rels = [r for r in (answer.get("relations") or []) if isinstance(r, dict)]
        if not slots and not fixed and not rels:
            raise PlanError("the answer added nothing")
        lock = _add(raw, slots, fixed)
        raw["relations"] += rels
    new = _recompile(plan, raw, lock, touched=touched, template_fields=fields, **kw)
    if said:
        new["applied"] = [*new.get("applied", []), *said]
    return new


def _add(raw: dict[str, Any], slots: list[dict[str, Any]],
         fixed: list[dict[str, Any]]) -> list[str]:
    """New slots and fixed values added to the raw graph, skipping any the
    graph already has by variable or name; new slots join the template
    order. Returns the variables of the slots added."""
    have = {str(s.get("var") or "").lower() for s in raw["slots"]} \
        | {str(s.get("name") or "").lower() for s in raw["slots"]} \
        | {str(f.get("var") or "").lower() for f in raw["fixed"]} \
        | {str(f.get("name") or "").lower() for f in raw["fixed"]}
    added: list[str] = []
    for s in slots:
        var, name = str(s.get("var") or "").lower(), str(s.get("name") or "")
        if not name or var in have or name.lower() in have:
            continue
        raw["slots"].append(s)
        raw["template"]["order"].append(name)
        have |= {var, name.lower()}
        if var:
            added.append(var)
    for f in fixed:
        var, name = str(f.get("var") or "").lower(), str(f.get("name") or "")
        if not name or var in have or name.lower() in have:
            continue
        raw["fixed"].append(f)
        have |= {var, name.lower()}
    return added


def images_prompt(plan: dict[str, Any], note: str = "") -> str:
    lines = graph_lines(plan) + [""]
    if plan.get("from_images"):
        lines.append("Taken from the earlier images: " + "; ".join(plan["from_images"]))
    lines.append("The user added the attached reference images. What do they add to this "
                 "pack?" + (f" The user says: {note.strip()}" if note.strip() else ""))
    return "\n".join(lines)


def apply_images(plan: dict[str, Any], answer: Any, **kw: Any) -> dict[str, Any]:
    """The plan with what the images added merged into its graph: slots and
    fixed values the graph lacks, and the ``from_images`` lines."""
    if not isinstance(answer, dict):
        raise PlanError("the answer wasn't about the images")
    raw = graph_answer(plan)
    lines = [_clean(x, 200) for x in (answer.get("from_images") or [])
             if isinstance(x, str)] if isinstance(answer.get("from_images"), list) else []
    raw["from_images"] = list(dict.fromkeys([*raw["from_images"], *(x for x in lines if x)]))
    slots = [s for s in (answer.get("slots") or []) if isinstance(s, dict)][:MAX_IMAGE_SLOTS] \
        if isinstance(answer.get("slots"), list) else []
    fixed = [f for f in (answer.get("fixed") or []) if isinstance(f, dict)] \
        if isinstance(answer.get("fixed"), list) else []
    added = _add(raw, slots, fixed)
    new = _recompile(plan, raw, [], **kw)
    if added:
        names = [s["name"] for s in new["graph"]["slots"] if s["var"] in added]
        new["applied"] = [*new["applied"], "From your images: added " + ", ".join(names)]
    return new
