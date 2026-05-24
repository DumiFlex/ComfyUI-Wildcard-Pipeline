"""Reorder tags by sub_category bucket — tags mode + WP context only.

Stable sort:
  1. Build value → sub_category map from ctx.picks.
  2. Determine bucket order = first occurrence of each sub_category in
     ctx.picks iteration order.
  3. Tags whose value matches a picked option sort to their bucket's
     slot; unknown tags preserve relative order at the tail.

Returns stats.reordered = number of tags that moved from their
original position.
"""
from __future__ import annotations

from engine.cleaner.types import CleanerCtx, RuleResult


def apply(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    if ctx is None:
        return {"text": text, "stats": {}}
    if mode != "tags":
        return {"text": text, "stats": {"reordered": 0}}
    value_to_cat: dict[str, str] = {}
    cat_order: list[str] = []
    for pick in ctx.picks.values():
        v = pick.get("value")
        c = pick.get("sub_category")
        if not isinstance(v, str) or not isinstance(c, str):
            continue
        key = v.casefold()
        if key not in value_to_cat:
            value_to_cat[key] = c
        if c not in cat_order:
            cat_order.append(c)
    if not cat_order:
        return {"text": text, "stats": {"reordered": 0}}
    tags = [t.strip() for t in text.split(",") if t.strip()]
    cat_index = {c: i for i, c in enumerate(cat_order)}
    unknown_rank = len(cat_order)

    def rank(tag: str) -> int:
        cat = value_to_cat.get(tag.casefold())
        return cat_index.get(cat, unknown_rank) if cat is not None else unknown_rank

    indexed = list(enumerate(tags))
    sorted_tags = sorted(indexed, key=lambda pair: (rank(pair[1]), pair[0]))
    reordered = sum(1 for i, (orig_i, _) in enumerate(sorted_tags) if i != orig_i)
    new_tags = [tag for _, tag in sorted_tags]
    return {"text": ", ".join(new_tags), "stats": {"reordered": reordered}}
