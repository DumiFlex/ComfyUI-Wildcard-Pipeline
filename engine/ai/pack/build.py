"""Pack builder build requests: per-item context and `item_request`."""
from __future__ import annotations

import copy
import re
from typing import Any

from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import fits as ai_fits
from engine.ai import guide as ai_guide
from engine.ai import library_vars, text_items
from engine.ai import refs as ai_refs
from engine.ai import wildcard as ai_wildcard
from engine.ai.pack import graph as pack_graph
from engine.ai.pack._common import _HEX8, PlanError, _item, is_wild, module_type
from engine.ai.pack.plan import _vocab
from engine.ai.pack.prompts import _score
from engine.ai.pack.settings import _words_of, parse_settings

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


def model_lines(plan: dict[str, Any], kind: str) -> str:
    """How the pack's image model reads a prompt (for items that write prompt
    text), and the adult-pack rules when the pack is rated nsfw."""
    out = ""
    fmt = ai_guide.format_line(plan.get("model") or "")
    if fmt and kind in ("wildcard", "fixed_values", "template"):
        out += f"\nThe image model: {fmt}"
    if plan.get("rating") == "nsfw" and kind in ("wildcard", "fixed_values", "template",
                                                 "derivation", "combine"):
        out += "\n" + ai_guide.NSFW.strip()
    return out


def negative_line(plan: dict[str, Any], kind: str) -> str:
    """What the pack's negatives setting asks of one item."""
    mode = parse_settings(plan.get("settings"))["negatives"]
    if kind == "template":
        return {
            "auto": " Write a standing negative in the pack's style (the usual defects for "
                    "the model: lowres, bad anatomy, watermark…) and put $negatives where "
                    "the option negatives go.",
            "template": " Write a standing negative in the pack's style and put $negatives "
                        "where any option negatives go.",
            "none": " The negative is just $negatives.",
        }[mode]
    if mode == "auto":
        return (" Give an option or value a negative only where it invites a specific mistake "
                "(\"short hair\" → long hair; \"night\" → daylight, sun); leave the rest empty.")
    return " Leave every negative empty."


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
            rows.append({"id": b["id"], "type": module_type(i), "name": i["name"],
                         "description": i["about"], "payload": b["payload"]})
    return rows


def _catalog(plan: dict[str, Any], built: dict[str, Any]) -> dict[str, dict[str, Any]]:
    cat = library_vars.build_catalog(_built_rows(plan, built), inputs=plan.get("inputs"),
                                     canvas=plan.get("canvas"))
    # Planned variables not built yet still count as known.
    for i in plan["items"]:
        if i["var"] and i["var"] not in cat and i["kind"] != "constraint":
            cat[i["var"]] = {"name": i["var"], "sources": [], "values": [], "tags": [],
                             "about": i["about"][:100], "axes": []}
    return cat


def ref_index(
    plan: dict[str, Any], built: dict[str, Any], library: list[dict[str, Any]] | None = None,
) -> ai_refs.RefIndex:
    """What an option may point at: the library's wildcards, then the pack's:
    built ones as they are, planned ones by their reserved id, name and
    planned tags (so an option can point at a wildcard built after it)."""
    idx = ai_refs.RefIndex([r for r in library or [] if r.get("type") == "wildcard"])
    for i in plan["items"]:
        if i["kind"] == "wildcard" and i["key"] not in built and _HEX8.match(i.get("id") or ""):
            idx.add({"id": i["id"], "type": "wildcard", "name": i["name"], "planned": True,
                     "payload": {"var_binding": i["var"] or None, "options": [],
                                 "sub_categories": list(i["tags"])}})
    for r in _built_rows(plan, built):
        if r["type"] == "wildcard":
            idx.add(r)
    return idx


def style_examples(plan: dict[str, Any], item: dict[str, Any],
                   library: list[dict[str, Any]] | None) -> str:
    """With the library setting on "inspire" (or "reuse" for a slot the
    library doesn't fill): a few options from the user's closest wildcard,
    as a style reference, not to copy."""
    if parse_settings(plan.get("settings"))["library"] == "new" or not library:
        return ""
    words = _words_of(f"{item['name']} {item['var'].replace('_', ' ')}")
    if not words:
        return ""
    best, score = None, 0
    for r in library:
        if r.get("type") != "wildcard" or not isinstance(r.get("payload"), dict):
            continue
        n = _score(r, words)
        if n > score:
            best, score = r, n
    if best is None:
        return ""
    opts = [o.get("value") for o in best["payload"].get("options") or []
            if isinstance(o, dict) and isinstance(o.get("value"), str)
            and "@{" not in o["value"]][:5]
    if not opts:
        return ""
    return (f" For style only (don't copy them), the user's wildcard {best.get('name')} "
            "has options like: " + "; ".join(o[:80] for o in opts) + ".")


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
    if row.get("type") == "fixed_values":
        preview = [f"${v.get('name')} = {v.get('value')}" for v in payload.get("values") or []
                   if isinstance(v, dict)]
        what = "fixed values"
    else:
        idx = ai_refs.RefIndex([r for r in library or [] if r.get("type") == "wildcard"])
        preview = [ai_wildcard.option_line(o, idx) for o in payload.get("options") or []]
        what = "wildcard"
    return {"key": key, "id": row["id"], "kind": "library", "payload": payload,
            "preview": preview, "warnings": [f"Uses your {what} {item['name']} as it is"]}


#: A retry after an answer ran past the output limit (a small model looping
#: on one phrase, or thinking too long) is asked cooler and shorter.
_CUT = re.compile(r"cut off|output limit", re.I)
CUT_RETRY = ("Your last answer ran past the output limit. Write the JSON straight away, "
             "short, and never repeat a phrase.")


def item_request(
    plan: dict[str, Any], key: str, built: dict[str, Any], note: str = "",
    library: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """``{system, user, schema, schema_name, temperature}`` for one item."""
    req = _item_request(plan, key, built, note, library)
    if _CUT.search(note or ""):
        req["user"] += "\n\n" + CUT_RETRY
        req["temperature"] = min(float(req.get("temperature", 0.8)), 0.2)
    return req


def _item_request(
    plan: dict[str, Any], key: str, built: dict[str, Any], note: str = "",
    library: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    item = _item(plan, key)
    kind = item["kind"]
    if kind == "library":
        raise PlanError(f"{item['name']} comes from the library; nothing to write")
    if pack_graph.slot_for(plan, key) is not None:
        return pack_graph.slot_request(plan, key, note, built)
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
            + negative_line(plan, "wildcard") + style_examples(plan, item, library)
            + "".join(f"\nUsed by: {c}" for c in consumers(plan, item))
            + ("\nSpell options exactly as the items above test them, and give them the "
               "tags those items key on." if consumers(plan, item) else "")
            + _siblings_line(plan, item) + model_lines(plan, kind) + fix,
            count=item["count"], name=item["name"], var_binding=item["var"],
            existing_options=[], tags=item["tags"], refs_text=pointers,
        )
        return {"system": ai_wildcard.spec_prompt(), "user": user,
                "schema": ai_wildcard.SPEC_SCHEMA, "schema_name": "wildcard",
                "temperature": 0.8}
    if kind == "derivation":
        idx = ref_index(plan, built, library)
        user = ai_derivation.build_prompt(
            instruction=item["about"] + model_lines(plan, kind) + fix, name=item["name"],
            catalog_text=library_vars.describe(_catalog(plan, built)),
            existing_rules=[], description=_pack_line(plan), refs_text=idx.describe(),
        )
        # A cut-off answer keeps the rules it finished (local models can
        # loop on these until the output cap).
        return {"system": ai_derivation.SYSTEM_PROMPT + _BRIEF, "user": user,
                "schema": ai_derivation.SCHEMA, "schema_name": "derivation_rules",
                "temperature": 0.3, "partial": True}
    if kind == "constraint":
        src, tgt = _constraint_sides(plan, item, built)
        sides = _fit_sides(plan, item, built)
        if sides is not None:
            # "A weapon that fits the class": a pick list per class, which
            # a small model gets right far more often than tag cells.
            (sw, sp), (tw, tp) = sides
            return {"system": ai_fits.SYSTEM_PROMPT, "user": ai_fits.build_prompt(
                about=item["about"], source_name=sw["name"], target_name=tw["name"],
                source=sp, target=tp, note=fix.strip()),
                "schema": ai_fits.SCHEMA, "schema_name": "constraint_fits",
                "temperature": 0.2}
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
        kind=kind, instruction=item["about"] + (
            negative_line(plan, kind) if kind in ("template", "fixed_values") else "")
        + model_lines(plan, kind) + fix,
        name=item["name"],
        catalog_text=library_vars.describe(cat), description=_pack_line(plan),
        out_var=item["var"] if kind in ("combine", "fixed_values") else "",
        others=owners(plan, key) if kind == "fixed_values" else None,
    )
    system, schema, name = {
        "fixed_values": (text_items.FIXED_SYSTEM, text_items.FIXED_SCHEMA, "fixed_values"),
        "combine": (text_items.COMBINE_SYSTEM, text_items.COMBINE_SCHEMA, "combine"),
        "template": (text_items.TEMPLATE_SYSTEM, text_items.TEMPLATE_SCHEMA, "template"),
    }[kind]
    return {"system": system, "user": user, "schema": schema, "schema_name": name,
            "temperature": 0.4}


def _strip_sibling_picks(plan: dict[str, Any], built: dict[str, Any], item: dict[str, Any],
                         payload: dict[str, Any]) -> list[str]:
    """Take out of this wildcard's options the pieces that are whole options
    of another of the pack's wildcards (a hair style "long hair, high
    ponytail" next to a Hair Length that picks "long hair"), and a piece an
    option says twice: the prompt would show both picks, and they disagree.
    Changes ``payload`` in place; an option that would be left with nothing
    stays as it was."""
    others: dict[str, str] = {}
    for i in plan["items"]:
        if not is_wild(i) or i["key"] == item["key"] or i["key"] not in built \
                or not i["var"] or i["var"] == item["var"]:
            continue
        for o in built[i["key"]]["payload"].get("options") or []:
            text = " ".join(str(o.get("value") or "").split()).lower()
            if isinstance(o, dict) and not o.get("is_null") and len(text) >= 3 \
                    and "," not in text and "@{" not in text:
                others.setdefault(text, i["name"])
    taken: dict[str, list[str]] = {}
    kept: list[dict[str, Any]] = []
    doubled = 0
    for o in payload.get("options") or []:
        value = o.get("value")
        # A whole option the same as another wildcard's is left alone (two
        # colour picks may both offer "red"): only a piece of a longer one.
        if o.get("is_null") or not isinstance(value, str) or "," not in value:
            kept.append(o)
            continue
        out: list[str] = []
        gone: list[tuple[str, str]] = []
        seen: set[str] = set()
        twice = 0
        for piece in (p.strip() for p in value.split(",")):
            low = " ".join(piece.split()).lower()
            if not low:
                continue
            if low in others:
                gone.append((others[low], piece))
            elif low in seen:
                twice += 1
            else:
                seen.add(low)
                out.append(piece)
        if not out or (not gone and not twice):
            kept.append(o)
            continue
        for name, piece in gone:
            taken.setdefault(name, []).append(piece)
        doubled += twice
        kept.append({**o, "value": ", ".join(out)})
    if not taken and not doubled:
        return []
    payload["options"] = kept
    said = []
    for name, pieces in taken.items():
        quoted = ", ".join('"' + p + '"' for p in dict.fromkeys(pieces))
        said.append(f"Took {quoted[:120]} out of the options: {name} picks that")
    if doubled:
        said.append(f"Took out {doubled} piece(s) an option said twice")
    return said


def _siblings_line(plan: dict[str, Any], item: dict[str, Any]) -> str:
    """The pack's other picks, so a hair style wildcard doesn't also roll
    hair length or colour (the prompt then says both, and they disagree)."""
    others = [i for i in plan["items"] if is_wild(i) and i["key"] != item["key"]]
    if not others or not item["var"]:
        return ""
    return ("\nOther picks in this pack (each covers its own subject, so leave those out "
            "of these options): " + "; ".join(
                f"{i['name']} (${i['var']})" for i in others[:16]) + ".")


_BRIEF = ("\n\nWrite each rule and each branch once, then stop: an answer that repeats "
          "itself is cut off.")


def owners(plan: dict[str, Any], key: str) -> dict[str, str]:
    """Each variable another plan item sets as its main one → that item's
    name. A fixed values preset must leave these alone: setting $hair_style
    there too overwrites (or is overwritten by) the Hair Style wildcard."""
    return {i["var"]: i["name"] for i in plan["items"]
            if i["key"] != key and i["var"] and i["kind"] not in ("constraint", "template")}


def _fit_sides(plan: dict[str, Any], item: dict[str, Any], built: dict[str, Any],
               ) -> tuple[tuple[dict[str, Any], dict[str, Any]],
                          tuple[dict[str, Any], dict[str, Any]]] | None:
    """((source item, payload), (target item, payload)) when the constraint
    is a plain "fits" rule `ai_fits` writes, else None."""
    by_var = {i["var"]: i for i in plan["items"] if is_wild(i)}
    s, t = by_var.get(item["source"]), by_var.get(item["target"])
    if s is None or t is None or s["key"] not in built or t["key"] not in built:
        return None
    sp, tp = built[s["key"]]["payload"], built[t["key"]]["payload"]
    if not ai_fits.applies(item["about"], sp, tp):
        return None
    return (s, sp), (t, tp)


def _constraint_sides(
    plan: dict[str, Any], item: dict[str, Any], built: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    by_var = {i["var"]: i for i in plan["items"] if is_wild(i)}
    sides = []
    for var, prefix in ((item["source"], "S"), (item["target"], "T")):
        w = by_var.get(var)
        b = built.get(w["key"]) if w else None
        if not w or not isinstance(b, dict):
            raise PlanError(f"build ${var} before {item['name']}")
        sides.append(ai_constraint.side_view(_wildcard_view(w, b), prefix))
    return sides[0], sides[1]
