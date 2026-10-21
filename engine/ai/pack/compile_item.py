"""Pack builder: `compile_item` turns one model answer into a checked payload."""
from __future__ import annotations

import json
import re
from typing import Any

from engine.ai import adult as ai_adult
from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import fits as ai_fits
from engine.ai import text_items
from engine.ai import wildcard as ai_wildcard
from engine.ai.pack import graph as pack_graph
from engine.ai.pack._common import _HEX8, _item, is_wild, new_id
from engine.ai.pack.build import (
    _catalog,
    _constraint_sides,
    _fit_sides,
    _strip_sibling_picks,
    owners,
    ref_index,
)
from engine.ai.pack.build_notes import (
    _match_note,
    _sibling_refs,
    _use_notes,
    read_rolled,
    repair_note,
    tag_commas,
)
from engine.ai.pack.settings import parse_settings
from engine.ai.pack.text_fixes import (
    _ARTICLE_PICK,
    _PLACEHOLDER,
    _append_onto_nothing,
    _bare_join,
    _combine_notes,
    _dangling,
    _drop_double_reads,
    _fold_case_reads,
    _kin_options,
    _lead_with_anchor,
    _list_options,
    _plan_only_withs,
    _plan_onlys,
    _plan_prose,
    _second_rolls,
    _snake_text,
    _strict_rules,
    _wrap_pipes,
)
from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.derivation_handler import NEGATIVE_MODES, DerivationHandler, clause_actions
from engine.modules.wildcard_handler import WildcardHandler


def _quality_otherwise(plan: dict[str, Any], item: dict[str, Any], payload: dict[str, Any]
                       ) -> tuple[dict[str, Any], list[str]]:
    """The per-family quality rule the code wires gets an "otherwise": the
    pack's own quality words (the preset the rule replaced, else the
    style's usual ones). The model wrote it without one, so with no WP
    Model Info $quality was never set and the template read nothing (9B,
    2026-10-21, 9 packs)."""
    graph = plan.get("graph")
    if not isinstance(graph, dict) or item.get("var") != pack_graph.QUALITY_VAR:
        return payload, []
    rules = payload.get("rules") or []
    if not rules or any(isinstance(r, dict) and r.get("else") for r in rules):
        return payload, []
    words = graph.get("quality_words") or (
        "masterpiece, best quality" if graph.get("style") == "tags"
        else "high quality, detailed")
    first = {**rules[0], "else": {"action": {"target_var": item["var"], "mode": "replace",
                                             "value": words}}}
    return ({**payload, "rules": [first, *rules[1:]]},
            [f"Added an otherwise, \"{words}\": with no model variable set, $quality still "
             "has the pack's quality words"])


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
    # The id reserved when the plan was made, so refs and constraints that
    # point at it before it is built stay right.
    mid = item.get("id") if _HEX8.match(item.get("id") or "") else (
        item_id if _HEX8.match(item_id or "") else new_id(
            taken | {r["id"] for r in library or [] if isinstance(r.get("id"), str)}))
    warnings: list[str] = []
    preview: list[str] = []
    if kind == "wildcard":
        idx = ref_index(plan, {k: v for k, v in built.items() if k != key}, library)
        slot = pack_graph.slot_for(plan, key)
        if slot is not None:
            compiled = pack_graph.compile_slot(
                plan["graph"], slot, answer, existing=(built.get(key) or {}).get("payload"),
                others=pack_graph.other_texts(plan, built, key),
                refs=pack_graph.draw_refs(plan, built))
        else:
            compiled = ai_wildcard.compile_spec(
                answer, var=item["var"] or None, refs=idx, self_id=mid, limit=item["count"],
                existing_payload={"options": [], "sub_categories": list(item["tags"])},
            )
        payload = compiled["payload"]
        if plan.get("style") != "tags":
            # Booru tags are written with underscores on purpose.
            warnings += _snake_text(payload.get("options") or [])
        warnings += _kin_options(plan, item, payload)
        used = {t for o in payload["options"] for t in o.get("sub_categories") or []}
        payload["sub_categories"] = [t for t in payload["sub_categories"] if t in used
                                     or t in {x for v in (payload.get("tag_groups") or {})
                                              .values() for x in v}]
        warnings += _wrap_pipes(payload.get("options") or [])
        warnings += _strip_sibling_picks(plan, built, item, payload)
        lists = _list_options(payload["options"])
        if lists and len(lists) < len(payload["options"]):
            payload["options"] = [o for o in payload["options"] if o not in lists]
            warnings.append(f"Left out \"{lists[0]['value'][:40]}…\": one option that lists "
                            "the others prints them all at once")
        empty = [o for o in payload["options"] if isinstance(o.get("value"), str)
                 and _PLACEHOLDER.search(o["value"])]
        if empty and len(empty) < len(payload["options"]):
            payload["options"] = [o for o in payload["options"] if o not in empty]
            warnings.append(f"Left out \"{empty[0]['value'][:40]}\": an option that means "
                            "\"nothing\" prints those words")
        WildcardHandler.validate_payload(payload)
        missing = [t for t in item["tags"] if t not in used]
        if missing:
            warnings.append("No option carries #" + ", #".join(missing))
        warnings += _sibling_refs(plan, built, key, payload)
        warnings += compiled["warnings"]
        preview = [ai_wildcard.option_line(o, idx) for o in payload["options"]]
        if item["use"]:
            warnings += _use_notes(item, payload)
            warnings += _match_note(plan, built, item, payload)
    elif kind == "derivation":
        compiled = ai_derivation.compile_rules(answer, catalog=_catalog(plan, built),
                                               refs=ref_index(plan, built, library))
        if not compiled["rules"]:
            raise ValueError("no usable rules" + "".join(
                f"; {s['text'][:40]}: {s['reason']}" for s in compiled["skipped"][:3]))
        rules: list[dict[str, Any]] = []
        seen_rules: set[str] = set()
        for r in compiled["rules"]:
            # A model stuck in a loop writes the same rule (or branch) again.
            r["rule"]["branches"] = list({json.dumps(b, sort_keys=True): b for b in
                                          r["rule"].get("branches") or []}.values())
            same = json.dumps({k: v for k, v in r["rule"].items() if k != "id"},
                              sort_keys=True)
            if same not in seen_rules:
                seen_rules.add(same)
                rules.append(r["rule"])
        payload = {"rules": rules}
        payload, said = _quality_otherwise(plan, item, payload)
        warnings += said
        from engine.ai import pack_tidy
        payload, joined = pack_tidy.merge_lookup(payload)
        warnings += joined
        if isinstance(answer, dict) and answer.get("_cut_off"):
            warnings.append("The answer was cut off at the output limit; kept the rules it "
                            "finished")
        payload, said = read_rolled(plan, built, payload)
        warnings += said
        warnings += _append_onto_nothing(plan, key, built, payload)
        warnings += _second_rolls(plan, payload, built)
        DerivationHandler.validate_payload(payload)
        preview = [ai_derivation.describe_rule(r) for r in payload["rules"]]
        warnings += list(dict.fromkeys(w for r in compiled["rules"] for w in r["warnings"]))
        warnings += [f"Left out {s['text'][:60]}: {s['reason']}"
                     for s in compiled["skipped"][:5]]
    elif kind == "constraint" and isinstance(answer, dict) and "fits" in answer:
        sides = _fit_sides(plan, item, built)
        if sides is None:
            raise ValueError("this rule isn't a fits rule any more; build it again")
        (sw, sp), (tw, tp) = sides
        exceptions, warnings = ai_fits.compile_answer(answer, source=sp, target=tp)
        payload = {"source_wildcard_id": built[sw["key"]]["id"],
                   "target_wildcard_id": built[tw["key"]]["id"],
                   "matrix": {}, "exceptions": exceptions}
        ConstraintHandler.validate_payload(payload)
        per: dict[str, list[str]] = {}
        for e in exceptions:
            per.setdefault(e["source"], []).append(e["target"])
        preview = [f"{a} → only {', '.join(b)}" for a, b in per.items()]
    elif kind == "constraint":
        src, tgt = _constraint_sides(plan, item, built)
        compiled = ai_constraint.compile_rules(answer, source=src, target=tgt)
        matrix: dict[str, dict[str, Any]] = {}
        for c in compiled["cells"]:
            matrix.setdefault(c["source_tag"], {})[c["target_tag"]] = c["cell"]
        kept_only = _plan_onlys(item, src, tgt, matrix)
        kept_only += _plan_only_withs(item, src, tgt, matrix)
        if kept_only:
            warnings.append("Kept the plan's " + ", ".join(kept_only[:4])
                            + (" and more" if len(kept_only) > 4 else "")
                            + " as only rules, as it says")
        if not matrix and not compiled["exceptions"]:
            raise ValueError("no usable rules" + "".join(
                f"; {s['text'][:40]}: {s['reason']}" for s in compiled["skipped"][:3]))
        by_var = {i["var"]: i for i in plan["items"] if is_wild(i)}
        payload = {
            "source_wildcard_id": built[by_var[item["source"]]["key"]]["id"],
            "target_wildcard_id": built[by_var[item["target"]]["key"]]["id"],
            "matrix": matrix, "exceptions": [e["exception"] for e in compiled["exceptions"]],
        }
        warnings += _strict_rules(item, payload, src)
        ConstraintHandler.validate_payload(payload)
        preview = [f"#{st} → #{tt}: {cell['mode']}" for st, row in payload["matrix"].items()
                   for tt, cell in row.items()] + [
            f"{e['exception']['source']} → {e['exception']['target']}: "
            f"{e['exception']['mode']}" for e in compiled["exceptions"]]
        warnings += [f"Left out {s['text'][:60]}: {s['reason']}"
                     for s in compiled["skipped"][:5]]
    elif kind == "fixed_values":
        out = text_items.compile_fixed(answer)
        payload, preview, warnings = out["payload"], out["preview"], out["warnings"]
        # Values another item already sets are left out: two writers of one
        # variable means one overwrites the other.
        own = owners(plan, key)
        kept = [v for v in payload["values"] if v["name"] not in own]
        for v in payload["values"]:
            if v["name"] in own:
                warnings.append(f"Left out ${v['name']}: {own[v['name']]} sets it")
        if not kept:
            raise ValueError("every value it set is set by another item")
        if len(kept) != len(payload["values"]):
            payload = {**payload, "values": kept}
            preview = [p for p in preview if not any(p.startswith(f"${n} = ") for n in own)]
        warnings += _wrap_pipes(payload["values"])
        if plan.get("style") != "tags":
            warnings += _snake_text(payload["values"])
        names = [v["name"] for v in payload["values"]]
        if item["var"] not in names:
            warnings.append(f"It doesn't set ${item['var']}")
    elif kind == "combine":
        cat = _catalog(plan, built)
        out = text_items.compile_combine(answer, out_var=item["var"], catalog=cat)
        payload, preview, warnings = out["payload"], out["preview"], out["warnings"]
        payload, said = read_rolled(plan, built, payload)
        bare = _ARTICLE_PICK.sub("", payload["template"])
        if bare != payload["template"]:
            # "{a|b} $outerwear" printed "a a heavy parka" / "b".
            payload = {**payload, "template": re.sub(r"\s{2,}", " ", bare).strip()}
            said.append("Took out a {a|b} pick of single letters or articles: it printed "
                        "\"a a\" or a stray letter")
        text, fixed = _plan_prose(payload["template"])
        text, more = _dangling(text, plan, item, built)
        text, fold = _fold_case_reads(text, plan, built)
        more += fold
        if plan.get("style") != "tags":
            text, joined = _bare_join(text, plan, built)
            more += joined
        if text != payload["template"]:
            payload = {**payload, "template": text}
        said += fixed + more
        warnings = [*warnings, *said, *_combine_notes(plan, item, payload, built)]
        if plan.get("style") == "tags":
            payload = {**payload, "template": tag_commas(payload["template"])}
    else:
        out = text_items.compile_template(answer, catalog=_catalog(plan, built))
        payload, preview, warnings = out["payload"], out["preview"], out["warnings"]
        payload, said = _drop_double_reads(plan, built, payload)
        text, fixed = _plan_prose(payload["template_string"])
        text, more = _dangling(text, plan, item, built)
        text, lead = _lead_with_anchor(text, plan, built)
        more += lead
        text, fold = _fold_case_reads(text, plan, built)
        more += fold
        if text != payload["template_string"]:
            payload = {**payload, "template_string": text}
        warnings = [*warnings, *said, *fixed, *more]
        if plan.get("style") == "tags":
            payload = {**payload, "template_string": tag_commas(payload["template_string"])}
    if plan.get("rating") == "nsfw":
        payload, said = _adult_check(kind, payload, plan)
        warnings += said
    repair = repair_note(warnings)
    return {"key": key, "id": mid, "kind": kind, "payload": payload,
            "preview": preview, "warnings": warnings, "repair": repair,
            "fill": pack_graph.fills(plan, key, repair)}


def _adult_check(kind: str, payload: dict[str, Any],
                 plan: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """An nsfw pack's item. The pack is a sexual context, so text with a
    clearly minor word (child, loli, "16 years old") is left out, as
    `adult.sexual_minor` does everywhere (ValueError, so the item is
    rebuilt, when nothing would be left). Words an adult can wear or be
    called too (school uniform, teen) stay, with a warning for the user to
    judge. The template's negative gets the youth block while the
    youth_negative setting is on."""
    why = "an adult pack never names a minor"
    said: list[str] = []

    def keep(rows: list[Any], text: Any, noun: str) -> list[Any]:
        bad = [r for r in rows if ai_adult.minor_words(text(r))]
        kept = [r for r in rows if r not in bad]
        if bad and not kept:
            raise ValueError(f"every {noun} names a minor; {why}")
        if bad:
            words = ", ".join(dict.fromkeys(w for r in bad for w in ai_adult.minor_words(text(r))))
            more = f" and {len(bad) - 1} more" if len(bad) > 1 else ""
            said.append(f"Left out \"{text(bad[0])[:40]}\"{more}: {why} ({words})")
        return kept

    def writes(rule: dict[str, Any]) -> str:
        clauses = [*(rule.get("branches") or []), rule.get("else")]
        return ", ".join(str(a.get("value") or "") for c in clauses for a in clause_actions(c)
                         if a.get("mode") not in NEGATIVE_MODES)

    texts: list[str] = []
    if kind == "wildcard":
        real = [o for o in payload.get("options") or [] if not o.get("is_null")]
        kept = keep(real, lambda o: str(o.get("value") or ""), "option")
        if len(kept) < len(real):
            payload = {**payload, "options": [o for o in payload["options"]
                                              if o.get("is_null") or o in kept]}
            WildcardHandler.validate_payload(payload)
        texts = [str(o.get("value") or "") for o in kept]
    elif kind == "fixed_values":
        rows = payload.get("values") or []
        kept = keep(rows, lambda v: str(v.get("value") or ""), "value")
        if len(kept) < len(rows):
            payload = {**payload, "values": kept}
        texts = [str(v.get("value") or "") for v in kept]
    elif kind == "derivation":
        rows = payload.get("rules") or []
        kept = keep(rows, writes, "rule")
        if len(kept) < len(rows):
            payload = {**payload, "rules": kept}
        texts = [writes(r) for r in kept]
    elif kind in ("combine", "template"):
        text = str(payload.get("template" if kind == "combine" else "template_string") or "")
        if ai_adult.minor_words(text):
            raise ValueError(f"it names a minor; {why}")
        texts = [text]
    flagged = [t for t in texts if ai_adult.youth_words(t)]
    if flagged:
        words = ", ".join(dict.fromkeys(w for t in flagged for w in ai_adult.youth_words(t)))
        more = f" and {len(flagged) - 1} more" if len(flagged) > 1 else ""
        said.append(f"Check \"{flagged[0][:40]}\"{more}: it says {words} in an adult pack. "
                    "Make sure every character reads as an adult")
    if kind == "template" and parse_settings(plan.get("settings"))["youth_negative"] == "on":
        neg, added = ai_adult.with_youth_negative(str(payload.get("negative_template") or ""),
                                                  plan.get("style") or "tags")
        if added:
            payload = {**payload, "negative_template": neg}
            said.append("Added " + ", ".join(added) + " to the negative: the pack is rated "
                        "nsfw (Settings > Youth negative)")
    return payload, said
