"""Pack builder build notes: tag/vocab/repair notes, rolled reads, item
instances and `parse_built`."""
from __future__ import annotations

import copy
import re
from typing import Any

from engine.ai import use as ai_use
from engine.ai import vocab as ai_vocab
from engine.ai.pack._common import _HEX8, _STOP, _item, is_wild, module_type
from engine.modules.combine_handler import CombineHandler
from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.derivation_handler import DerivationHandler
from engine.modules.fixed_values_handler import FixedValuesHandler
from engine.modules.wildcard_handler import WildcardHandler


def item_texts(payload: dict[str, Any]) -> list[str]:
    """A built wildcard's option texts or fixed values' texts."""
    out = [o.get("value") for o in payload.get("options") or [] if isinstance(o, dict)]
    out += [v.get("value") for v in payload.get("values") or [] if isinstance(v, dict)]
    return [t for t in out if isinstance(t, str)]


def tag_check_note(plan: dict[str, Any], kind: str, payload: dict[str, Any],
                   lookup: ai_vocab.Lookup | None, kinds: set[str]) -> str:
    """Tags a built item's options use that the user's Danbooru list lacks
    (tag-style packs, while the tag lookup is on); "" when all are known.
    A note, not a repair: artist names and new tags are real too."""
    if plan.get("style") != "tags" or kind not in ("wildcard", "fixed_values"):
        return ""
    missing = ai_vocab.unknown_tags(lookup, kinds, item_texts(payload))
    if not missing:
        return ""
    shown = ", ".join(missing[:8]) + (f" and {len(missing) - 8} more" if len(missing) > 8
                                      else "")
    return f"Not in your Danbooru tag list: {shown}"


def item_vocab_note(plan: dict[str, Any], key: str, lookup: ai_vocab.Lookup | None,
                    kinds: set[str]) -> str:
    """Real tags for a tag-style wildcard's subject, for its build request."""
    item = _item(plan, key)
    if plan.get("style") != "tags" or item["kind"] not in ("wildcard", "fixed_values"):
        return ""
    # Prefix search: the subject's own words and the about's (``red`` finds
    # red_hair), the most telling first.
    text = f"{item['name']} {item['var']} {' '.join(item['tags'])} {item['about']}"
    words = [w for w in re.findall(r"[a-z]+", text.lower().replace("_", " "))
             if w not in _STOP][:16]
    return ai_vocab.vocab_note(lookup, kinds, words)


#: Compile warnings worth one automatic rebuild: the item doesn't fit the
#: rest of the pack (a rule tests a value or tag that isn't there).
_REPAIRABLE = re.compile(r"has no option|No option carries|unknown tag|nothing sets|"
                         r"already rolls|no rule is an only|joins picks with|"
                         r"isn't an option or tag|"
                         r"instead of reading|prints itself|options itself|"
                         r"line that joins picks|ends on its article|already joins|options at once|"
                         r"isn't set|not a variable|doesn't set|which no", re.I)


_VAR_GAP = re.compile(r"(\$[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)?)[ \t]+(?=\$[a-zA-Z_])")


def tag_commas(text: str) -> str:
    """Tags style: two variables side by side ("$hair $eyes") run their tags
    together ("long hair blue eyes"); a comma keeps them apart."""
    return _VAR_GAP.sub(r"\1, ", text)


_ANY_REF = re.compile(r"@\{([0-9a-f]{8})(?:[#:][^}]*)?\}")
_JUNK = re.compile(r"@@[A-Za-z_]+=\S*")


def _sibling_refs(plan: dict[str, Any], built: dict[str, Any], key: str,
                  payload: dict[str, Any]) -> list[str]:
    """Options that point at another wildcard the pack already rolls: the
    fresh pick can disagree with the one in the prompt ("night" weather on a
    daytime scene). Stray "@@KEY=value" text is dropped."""
    rolled = {built[i["key"]]["id"]: i for i in plan["items"]
              if is_wild(i) and i["key"] in built and i["key"] != key}
    hits: list[str] = []
    for o in payload.get("options") or []:
        if not isinstance(o, dict) or not isinstance(o.get("value"), str):
            continue
        if _JUNK.search(o["value"]):
            o["value"] = re.sub(r"\s{2,}", " ", _JUNK.sub("", o["value"])).strip(" ,") \
                or o["value"]
        for m in _ANY_REF.finditer(o["value"]):
            hit = rolled.get(m.group(1))
            if hit is not None and hit["name"] not in hits:
                hits.append(hit["name"])
    return [f"An option points at {n}, which the pack already rolls, so the two can "
            "disagree; describe it in words instead" for n in hits]


# A ref without a tag filter (``@{id}`` or ``@{id#Label}``).
_PLAIN_REF = re.compile(r"@\{([0-9a-f]{8})(?:#[^}:]*)?\}")


def read_rolled(plan: dict[str, Any], built: dict[str, Any],
                payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """A plain ``@{id}`` of one of the pack's own wildcards rolls it again,
    so a title can name a different class than the one picked. Rules and
    combines read the pick (``$var``) instead; a ref with a tag filter is a
    deliberate fresh pick and stays."""
    rolled = {built[i["key"]]["id"]: i for i in plan["items"]
              if is_wild(i) and i["key"] in built}
    said: list[str] = []

    def fix(node: Any) -> Any:
        if isinstance(node, str):
            def sub(m: re.Match[str]) -> str:
                hit = rolled.get(m.group(1))
                if hit is None:
                    return m.group(0)
                note = f"Reads ${hit['var']} instead of a new pick from {hit['name']}"
                if note not in said:
                    said.append(note)
                return f"${hit['var']}"
            return _PLAIN_REF.sub(sub, node)
        if isinstance(node, dict):
            return {k: fix(v) for k, v in node.items()}
        if isinstance(node, list):
            return [fix(v) for v in node]
        return node
    return fix(payload), said


def repair_note(warnings: list[str]) -> str:
    """The warnings a rebuild should fix, as its note; "" when none."""
    hits = [w for w in warnings if _REPAIRABLE.search(w)]
    return "; ".join(hits)[:600]


def _use_notes(item: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    _inst, notes = ai_use.parse_use(item["use"], kind=module_type(item),
                                    tags=payload.get("sub_categories") or [], payload=payload)
    return [f"Use: {n}" for n in notes]


def _option_texts(payload: dict[str, Any] | None) -> set[str]:
    return {" ".join(o["value"].split()).lower() for o in (payload or {}).get("options") or []
            if isinstance(o, dict) and isinstance(o.get("value"), str) and o["value"].strip()}


def _match_note(plan: dict[str, Any], built: dict[str, Any], item: dict[str, Any],
                payload: dict[str, Any]) -> list[str]:
    inst, _ = ai_use.parse_use(item["use"], kind="wildcard", payload=payload)
    mv = inst.get("match_variable")
    src = next((i for i in plan["items"] if is_wild(i) and i["var"] == mv
                and i["key"] in built), None)
    if src is None or _option_texts(payload) & _option_texts(built[src["key"]]["payload"]):
        return []
    return [f"Left out \"match ${mv}\": no option reads like one of {src['name']}'s, so "
            "it would never match; the constraints decide instead"]


def item_instance(item: dict[str, Any], payload: dict[str, Any] | None,
                  values: dict[str, set[str]] | None = None) -> dict[str, Any]:
    """The item's use line as the instance its bundle child carries.
    ``values`` (the pack's wildcards' option texts by variable) drops a
    "match $x" none of this wildcard's options can meet: every run would
    skip the match and its constraint (a hair style "matching" $hair_length
    when no style reads "long hair")."""
    if not item.get("use"):
        return {}
    tags = (payload or {}).get("sub_categories") if module_type(item) == "wildcard" else None
    inst, _notes = ai_use.parse_use(item["use"], kind=module_type(item), tags=tags,
                                    payload=payload)
    mv = inst.get("match_variable")
    if values and isinstance(mv, str) and mv in values and not (
            _option_texts(payload) & values[mv]):
        inst.pop("match_variable")
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
        item = next(i for i in plan["items"] if i["key"] == key)
        mid = item.get("id") or b.get("id")
        if not isinstance(mid, str) or not _HEX8.match(mid) or mid in ids:
            continue
        payload = b["payload"]
        try:
            if module_type(item) == "wildcard":
                WildcardHandler.validate_payload(payload)
            elif module_type(item) == "fixed_values":
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
                if module_type(i) == "wildcard" and i["key"] in out}
    for i in plan["items"]:
        b = out.get(i["key"])
        if i["kind"] == "constraint" and b is not None and not (
                b["payload"].get("source_wildcard_id") in wild_ids
                and b["payload"].get("target_wildcard_id") in wild_ids):
            del out[i["key"]]
    return out
