"""v1 -> v2 payload migration (SP1 multi-tag + boolean sub-category filter).

Transforms, all idempotent:
  * option `sub_category: "x"` -> `sub_categories: ["x"]` (None/absent -> []);
  * registry + option + tag_group sub-category names slugified to a single
    safe token (whitespace / boolean-grammar / ref chars -> `_`), reserved
    words suffixed (`or` -> `or_1`), de-duped — cascaded so an option/group
    membership tracks its renamed registry entry;
  * instance `category_filter: [...]` -> a boolean expression string
    (`" or ".join`) + a separate `exclude_null` flag (the old `"null"`
    list-entry);
  * nested `@{uuid#name:a,b,null}` refs -> `@{uuid#name:a or b!null}`
    (comma list -> `or`, `null` keyword -> trailing `!null` marker).

Two entry shapes share one core (`_deep_migrate`):
  * `migrate_v1_to_v2(envelope)` — the import/export multi-row envelope
    (`wildcards[]`/`bundles[]`/...); registered in the version `_CHAIN`.
  * `migrate_module_v1_to_v2` / `migrate_bundle_v1_to_v2` — per-row payload
    migrators for the lazy/bulk DB path (`engine/db/lazy_migrate.py`); the
    row's `payload` column is the inner module payload (`{options, ...}`,
    no `type` field — wildcard-ness is detected structurally).

Mirror: src/manager/import-export/migrations.ts.
"""
from __future__ import annotations

import re
from typing import Any

from engine.syntax.subcat_filter import RESERVED

# Chars a v2 sub-category name may not contain (mirrors subcat_filter
# validate_subcat_name): whitespace + the boolean-grammar + ref delimiters.
_BAD = re.compile(r"[\s()!,#:}@{$]+")
# Broad ref matcher (v1 OR v2 form) so v1 comma/null lists get rewritten
# while v2 refs pass through untouched. Groups: uuid, `#name` seg, `:tail`.
_REF_RE = re.compile(r"@\{([0-9a-f]{8})(#[^:}]*)?(:[^}]*)?\}")


def _slug(name: str) -> str:
    return _BAD.sub("_", name).strip("_") or "_"


def _name_map(registry: list[str]) -> dict[str, str]:
    """old sub-category name -> sanitized, reserved-safe, unique name."""
    out: dict[str, str] = {}
    used: set[str] = set()
    for raw in registry:
        s = _slug(raw)
        if s.lower() in RESERVED:
            s = f"{s}_1"
        base, n = s, 1
        while s in used:
            n += 1
            s = f"{base}_{n}"
        used.add(s)
        out[raw] = s
    return out


def _rewrite_ref(m: re.Match[str]) -> str:
    uuid = m.group(1)
    name_seg = m.group(2) or ""
    tail = m.group(3)
    if tail is None:
        return m.group(0)  # bare `@{uuid}` / `@{uuid#name}` — nothing to do
    lst = tail[1:]  # strip the leading ':'
    has_comma = "," in lst
    parts = [x.strip() for x in lst.split(",")]
    has_null = "null" in parts
    if not has_comma and not has_null:
        # Single tag OR an already-v2 boolean expression — leave as-is so
        # the rewrite is idempotent and never corrupts a v2 ref.
        return m.group(0)
    # Slug each tag so a cross-wildcard ref tracks the target's renamed
    # registry entry (deterministic — same _slug the target applies).
    tags = [_slug(p) for p in parts if p and p != "null"]
    expr = " or ".join(tags)
    out = "@{" + uuid + name_seg
    if expr:
        out += ":" + expr
    if has_null:
        out += "!null"
    return out + "}"


def _rewrite_refs(s: str) -> str:
    return _REF_RE.sub(_rewrite_ref, s)


def _is_wildcard_payload(p: Any) -> bool:
    """A wildcard payload is the only shape carrying a sub-category model:
    an `options` list plus either a `sub_categories` registry or an option
    bearing the legacy singular `sub_category` field."""
    if not isinstance(p, dict) or not isinstance(p.get("options"), list):
        return False
    if "sub_categories" in p:
        return True
    return any(isinstance(o, dict) and "sub_category" in o for o in p["options"])


def _apply_wildcard_payload(
    p: dict[str, Any], nmap: dict[str, str] | None = None
) -> dict[str, Any]:
    reg = [s for s in p.get("sub_categories", []) if isinstance(s, str)]
    if nmap is None:
        nmap = _name_map(reg)
    out = {**p, "sub_categories": [nmap[s] for s in reg]}
    new_opts: list[Any] = []
    for o in p.get("options", []):
        if not isinstance(o, dict):
            new_opts.append(o)
            continue
        o = dict(o)
        if isinstance(o.get("sub_categories"), list):  # already-v2 / idempotent
            o["sub_categories"] = [nmap.get(t, _slug(t)) for t in o["sub_categories"]]
        else:
            sc = o.pop("sub_category", None)
            o["sub_categories"] = (
                [nmap.get(sc, _slug(sc))] if isinstance(sc, str) and sc else []
            )
        if isinstance(o.get("value"), str):
            o["value"] = _rewrite_refs(o["value"])
        new_opts.append(o)
    out["options"] = new_opts
    if isinstance(p.get("tag_groups"), dict):
        out["tag_groups"] = {
            g: [nmap.get(m, _slug(m)) for m in mem if isinstance(m, str)]
            for g, mem in p["tag_groups"].items()
        }
    return out


def _migrate_instance(inst: dict[str, Any], nmap: dict[str, str]) -> dict[str, Any]:
    cf = inst.get("category_filter")
    if not isinstance(cf, list):
        return inst
    out = dict(inst)
    has_null = "null" in cf
    tags = [nmap.get(c, _slug(c)) for c in cf if isinstance(c, str) and c and c != "null"]
    out["category_filter"] = " or ".join(tags)
    out["exclude_null"] = bool(out.get("exclude_null")) or has_null
    return out


def _deep_migrate(obj: Any) -> Any:
    """Recursive transform shared by the per-row module/bundle migrators:
    migrate any wildcard-shaped dict in place, rewrite `@{}` refs in every
    string, recurse into containers. Idempotent."""
    if isinstance(obj, dict):
        if _is_wildcard_payload(obj):
            return _apply_wildcard_payload(obj)
        return {k: _deep_migrate(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_deep_migrate(x) for x in obj]
    if isinstance(obj, str):
        return _rewrite_refs(obj)
    return obj


def migrate_module_v1_to_v2(payload: dict[str, Any], ctx: Any = None) -> dict[str, Any]:
    """Per-row module-payload migrator for the lazy/bulk DB path."""
    return _deep_migrate(payload)


def migrate_bundle_v1_to_v2(payload: dict[str, Any], ctx: Any = None) -> dict[str, Any]:
    """Per-row bundle-payload migrator — recurses into frozen child snapshots."""
    return _deep_migrate(payload)


def _migrate_wildcard_entry(w: dict[str, Any]) -> dict[str, Any]:
    p = w.get("payload")
    nmap: dict[str, str] = {}
    out = dict(w)
    if isinstance(p, dict):
        reg = [s for s in p.get("sub_categories", []) if isinstance(s, str)]
        nmap = _name_map(reg)
        out["payload"] = _apply_wildcard_payload(p, nmap)
    inst = w.get("instance")
    if isinstance(inst, dict):
        out["instance"] = _migrate_instance(inst, nmap)
    return out


def migrate_v1_to_v2(payload: dict[str, Any]) -> dict[str, Any]:
    """Envelope migrator (mirrors the TS chain step). Maps each wildcard
    entry structurally (+ its instance), deep-migrates the other entity
    arrays (ref rewrite + any nested wildcard snapshots), bumps to v2."""
    out = dict(payload)
    out["wildcards"] = [
        _migrate_wildcard_entry(w) if isinstance(w, dict) else w
        for w in payload.get("wildcards", [])
    ]
    for key in ("bundles", "fixed_values", "combines", "derivations",
                "constraints", "categories", "templates"):
        if isinstance(payload.get(key), list):
            out[key] = [_deep_migrate(e) for e in payload[key]]
    out["schema_version"] = 2
    return out
