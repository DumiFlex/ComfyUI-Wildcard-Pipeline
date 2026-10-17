"""Pack builder: extend an existing bundle ("Extend with AI")."""
from __future__ import annotations

from typing import Any

from engine.ai.pack._common import MAX_ABOUT, MAX_NAME, _clean, new_id
from engine.ai.pack.install import _child, _new_modules, collection_tag
from engine.ai.pack.layout import _extend_layout, _module_name, _module_sets
from engine.ai.pack.plan import REUSABLE, _row_var

#: Bundle lines the planner sees when extending one.
MAX_BASE_LINES = 60


def bundle_base(bundle: dict[str, Any], bundles: list[dict[str, Any]],
                library: list[dict[str, Any]] | None) -> dict[str, Any]:
    """What "Extend with AI" knows about the bundle it adds to: ``{id, name,
    nested, row, subs: {name: bundle row}, modules: [(child, sub name)],
    items, sets: {var: module name}}``. ``items`` are its wildcards and
    fixed values that are in the library, as ``existing`` plan items, so
    constraints and refs can use them; ``nested``: another bundle holds it,
    so it can't hold sub-bundles itself."""
    by_id = {b["id"]: b for b in bundles if isinstance(b, dict)}
    nested = any(isinstance(c, dict) and c.get("type") == "bundle" and c.get("id") == bundle["id"]
                 for b in bundles for c in b.get("children") or [])
    lib = {r["id"]: r for r in library or [] if isinstance(r.get("id"), str)}
    modules: list[tuple[dict[str, Any], str]] = []
    subs: dict[str, dict[str, Any]] = {}
    for c in bundle.get("children") or []:
        if not isinstance(c, dict):
            continue
        if c.get("type") == "bundle":
            sub = by_id.get(c.get("id"))
            if sub is None:
                continue
            subs[sub["name"]] = sub
            modules += [(m, sub["name"]) for m in sub.get("children") or []
                        if isinstance(m, dict) and m.get("type") != "bundle"
                        and isinstance(m.get("payload"), dict)]
        elif isinstance(c.get("payload"), dict):
            modules.append((c, ""))
    items: list[dict[str, Any]] = []
    sets: dict[str, str] = {}
    for m, sub in modules:
        for v in _module_sets(m):
            sets.setdefault(v, _module_name(m))
        row = lib.get(m.get("id"))
        if m.get("type") not in REUSABLE or row is None:
            continue
        var = _row_var(row)
        if not var or any(x["var"] == var for x in items):
            continue
        items.append({
            "key": f"e{len(items) + 1}", "id": row["id"], "kind": "library",
            "name": _clean(row.get("name"), MAX_NAME) or var, "var": var, "section": sub,
            "about": _clean(row.get("description"), MAX_ABOUT), "count": 0,
            "tags": [t for t in row["payload"].get("sub_categories") or []
                     if isinstance(t, str)][:16] if row["type"] == "wildcard" else [],
            "source": "", "target": "", "use": "", "library_id": row["id"],
            "library_type": row["type"], "existing": True,
        })
    return {"id": bundle["id"], "name": str(bundle.get("name") or ""), "nested": nested,
            "row": bundle, "subs": subs, "modules": modules, "items": items, "sets": sets}


def base_note(base: dict[str, Any]) -> str:
    """The bundle being extended, for the planner."""
    lines = [f'You are EXTENDING the bundle "{base["name"]}". It already holds, in run order:']
    for m, sub in base["modules"][:MAX_BASE_LINES]:
        sets = _module_sets(m)
        tags = (m.get("payload") or {}).get("sub_categories") if m.get("type") == "wildcard" \
            else None
        bits = [m.get("type", "module")]
        if sets:
            bits.append("sets $" + ", $".join(sets[:4]))
        if tags:
            bits.append("tags " + ", ".join(str(t) for t in tags[:8]))
        lines.append(f"- {_module_name(m)} ({'; '.join(bits)})" + (f" [in {sub}]" if sub else ""))
    if len(base["modules"]) > MAX_BASE_LINES:
        lines.append(f"- … and {len(base['modules']) - MAX_BASE_LINES} more")
    lines += [
        "Plan ONLY what to add. Don't list what it already holds: those items are added to "
        "the plan for you. Its variables are already set: read them freely, and never plan "
        "a module that sets one of them again.",
        "Constraints may use its wildcards as source or target, and new options may point "
        "at its wildcards.",
    ]
    if base["nested"]:
        lines.append("It sits inside another bundle, so it can't hold sub-bundles: leave "
                     "every section empty.")
    elif base["subs"]:
        lines.append("To put a new item in one of its sub-bundles, use that sub-bundle's name "
                     "as the section (" + ", ".join(base["subs"]) + "); a new section "
                     "becomes a new sub-bundle.")
    return "\n".join(lines)


def extend_ops(
    plan: dict[str, Any], built: dict[str, Any], base: dict[str, Any], *, taken: set[str],
    template_ids: set[str], bundle_ids: set[str],
) -> dict[str, Any]:
    """An import commit that adds the new items to the bundle: new modules
    and sub-bundles are added, and the bundle (and any of its sub-bundles
    that gain items) is replaced with its new children, so one undo puts
    it back. Items go in their section's sub-bundle, a new section makes a
    new one, the rest go in the bundle itself; a new constraint on one of
    its wildcards goes just before that wildcard."""
    tag = collection_tag(plan["title"])
    new = _new_modules(plan, built, taken=taken, template_ids=template_ids, tag=tag)
    fixed, adds, used = new["fixed"], new["adds"], new["used"]
    lay = _extend_layout(plan, fixed, base)
    taken_bundles = set(bundle_ids) | used
    about = {s["name"]: s.get("about", "") for s in plan.get("sections") or []}

    def kids(seq: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [_child(m) if "_uid" in m else m for m in seq]
    made: dict[str, dict[str, Any]] = {}
    for sec, seq in lay["made"].items():
        sid = new_id(taken_bundles)
        taken_bundles.add(sid)
        made[sec] = {"id": sid, "name": f"{base['name']} · {sec}"[:MAX_NAME],
                     "description": about.get(sec) or f"{sec} of {base['name']}",
                     "tags": [tag], "children": kids(seq), "content_rating": plan["rating"]}
        adds.append({"kind": "bundle", "entity": made[sec]})
    outer = []
    for c in lay["outer"]:
        if c.get("type") == "bundle" and "section" in c:
            b = made[c["section"]]
            outer.append({"id": b["id"], "type": "bundle", "name": b["name"], "color": None})
        else:
            outer.append(_child(c) if "_uid" in c else c)

    def content(row: dict[str, Any], children: list[Any]) -> dict[str, Any]:
        out = {"name": row["name"], "description": row.get("description") or "",
               "color": row.get("color"), "category_id": row.get("category_id"),
               "tags": list(dict.fromkeys([*(row.get("tags") or []), tag])),
               "is_favorite": bool(row.get("is_favorite")), "children": children}
        # NSFW items make the bundle NSFW; a safe plan leaves its rating be.
        if plan["rating"] == "nsfw":
            out["content_rating"] = "nsfw"
        return out
    replaces = [{"kind": "bundle", "id": base["subs"][name]["id"],
                 "new_content": content(base["subs"][name], kids(lay["subs"][name]))}
                for name in lay["subs"] if name in lay["changed"]]
    replaces.append({"kind": "bundle", "id": base["id"],
                     "new_content": content(base["row"], outer)})
    notes = [f"\"{base['name']}\" now holds the new items; WP Context nodes that load it "
             "pick them up when you insert it again."]
    if made:
        notes.append("New sub-bundles inside it: " + ", ".join(b["name"] for b in made.values())
                     + ".")
    if new["template_id"]:
        notes.append("Load the new template in a WP Prompt Assembler to use the new variables.")
    return {"adds": adds, "replaces": replaces, "ids": new["ids"], "bundle_id": base["id"],
            "sub_bundles": [{"id": b["id"], "name": b["name"]} for b in made.values()],
            "template_id": new["template_id"], "tag": tag, "notes": notes}
