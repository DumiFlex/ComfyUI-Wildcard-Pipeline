"""Builders for the packs embedded in `example_workflows/`.

The example workflows carry their lists on their WP Context nodes (rows +
bundles, flagged `example`), so they run on an empty library. Writing those
rows by hand in ComfyUI is slow and easy to get subtly wrong (payload hashes,
bundle index ranges, constraint ids), so the data lives here and
`build.py` writes it into the workflow files.

Ids are derived from names, so rebuilding gives the same ids and a sweep axis
or a constraint that points at a row keeps pointing at it.

Pure Python, no ComfyUI imports. Run from the repo root:
    python scripts/example_workflows/build.py
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from engine.modules.snapshot import payload_hash  # noqa: E402

# ── ids ──────────────────────────────────────────────────────────────────


def hid(*parts: str, n: int = 8) -> str:
    """A stable hex id from names (8 chars for rows/options, 12 for uids)."""
    return hashlib.sha1("\x1f".join(parts).encode()).hexdigest()[:n]


# ── options ──────────────────────────────────────────────────────────────


@dataclass
class O:
    """One wildcard option. `tags` are sub-categories (classify and accepts)."""

    value: str
    w: float = 1
    tags: list[str] = field(default_factory=list)
    neg: str | None = None
    fb: bool = False
    null: bool = False


def NULL(w: float = 1, tags: list[str] | None = None) -> O:
    return O("", w=w, tags=list(tags or []), null=True)


def opts(*values: str, w: float = 1, tags: list[str] | None = None) -> list[O]:
    """Several plain options sharing weight and tags."""
    return [O(v, w=w, tags=list(tags or [])) for v in values]


# ── modules ──────────────────────────────────────────────────────────────


@dataclass
class Module:
    kind: str
    name: str
    payload: dict[str, Any]
    desc: str = ""
    instance: dict[str, Any] = field(default_factory=dict)
    enabled: bool = True
    iteration_overrides: dict[str, dict[str, Any]] | None = None
    scope: str = ""  # namespace for ids, so two packs can share a row name

    @property
    def id(self) -> str:
        return hid(self.scope, self.kind, self.name)

    def option_id(self, value: str) -> str:
        for o in self.payload.get("options", []):
            if o["value"] == value:
                return o["id"]
        raise KeyError(f"{self.name}: no option {value!r}")

    def ref(self) -> str:
        """`@{uuid#Name}` reference to this wildcard."""
        return f"@{{{self.id}#{self.name}}}"


def wildcard(
    name: str,
    var: str,
    options: list[O],
    *,
    desc: str = "",
    accepts: dict[str, list[str]] | None = None,
    groups: dict[str, list[str]] | None = None,
    hold: bool = False,
    internal: bool = False,
    pick: tuple[int, int] | None = None,
    separator: str = ", ",
    enabled: bool = True,
    scope: str = "",
) -> Module:
    payload: dict[str, Any] = {"var_binding": var, "sub_categories": [], "options": []}
    seen: list[str] = []
    for o in options:
        for t in o.tags:
            if t not in seen:
                seen.append(t)
    payload["sub_categories"] = seen
    tag_groups: dict[str, list[str]] = {}
    kinds: dict[str, str] = {}
    for gname, tags in (groups or {}).items():
        tag_groups[gname] = tags
    for gname, tags in (accepts or {}).items():
        tag_groups[gname] = tags
        kinds[gname] = "accepts"
    if tag_groups:
        payload["tag_groups"] = tag_groups
    if kinds:
        payload["tag_group_kinds"] = kinds
    for i, o in enumerate(options):
        row: dict[str, Any] = {
            "id": hid(scope, name, "opt", o.value or f"null{i}"),
            "value": o.value,
            "weight": o.w,
            "sub_categories": list(o.tags),
        }
        if o.null:
            row["is_null"] = True
        if o.neg:
            row["negative"] = o.neg
        if o.fb:
            row["fallback"] = True
        payload["options"].append(row)
    instance: dict[str, Any] = {}
    if hold:
        instance["seed_scope"] = "hold"
    if internal:
        instance["internal"] = True
    if pick:
        instance["pick_min"], instance["pick_max"] = pick
        instance["pick_separator"] = separator
    return Module("wildcard", name, payload, desc, instance, enabled, scope=scope)


def constraint(
    name: str,
    source: Module,
    target: Module,
    matrix: dict[str, dict[str, tuple[str, float]]],
    *,
    desc: str = "",
    reach: dict[str, Any] | None = None,
    exceptions: list[tuple[str, str, str, float]] | None = None,
    scope: str = "",
) -> Module:
    """`matrix` works on tags; `exceptions` on option values, "" being the
    null option (which can't carry tags)."""
    payload: dict[str, Any] = {
        "source_wildcard_id": source.id,
        "target_wildcard_id": target.id,
        "source_wildcard_name": source.name,
        "target_wildcard_name": target.name,
        "exceptions": [
            {"source_value": sv, "target_value": tv, "mode": m, "factor": f}
            for sv, tv, m, f in (exceptions or [])
        ],
        "matrix": {
            s: {t: {"mode": m, "factor": f} for t, (m, f) in row.items()}
            for s, row in matrix.items()
        },
    }
    if reach:
        payload["target_select"] = reach
    return Module("constraint", name, payload, desc, scope=scope)


# Derivation conditions and actions.


def eq(var: str, value: str) -> dict[str, Any]:
    return {"var": var, "op": "equals", "value": value}


def has(var: str, value: str) -> dict[str, Any]:
    return {"var": var, "op": "contains", "value": value}


def all_of(*conds: dict[str, Any]) -> dict[str, Any]:
    return {"match": "all", "conditions": list(conds)}


def any_of(*conds: dict[str, Any]) -> dict[str, Any]:
    return {"match": "any", "conditions": list(conds)}


def put(var: str, value: str, mode: str = "replace") -> dict[str, Any]:
    return {"target_var": var, "mode": mode, "value": value}


def branch(cond: dict[str, Any], *actions: dict[str, Any]) -> dict[str, Any]:
    b: dict[str, Any] = {"condition": cond, "action": actions[0]}
    if len(actions) > 1:
        b["extra_actions"] = list(actions[1:])
    return b


def rule(rid: str, branches: list[dict[str, Any]], *otherwise: dict[str, Any]) -> dict[str, Any]:
    r: dict[str, Any] = {"branches": branches, "id": hid("rule", rid)}
    if otherwise:
        e: dict[str, Any] = {"action": otherwise[0]}
        if len(otherwise) > 1:
            e["extra_actions"] = list(otherwise[1:])
        r["else"] = e
    return r


def derivation(name: str, rules: list[dict[str, Any]], *, desc: str = "", scope: str = "") -> Module:
    return Module("derivation", name, {"rules": rules}, desc, scope=scope)


def combine(
    name: str, out_var: str, template: str, *, negative: str | None = None,
    desc: str = "", internal: bool = False, scope: str = "",
) -> Module:
    inputs = list(dict.fromkeys(re.findall(r"\$([A-Za-z_][A-Za-z0-9_]*)", template)))
    payload: dict[str, Any] = {"template": template, "output_var": out_var, "input_vars": inputs}
    if negative:
        payload["negative"] = negative
    return Module(
        "combine", name, payload, desc, {"internal": True} if internal else {}, scope=scope,
    )


def fixed(
    name: str, values: list[tuple[str, str] | tuple[str, str, str]], *, desc: str = "",
    scope: str = "",
) -> Module:
    rows = []
    for v in values:
        row: dict[str, Any] = {"id": hid(scope, name, v[0]), "name": v[0], "value": v[1]}
        if len(v) > 2 and v[2]:
            row["negative"] = v[2]
        rows.append(row)
    return Module("fixed_values", name, {"values": rows}, desc, scope=scope)


# ── bundles + the Context widget value ───────────────────────────────────


@dataclass
class Bundle:
    name: str
    color: str
    children: list[Module | Bundle]
    enabled: bool = True
    scope: str = ""

    @property
    def uid(self) -> str:
        return hid(self.scope, "bundle", self.name, n=12)


def _entry(m: Module, origin: str | None, salt: str) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": m.id,
        "_uid": uid_of(m, salt),
        "type": m.kind,
        "enabled": m.enabled,
        "collapsed": True,
        "meta": {"name": m.name, "library_name": m.name},
        "entries": [],
        "payload": m.payload,
        "payload_hash": payload_hash(m.payload),
        "instance": dict(m.instance),
        "example": True,
    }
    if m.desc:
        e["meta"]["description"] = m.desc
    if m.iteration_overrides:
        e["iteration_overrides"] = m.iteration_overrides
    if origin:
        e["bundle_origin"] = origin
    return e


def uid_of(m: Module, salt: str = "") -> str:
    """The per-instance `_uid` a sweep axis or a pick reach names. `salt`
    tells apart two Context nodes that carry the same row."""
    return hid(salt, m.scope, "uid", m.kind, m.name, n=12)


def context_value(*items: Module | Bundle, salt: str = "") -> str:
    """The `wp_modules` widget value for one WP Context node."""
    modules: list[dict[str, Any]] = []
    bundles: list[dict[str, Any]] = []

    def add(item: Module | Bundle, parent: Bundle | None) -> None:
        if isinstance(item, Module):
            modules.append(_entry(item, hid(salt, parent.uid, n=12) if parent else None, salt))
            return
        start = len(modules)
        slot = len(bundles)
        bundles.append({})  # keep parent before child, as the widget does
        for child in item.children:
            add(child, item)
        bundles[slot] = {
            "_uid": hid(salt, item.uid, n=12),
            "library_id": hid(item.scope, "bundle-lib", item.name),
            "start_idx": start,
            "end_idx": len(modules) - 1,
            "enabled": item.enabled,
            "collapsed": parent is not None,
            "inserted_at_hash": "",
            "name": item.name,
            "color": item.color,
            "parent_uid": hid(salt, parent.uid, n=12) if parent else None,
            "example": True,
        }

    for it in items:
        add(it, None)
    # A row inside a sub-bundle points at the innermost bundle (above).
    return json.dumps({"version": 1, "modules": modules, "bundles": bundles}, ensure_ascii=False)
