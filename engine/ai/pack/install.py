"""Pack builder install: `install_ops` turns a pack into one import commit."""
from __future__ import annotations

import copy
import json
import re
from typing import Any

from engine.ai.pack._common import MAX_NAME, new_id
from engine.ai.pack.layout import chain_modules
from engine.ai.pack.plan import run_order, sectioned
from engine.ai.pack.settings import parse_run, parse_settings


def collection_tag(title: str) -> str:
    tag = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:32].strip("-")
    return tag or "ai-pack"


def _remap_refs(payload: dict[str, Any], remap: dict[str, str]) -> dict[str, Any]:
    moved = {old: new for old, new in remap.items() if old != new}
    if not moved:
        return payload
    text = json.dumps(payload)
    text = re.sub(r"@\{([0-9a-f]{8})", lambda m: "@{" + moved.get(m.group(1), m.group(1)), text)
    return json.loads(text)


def wiring_notes(plan: dict[str, Any],
                 sub_bundles: list[dict[str, Any]] | None = None) -> list[str]:
    """How to use the pack on the canvas, one step per line."""
    out = [f"Add a WP Context node and insert the bundle \"{plan['title']}\"."]
    if sub_bundles:
        out.append(f"It holds {len(sub_bundles)} sub-bundles ("
                   + ", ".join(b["name"].split(" · ")[-1] for b in sub_bundles)
                   + "); keep them in that order, or use one on its own when you only "
                   "need that part.")
    for i in plan.get("inputs") or []:
        out.append(f"Bring ${i['var']} in with a WP Context Injector row named {i['var']}"
                   + (f" ({i['about']})" if i["about"] else "") + ", above the Context.")
    if any(i["kind"] == "template" for i in plan["items"]):
        out.append("Add a WP Prompt Assembler after it and load the template "
                   f"\"{next(i['name'] for i in plan['items'] if i['kind'] == 'template')}\".")
    cfg = parse_settings(plan.get("settings"))
    run = parse_run(plan.get("run"))
    if run["mode"] == "story":
        out.append(f"Put a WP Context Loop before the Context, count {run['frames']}: each "
                   "frame plays the next story beat ($iteration).")
    elif run["mode"] == "sweep":
        out.append("Put a WP Context Loop before the Context in sweep mode and tick the "
                   "options of the sweep axes (the wildcards marked as axes).")
    if cfg["model"] == "family":
        out.append("Add a WP Model Info node fed from your checkpoint loader, above the "
                   "Context, so the pack knows the model family.")
    if any("hold" in (i.get("use") or "") for i in plan["items"]):
        out.append("Items set to hold keep their pick across a WP Context Loop run.")
    return out


def _new_modules(
    plan: dict[str, Any], built: dict[str, Any], *, taken: set[str], template_ids: set[str],
    tag: str,
) -> dict[str, Any]:
    """The built items as import adds: ``{fixed, adds, ids, template_id,
    used}``. Ids already in the library are swapped for fresh ones, and
    constraints and refs follow. Library items (and a bundle's own items
    when extending) add nothing; only the bundle uses them."""
    remap: dict[str, str] = {}
    used = set(taken)
    for i in plan["items"]:
        b = built.get(i["key"])
        if b is None or i["kind"] in ("template", "library"):
            continue
        remap[b["id"]] = new_id(used) if b["id"] in used else b["id"]
        used.add(remap[b["id"]])
    fixed: dict[str, dict[str, Any]] = {}
    for key, b in built.items():
        p = _remap_refs(copy.deepcopy(b["payload"]), remap)
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
        if i["kind"] == "library":
            continue  # already in the library; only the bundle uses it
        adds.append({"kind": i["kind"], "entity": {
            "id": b["id"], "name": i["name"], "description": i["about"], "tags": [tag],
            "payload": b["payload"], "content_rating": plan["rating"],
        }})
    return {"fixed": fixed, "adds": adds, "ids": ids, "template_id": template_id,
            "used": used}


def _child(m: dict[str, Any]) -> dict[str, Any]:
    """A chain module as a bundle child."""
    return {"id": m["id"], "type": m["type"], "enabled": True, "collapsed": False,
            "meta": m["meta"], "payload": m["payload"], "payload_hash": m["payload_hash"],
            "instance": m["instance"], "entries": []}


def install_ops(
    plan: dict[str, Any], built: dict[str, Any], *, taken: set[str],
    template_ids: set[str], bundle_ids: set[str],
) -> dict[str, Any]:
    """An import commit for the pack: ``{adds, ids: {key: id}, bundle_id,
    sub_bundles, template_id, tag, notes}``. Ids already in the library are
    swapped for fresh ones; constraints, refs and the bundle follow. With
    sections, each becomes a sub-bundle inside the pack bundle, in an order
    where every rule runs after what it reads."""
    tag = collection_tag(plan["title"])
    new = _new_modules(plan, built, taken=taken, template_ids=template_ids, tag=tag)
    fixed, adds, used = new["fixed"], new["adds"], new["used"]
    by_key = {}
    for m, key in zip(chain_modules(plan, fixed), [k for k in run_order(plan, fixed)
                                                   if k in fixed], strict=True):
        by_key[key] = _child(m)
    taken_bundles = set(bundle_ids) | used
    bundle_id = new_id(taken_bundles)
    sub_bundles: list[dict[str, Any]] = []
    parts = sectioned(plan, fixed)
    if parts is None:
        children = list(by_key.values())
    else:
        children = []
        about = {s["name"]: s.get("about", "") for s in plan.get("sections") or []}
        for name, keys in parts:
            kids = [by_key[k] for k in keys if k in by_key]
            if not kids:
                continue
            if not name:
                # Items with no section sit directly in the pack bundle.
                children += kids
                continue
            sid = new_id(taken_bundles)
            taken_bundles.add(sid)
            label = f"{plan['title']} · {name}"[:MAX_NAME]
            sub_bundles.append({"id": sid, "name": label,
                                "description": about.get(name) or f"{name} of {plan['title']}",
                                "tags": [tag], "children": kids,
                                "content_rating": plan["rating"]})
            children.append({"id": sid, "type": "bundle", "name": label, "color": None})
    # Inner bundles first: the outer one points at them.
    for b in sub_bundles:
        adds.append({"kind": "bundle", "entity": b})
    adds.append({"kind": "bundle", "entity": {
        "id": bundle_id, "name": plan["title"], "description": plan["summary"],
        "tags": [tag], "children": children, "content_rating": plan["rating"],
    }})
    return {"adds": adds, "replaces": [], "ids": new["ids"], "bundle_id": bundle_id,
            "sub_bundles": [{"id": b["id"], "name": b["name"]} for b in sub_bundles],
            "template_id": new["template_id"], "tag": tag,
            "notes": wiring_notes(plan, sub_bundles)}
