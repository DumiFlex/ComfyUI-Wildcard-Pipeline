"""Pack builder chain layout: the modules a pack runs as, ref catalog, frame
pins, and the extend-a-bundle layout `check_pack` and `extend_ops` share."""
from __future__ import annotations

import copy
import json
import re
from typing import Any

from engine.ai import library_vars
from engine.ai.pack._common import is_wild, module_type
from engine.ai.pack.build_notes import _option_texts, item_instance
from engine.ai.pack.plan import run_order
from engine.ai.pack.settings import parse_run
from engine.modules.snapshot import payload_hash, walk_transitive_refs


def chain_modules(plan: dict[str, Any], built: dict[str, Any]) -> list[dict[str, Any]]:
    """The built modules in run order, in the list shape the engine takes,
    each with its use line as its instance."""
    items = {i["key"]: i for i in plan["items"]}
    values = {i["var"]: _option_texts(built[i["key"]]["payload"]) for i in plan["items"]
              if is_wild(i) and i["key"] in built}
    out = []
    for n, key in enumerate(run_order(plan, built)):
        b = built.get(key)
        if b is None:
            continue
        i = items[key]
        out.append({
            "id": b["id"], "_uid": f"pack.{n}", "enabled": True,
            "type": module_type(i),
            "name": i["name"], "meta": {"name": i["name"], "library_name": i["name"]},
            "payload": copy.deepcopy(b["payload"]),
            "payload_hash": payload_hash(b["payload"]),
            "instance": item_instance(i, b["payload"], values),
        })
    return out


def ref_catalog(
    modules: list[dict[str, Any]], rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """The ``@{uuid}`` catalog a run needs: every wildcard the modules point
    at, transitively, from ``rows`` (the pack's and the library's)."""
    by_id = {r["id"]: r for r in rows if isinstance(r.get("id"), str)
             and r.get("type", "wildcard") == "wildcard"}
    roots = sorted({t for m in modules for t in _ids_in(m)} | {
        m["id"] for m in modules if m.get("type") == "wildcard"})
    if not roots:
        return {}

    def fetch(uuid: str) -> dict[str, Any] | None:
        r = by_id.get(uuid)
        if r is None:
            return None
        return {"id": uuid, "type": "wildcard", "name": r.get("name", ""),
                "payload": r["payload"], "payload_hash": payload_hash(r["payload"])}

    return walk_transitive_refs(roots, fetch_module=fetch).snapshots


def _ids_in(module: dict[str, Any]) -> set[str]:
    text = json.dumps(module.get("payload") or {})
    return set(re.findall(r"@\{([0-9a-f]{8})", text))


def _template(plan: dict[str, Any], built: dict[str, Any]) -> tuple[dict[str, Any], str] | None:
    for i in plan["items"]:
        if i["kind"] == "template" and i["key"] in built:
            return i, built[i["key"]]["payload"]["template_string"]
    return None


def pins(plan: dict[str, Any]) -> dict[str, str]:
    """Each input's example, as the check pins it, and each canvas Injector
    variable (its value isn't known here, so its name stands in)."""
    out = {c["name"]: c["name"].replace("_", " ") for c in plan.get("canvas") or []
           if c["source"] == "injector"}
    out.update({i["var"]: i["example"] or i["var"].replace("_", " ")
                for i in plan.get("inputs") or []})
    return out


def render(text: str, negative: str, ctx: dict[str, Any]) -> tuple[str, str]:
    """A template and its negative the way the Assembler renders them."""
    from engine.negatives import entries_for_reads, join_unique, render_negative
    from engine.template import resolve_variables, resolve_variables_raw

    reads: list[Any] = []
    prompt = resolve_variables(text, ctx, reads=reads)
    collected = join_unique(str(e.get("text", "")) for e in entries_for_reads(ctx, reads))
    neg = render_negative(negative, collected, lambda t: resolve_variables_raw(t, ctx))
    return prompt, neg


def loop_frames(plan: dict[str, Any]) -> int:
    """Frames of the Loop a story pack runs over (0 for other run styles)."""
    run = parse_run(plan.get("run"))
    return run["frames"] if run["mode"] == "story" else 0


def frame_of(seed: int, frames: int) -> int:
    return (seed - 1) % frames + 1


def frame_pins(frame: int, frames: int) -> dict[str, str]:
    """What the Loop sets for one frame (1-based, as text)."""
    return {"iteration": str(frame), "iteration_total": str(frames)}


def _merge_reports(reports: list[dict[str, Any]]) -> dict[str, Any]:
    """Scenario reports of the Loop's frames as one: runs, failures,
    variable counts and warnings added up."""
    out: dict[str, Any] = {"runs": 0, "failed": 0, "variables": {}, "warnings": []}
    warns: dict[tuple[str, str], dict[str, Any]] = {}
    for r in reports:
        out["runs"] += r["runs"]
        out["failed"] += r["failed"]
        for name, v in r["variables"].items():
            m = out["variables"].setdefault(name, {"counts": {}, "other": 0, "distinct": 0,
                                                   "internal": v.get("internal", False)})
            for value, n in v["counts"].items():
                m["counts"][value] = m["counts"].get(value, 0) + n
            m["other"] += v["other"]
        for w in r["warnings"]:
            key = (str(w.get("type", "")), str(w.get("message", "")))
            if key in warns:
                warns[key]["count"] += w["count"]
            else:
                warns[key] = dict(w)
    for v in out["variables"].values():
        v["counts"] = dict(sorted(v["counts"].items(), key=lambda kv: -kv[1]))
        v["distinct"] = len(v["counts"]) + (1 if v["other"] else 0)
    out["warnings"] = sorted(warns.values(), key=lambda g: -g["count"])
    return out


def _module_sets(m: dict[str, Any]) -> list[str]:
    """Variables one module sets."""
    p = _got if isinstance(_got := m.get("payload"), dict) else {}
    kind = m.get("type")
    if kind == "wildcard":
        return [p["var_binding"]] if isinstance(p.get("var_binding"), str) \
            and p["var_binding"] else []
    if kind == "fixed_values":
        return [v["name"] for v in p.get("values") or []
                if isinstance(v, dict) and isinstance(v.get("name"), str) and v["name"]]
    if kind == "combine":
        return [p["output_var"]] if isinstance(p.get("output_var"), str) \
            and p["output_var"] else []
    if kind == "derivation":
        return [t for r in p.get("rules") or [] for t in library_vars._action_targets(r)]
    return []


def _module_name(m: dict[str, Any]) -> str:
    meta = _got if isinstance(_got := m.get("meta"), dict) else {}
    return str(meta.get("name") or meta.get("library_name") or m.get("name") or m.get("id"))


def _base_module(m: dict[str, Any], n: int) -> dict[str, Any]:
    payload = copy.deepcopy(m["payload"])
    return {"id": m["id"], "_uid": f"base.{n}", "enabled": m.get("enabled", True) is not False,
            "type": m["type"], "name": _module_name(m),
            "meta": _got if isinstance(_got := m.get("meta"), dict) else {},
            "payload": payload, "payload_hash": m.get("payload_hash") or payload_hash(payload),
            "instance": _got if isinstance(_got := m.get("instance"), dict) else {}}


def _before_target(seq: list[dict[str, Any]], m: dict[str, Any]) -> int | None:
    """Where a new constraint goes in a list holding its target: just
    before the target (a constraint runs before the pick it limits)."""
    if m.get("type") != "constraint":
        return None
    tgt = (m.get("payload") or {}).get("target_wildcard_id")
    return next((n for n, x in enumerate(seq) if x.get("id") == tgt), None)


def _take_new_source(m: dict[str, Any], new: set[int], outer: list[dict[str, Any]],
                     subs: dict[str, list[dict[str, Any]]],
                     made: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    """A new constraint's source wildcard when it is new too, taken out of
    where it was placed (a section it leaves empty goes too), else None."""
    src = (m.get("payload") or {}).get("source_wildcard_id")
    for seq in [outer, *subs.values(), *made.values()]:
        for n, x in enumerate(seq):
            if id(x) in new and x.get("id") == src:
                del seq[n]
                for sec, items in list(made.items()):
                    if not items:
                        del made[sec]
                        outer[:] = [c for c in outer if c.get("section") != sec
                                    or c.get("type") != "bundle"]
                return x
    return None


def _extend_layout(plan: dict[str, Any], built: dict[str, Any],
                   base: dict[str, Any]) -> dict[str, Any]:
    """Where each new module goes when extending, shared by the check and
    the install so what's tested is what's installed: ``{outer, subs,
    made, changed}``. ``outer`` / ``subs[name]`` are the bundle's (and
    its sub-bundles') children with the new chain modules placed in them;
    ``made`` are new sections (each a list of chain modules), referenced
    from ``outer`` as ``{"type": "bundle", "section": name}``."""
    items = {i["key"]: i for i in plan["items"]}
    outer: list[dict[str, Any]] = list(base["row"].get("children") or [])
    subs = {name: list(row.get("children") or []) for name, row in base["subs"].items()}
    made: dict[str, list[dict[str, Any]]] = {}
    changed: set[str] = set()
    keys = [k for k in run_order(plan, built) if k in built]
    new: set[int] = set()
    for m, key in zip(chain_modules(plan, built), keys, strict=True):
        i = items[key]
        if i.get("existing"):
            continue
        new.add(id(m))
        placed = False
        for name, seq in [("", outer), *subs.items()]:
            at = _before_target(seq, m)
            if at is not None:
                # A new source wildcard was appended after the bundle's
                # target: it moves in just ahead, so source, constraint,
                # target run in that order.
                src = _take_new_source(m, new, outer, subs, made)
                if src is not None:
                    at = _before_target(seq, m) or 0
                    seq.insert(at, src)
                    at += 1
                seq.insert(at, m)
                changed.add(name)
                placed = True
                break
        if placed:
            continue
        sec = i.get("section") or ""
        if sec in subs:
            subs[sec].append(m)
            changed.add(sec)
        elif sec and not base["nested"]:
            if sec not in made:
                made[sec] = []
                outer.append({"type": "bundle", "section": sec})
            made[sec].append(m)
            changed.add("")
        else:
            outer.append(m)
            changed.add("")
    return {"outer": outer, "subs": subs, "made": made, "changed": changed}


def extend_chain(plan: dict[str, Any], built: dict[str, Any],
                 base: dict[str, Any]) -> list[dict[str, Any]]:
    """The run order after extending: the bundle as it is, with the new
    modules where the install puts them; a new constraint on one of its
    wildcards goes just before that wildcard."""
    lay = _extend_layout(plan, built, base)
    new_ids = {id(m) for seq in [lay["outer"], *lay["subs"].values(), *lay["made"].values()]
               for m in seq if "_uid" in m}
    flat: list[dict[str, Any]] = []
    for c in lay["outer"]:
        if c.get("type") == "bundle":
            sub = lay["made"].get(c.get("section")) if "section" in c else None
            if sub is None:
                sub = next((seq for name, seq in lay["subs"].items()
                            if base["subs"][name]["id"] == c.get("id")), [])
            flat += sub
        else:
            flat.append(c)
    out = []
    for n, m in enumerate(flat):
        if id(m) in new_ids:
            out.append(m)
        elif isinstance(m.get("payload"), dict):
            out.append(_base_module(m, n))
    return out
