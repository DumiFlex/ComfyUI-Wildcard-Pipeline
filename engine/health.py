"""Library health: one pass over the whole library that lists what is
broken, what is probably a mistake and what is clutter.

The canvas conflict scanner looks at one chain and the Pack builder's check
at one pack; this looks at every row the library holds. Each finding names
the item it is about so the page can offer a fix (open, delete, ignore).

Severities:

- ``problem``: something prints wrong or nothing at all.
- ``warning``: probably a mistake, but it runs.
- ``tidy``: clutter, nothing breaks.

"Not used" can only see what the library and the open canvas show: a
WP_Context node keeps its own copy of what was inserted, so with no canvas
tab open an item placed only on a canvas still reads as unused. The page
words it that way and every finding can be ignored.

Pure: takes rows as the repositories return them, returns plain data.
"""
from __future__ import annotations

import difflib
import hashlib
import re
from collections.abc import Iterable, Iterator
from typing import Any

from engine.ai.library_vars import build_catalog
from engine.modules._fallback import find_fallback
from engine.modules.snapshot import payload_hash

# Same 4-segment ref grammar as `engine/cascade/scan.py:_REF_REGEX`:
# ``@{uuid [#name] [:expr] [!null]}`` — group 1 the uuid, 2 the cached name.
_REF = re.compile(r"@\{([0-9a-f]{8})(?:#([^#:}@{!]*))?(?::([^}!]*))?(?:!([^}]*))?\}")
_VAR = re.compile(r"(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)")
#: Keys whose string values NAME a variable the item writes (not a read).
#: Checks whose key carries a hash of ``values``, so an ignored finding
#: comes back when the item turns up for a different reason (another
#: unset variable, another missing reference).
_KEYED_BY_VALUES = frozenset({
    "missing_ref", "constraint_stale_rule", "unset_read", "zero_weight",
    "duplicate_options", "bundle_detached", "bundle_outdated", "unread_variable",
})
_WRITE_KEYS = frozenset({"target_var", "output_var", "var_binding", "name", "id"})

PROBLEM = "problem"
WARNING = "warning"
TIDY = "tidy"

#: Check id → (severity, title). The page groups findings by check in this
#: order, problems first.
CHECKS: dict[str, tuple[str, str]] = {
    "missing_ref": (PROBLEM, "Points at a wildcard that's gone"),
    "constraint_missing_wildcard": (PROBLEM, "Constraint lost its wildcard"),
    "constraint_stale_rule": (PROBLEM, "Constraint rule for an option or tag that's gone"),
    "bundle_missing_bundle": (PROBLEM, "Bundle holds a bundle that's gone"),
    "empty_bundle": (PROBLEM, "Empty bundle"),
    "wildcard_dead": (PROBLEM, "Wildcard can't pick anything"),
    "unset_read": (PROBLEM, "Reads a variable nothing sets"),
    "unnamed": (WARNING, "No name"),
    "duplicate_name": (WARNING, "Same name twice"),
    "same_options": (WARNING, "Wildcards with the same options"),
    "duplicate_options": (WARNING, "Same option listed twice"),
    "zero_weight": (WARNING, "Options that never roll"),
    "shared_variable": (WARNING, "Two wildcards write the same variable"),
    "bundle_detached": (WARNING, "Bundle copies of deleted items"),
    "unused": (TIDY, "Not used by any bundle, template or reference"),
    "unread_variable": (TIDY, "Sets a variable nothing in the library reads"),
    "bundle_outdated": (TIDY, "Bundle holds an older copy"),
    "tag_once": (TIDY, "Tag used only once"),
    "empty_category": (TIDY, "Empty category"),
    "newer_format": (TIDY, "Installed from a newer format"),
}


def _item(kind: str, row: dict[str, Any]) -> dict[str, Any]:
    """The finding's subject. ``type`` is the module type for modules and the
    kind itself otherwise, so the page picks one icon per row."""
    return {
        "kind": kind,
        "id": str(row.get("id") or ""),
        "name": str(row.get("name") or ""),
        "type": str(row.get("type") or kind) if kind == "module" else kind,
    }


def _finding(check: str, item: dict[str, Any], detail: str, *, extra: str = "",
             others: list[dict[str, Any]] | None = None,
             values: list[str] | None = None) -> dict[str, Any]:
    severity, _ = CHECKS[check]
    if not extra and values and check in _KEYED_BY_VALUES:
        extra = hashlib.sha1("\x1f".join(sorted(values)).encode()).hexdigest()[:8]
    key = f"{check}:{item['kind']}:{item['id']}" + (f":{extra}" if extra else "")
    out: dict[str, Any] = {
        "check": check, "severity": severity, "key": key, "item": item, "detail": detail,
    }
    if others:
        out["others"] = others
    if values:
        out["values"] = values
    return out


def _strings(x: Any, *, skip_write_keys: bool = False) -> Iterator[str]:
    """Every string inside ``x``. With ``skip_write_keys`` the values of keys
    that name a written variable are left out, and a derivation condition's
    ``var`` comes back as ``$var`` so it counts as a read."""
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        if skip_write_keys and isinstance(x.get("var"), str):
            yield "$" + x["var"]
        for k, v in x.items():
            if skip_write_keys and k in _WRITE_KEYS:
                continue
            yield from _strings(v, skip_write_keys=skip_write_keys)
    elif isinstance(x, list):
        for v in x:
            yield from _strings(v, skip_write_keys=skip_write_keys)


def _refs(texts: Iterable[str]) -> dict[str, str]:
    """``@{uuid}`` refs in ``texts`` → the name cached in the ref (or "")."""
    out: dict[str, str] = {}
    for t in texts:
        for m in _REF.finditer(t):
            if not out.get(m.group(1)):
                out[m.group(1)] = (m.group(2) or "").strip()
    return out


def _module_reads(m: dict[str, Any]) -> set[str]:
    """Variables a module reads: ``$name`` in its texts, derivation
    conditions, a combine's inputs. Accessors (``$hair.neg``) read ``hair``."""
    p = m.get("payload") if isinstance(m.get("payload"), dict) else {}
    texts = list(_strings(p, skip_write_keys=True))
    out = set(_VAR.findall(" ".join(texts)))
    if m.get("type") == "combine":
        out |= {v.lstrip("$") for v in p.get("input_vars") or [] if isinstance(v, str) and v}
    return out


def _template_texts(t: dict[str, Any]) -> list[str]:
    return [str(t.get(k) or "") for k in ("template_string", "negative_template")]


def _template_reads(t: dict[str, Any]) -> set[str]:
    """Variables a saved template reads. ``$negatives`` in the negative
    template is the Assembler's slot for the collected negatives, not a read."""
    reads = set(_VAR.findall(str(t.get("template_string") or "")))
    neg = set(_VAR.findall(str(t.get("negative_template") or ""))) - {"negatives"}
    return reads | neg


def _module_sets(m: dict[str, Any]) -> set[str]:
    return set(build_catalog([m]).keys()) - _BUILTIN_VARS


_BUILTIN_VARS = frozenset(build_catalog([]).keys())


def _norm(text: Any) -> str:
    return " ".join(str(text or "").lower().split())


def _live_values(p: dict[str, Any]) -> list[dict[str, Any]]:
    return [o for o in p.get("options") or [] if isinstance(o, dict) and not o.get("is_null")]


def _weight(o: dict[str, Any]) -> float:
    try:
        return max(0.0, float(o.get("weight", 1)))
    except (TypeError, ValueError):
        return 1.0


def _quote(values: Iterable[str], limit: int = 4) -> str:
    vals = list(values)
    shown = ", ".join(f'"{v[:40]}"' for v in vals[:limit])
    return shown + (f" and {len(vals) - limit} more" if len(vals) > limit else "")


def _vars(values: Iterable[str], limit: int = 4) -> str:
    vals = sorted(values)
    shown = ", ".join(f"${v}" for v in vals[:limit])
    return shown + (f" and {len(vals) - limit} more" if len(vals) > limit else "")


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def scan_library(
    modules: list[dict[str, Any]],
    bundles: list[dict[str, Any]],
    templates: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    *,
    canvas_ids: Iterable[str] | None = None,
    canvas_vars: Iterable[str] | None = None,
    canvas_reads: Iterable[str] | None = None,
    newer_format_ids: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    """Every finding for the library, problems first.

    ``canvas_ids``: library ids the open canvas uses (modules and bundles),
    ``canvas_vars``: variables it sets at run time (injector, loop, model
    info), ``canvas_reads``: variables its Assemblers read. All three are
    ``None`` when no canvas tab answered. ``newer_format_ids``: rows installed
    from a newer schema with fields dropped (``tolerant_drift_status``).
    """
    canvas_open = canvas_ids is not None
    canvas_ids = set(canvas_ids or ())
    canvas_reads = set(canvas_reads or ())
    mods = [m for m in modules if isinstance(m, dict) and m.get("id")]
    by_id = {m["id"]: m for m in mods}
    wildcards = {m["id"]: m for m in mods if m.get("type") == "wildcard"}
    bundle_ids = {b.get("id") for b in bundles if isinstance(b, dict)}
    out: list[dict[str, Any]] = []

    def payload(m: dict[str, Any]) -> dict[str, Any]:
        p = m.get("payload")
        return p if isinstance(p, dict) else {}

    def module_children(b: dict[str, Any]) -> list[dict[str, Any]]:
        return [c for c in b.get("children") or []
                if isinstance(c, dict) and c.get("type") != "bundle"]

    # ── References and usage ────────────────────────────────────────────
    used: set[str] = set(canvas_ids)
    for b in bundles:
        for c in b.get("children") or []:
            if isinstance(c, dict) and isinstance(c.get("id"), str):
                used.add(c["id"])

    def check_refs(kind: str, row: dict[str, Any], texts: Iterable[str]) -> None:
        refs = _refs(texts)
        used.update(refs)
        gone = {u: n for u, n in refs.items() if u not in wildcards}
        if gone:
            labels = [n or u for u, n in gone.items()]
            out.append(_finding(
                "missing_ref", _item(kind, row),
                f"Points at {_plural(len(gone), 'wildcard')} no longer in the library "
                f"({_quote(labels)}). It prints nothing where the reference sits.",
                values=sorted(gone),
            ))

    for m in mods:
        check_refs("module", m, _strings(payload(m)))
    for t in templates:
        check_refs("template", t, _template_texts(t))
    for b in bundles:
        check_refs("bundle", b, (s for c in module_children(b) for s in _strings(c.get("payload"))))

    # ── Constraints ─────────────────────────────────────────────────────
    for m in mods:
        if m.get("type") != "constraint":
            continue
        p = payload(m)
        ends = {"source": p.get("source_wildcard_id"), "target": p.get("target_wildcard_id")}
        for side in ends.values():
            if isinstance(side, str):
                used.add(side)
        lost = [side for side, wid in ends.items()
                if not isinstance(wid, str) or wid not in wildcards]
        if lost:
            out.append(_finding(
                "constraint_missing_wildcard", _item("module", m),
                f"Its {' and '.join(lost)} wildcard is no longer in the library, "
                "so the constraint never applies.",
            ))
            continue
        src, tgt = payload(wildcards[ends["source"]]), payload(wildcards[ends["target"]])
        stale = _stale_rules(p, src, tgt)
        if stale:
            out.append(_finding(
                "constraint_stale_rule", _item("module", m),
                f"{_plural(len(stale), 'rule')} name options or tags the wildcards no longer "
                f"have ({_quote(stale)}). Those rules never match.",
                values=stale,
            ))

    # ── Bundles ─────────────────────────────────────────────────────────
    for b in bundles:
        if not b.get("children"):
            out.append(_finding("empty_bundle", _item("bundle", b),
                                "Holds nothing, so inserting it adds nothing."))
        gone_bundles, detached, outdated = [], [], []
        for c in b.get("children") or []:
            if not isinstance(c, dict):
                continue
            meta = c.get("meta") if isinstance(c.get("meta"), dict) else {}
            name = str(meta.get("name") or c.get("name") or c.get("id") or "")
            if c.get("type") == "bundle":
                if c.get("id") not in bundle_ids:
                    gone_bundles.append(name)
                continue
            lib = by_id.get(c.get("id"))
            if lib is not None and not (meta.get("name") or c.get("name")):
                name = str(lib.get("name") or name)
            if lib is None:
                detached.append(name)
            elif c.get("payload_hash") and isinstance(c.get("payload"), dict) \
                    and payload_hash(c["payload"]) != payload_hash(payload(lib)):
                outdated.append(name)
        if gone_bundles:
            out.append(_finding(
                "bundle_missing_bundle", _item("bundle", b),
                f"Holds {_plural(len(gone_bundles), 'bundle')} no longer in the library "
                f"({_quote(gone_bundles)}). Inserting it skips them.",
                values=gone_bundles,
            ))
        if detached:
            out.append(_finding(
                "bundle_detached", _item("bundle", b),
                f"Keeps copies of {_plural(len(detached), 'item')} deleted from the library "
                f"({_quote(detached)}). They still run, but nothing updates them. "
                "Open the bundle to relink them.",
                values=detached,
            ))
        if outdated:
            out.append(_finding(
                "bundle_outdated", _item("bundle", b),
                f"Its copy of {_quote(outdated)} differs from the library's. "
                "Bundles keep the copy from when they were saved.",
                values=outdated,
            ))

    # ── Wildcards ───────────────────────────────────────────────────────
    for m in wildcards.values():
        p = payload(m)
        options = [o for o in p.get("options") or [] if isinstance(o, dict)]
        live = _live_values(p)
        rolling = [o for o in live if _weight(o) > 0 and str(o.get("value") or "").strip()]
        if not options:
            out.append(_finding("wildcard_dead", _item("module", m),
                                "Has no options, so it prints nothing."))
        elif not rolling and find_fallback(options) is None:
            nulls = [o for o in options if o.get("is_null") and _weight(o) > 0]
            blank = [o for o in live if _weight(o) > 0]
            out.append(_finding(
                "wildcard_dead", _item("module", m),
                "Only its empty option can roll, so it always prints nothing." if nulls else
                "Its options have no text, so it prints nothing." if blank else
                "Every option has weight 0 and none is the fallback, so it prints nothing.",
            ))
        seen: dict[str, int] = {}
        for o in live:
            key = _norm(o.get("value"))
            if key:
                seen[key] = seen.get(key, 0) + 1
        twice = [k for k, n in seen.items() if n > 1]
        if twice:
            out.append(_finding(
                "duplicate_options", _item("module", m),
                f"Lists {_quote(twice)} more than once. Raise one option's weight instead.",
                values=twice,
            ))
        zero = [str(o.get("value") or "") for o in live
                if _weight(o) == 0 and not o.get("fallback") and str(o.get("value") or "").strip()]
        if zero and rolling:
            out.append(_finding(
                "zero_weight", _item("module", m),
                f"{_plural(len(zero), 'option')} with weight 0 never roll ({_quote(zero)}).",
                values=zero,
            ))

    # Two wildcards with the same set of option texts.
    by_set: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for m in wildcards.values():
        texts = tuple(sorted({_norm(o.get("value")) for o in _live_values(payload(m))} - {""}))
        if len(texts) >= 2:
            by_set.setdefault(texts, []).append(m)
    for group in by_set.values():
        if len(group) > 1:
            group = sorted(group, key=lambda r: str(r.get("id") or ""))
            first, rest = group[0], group[1:]
            out.append(_finding(
                "same_options", _item("module", first),
                f"Has the same {_plural(len(_live_values(payload(first))), 'option')} as "
                f"{_quote([str(r.get('name') or '') for r in rest])}.",
                others=[_item("module", r) for r in rest],
            ))

    # No name: hard to find in pickers and references.
    for kind, rows in (("module", mods), ("bundle", bundles), ("template", templates)):
        for r in rows:
            if not str(r.get("name") or "").strip():
                out.append(_finding("unnamed", _item(kind, r),
                                    "Has no name, so it's hard to find in pickers and references."))

    # Same type and same name.
    named: dict[tuple[str, str, str], list[tuple[str, dict[str, Any]]]] = {}
    for m in mods:
        key = ("module", str(m.get("type")), _norm(m.get("name")))
        named.setdefault(key, []).append(("module", m))
    for b in bundles:
        named.setdefault(("bundle", "bundle", _norm(b.get("name"))), []).append(("bundle", b))
    for t in templates:
        named.setdefault(("template", "template", _norm(t.get("name"))), []).append(("template", t))
    for (_, _, name), group in named.items():
        if name and len(group) > 1:
            group = sorted(group, key=lambda kr: (kr[0], str(kr[1].get("id") or "")))
            (kind, first), rest = group[0], group[1:]
            out.append(_finding(
                "duplicate_name", _item(kind, first),
                f"{_plural(len(group), 'item')} of this kind are called "
                f"\"{first.get('name')}\". Easy to pick the wrong one.",
                others=[_item(k, r) for k, r in rest],
            ))

    # Two wildcards bound to one variable: the later one wins at run time.
    by_var: dict[str, list[dict[str, Any]]] = {}
    for m in wildcards.values():
        var = str(payload(m).get("var_binding") or "").strip()
        if var:
            by_var.setdefault(var, []).append(m)
    for var, group in by_var.items():
        if len(group) > 1:
            group = sorted(group, key=lambda r: str(r.get("id") or ""))
            first, rest = group[0], group[1:]
            out.append(_finding(
                "shared_variable", _item("module", first),
                f"Writes ${var}, like {_quote([str(r.get('name') or '') for r in rest])}. "
                "On one chain the later one wins, which is fine for alternatives.",
                extra=var, others=[_item("module", r) for r in rest],
            ))

    # ── Variables ───────────────────────────────────────────────────────
    child_rows = [c for b in bundles for c in module_children(b)]
    sets = set(build_catalog(
        [*mods, *child_rows],
        canvas=[{"name": v, "source": "injector"} for v in canvas_vars or ()],
    ))
    template_reads: set[str] = set()
    for t in templates:
        reads = _template_reads(t)
        template_reads |= reads
        missing = reads - sets
        if missing:
            out.append(_finding(
                "unset_read", _item("template", t),
                f"Reads {_vars(missing)}, which no library item sets. Unless a WP Context "
                "Injector on the canvas sets it, it prints as empty.",
                values=sorted(missing),
            ))
    module_reads: set[str] = set()
    for m in mods:
        reads = _module_reads(m)
        module_reads |= reads
        missing = reads - sets
        if missing and m.get("type") != "constraint":
            out.append(_finding(
                "unset_read", _item("module", m),
                f"Reads {_vars(missing)}, which no library item sets. Unless a WP Context "
                "Injector on the canvas sets it, it reads as empty.",
                values=sorted(missing),
            ))
    child_reads = {v for c in child_rows for v in _module_reads(c)}
    all_reads = template_reads | module_reads | child_reads | canvas_reads
    for m in mods:
        if m.get("type") not in ("combine", "derivation", "fixed_values"):
            continue
        unread = _module_sets(m) - all_reads
        if unread:
            tail = (" or Assembler on the open canvas reads." if canvas_open else
                    " reads. An Assembler on a canvas may still print it.")
            out.append(_finding(
                "unread_variable", _item("module", m),
                f"Sets {_vars(unread)}, which no saved template, combine, derivation{tail}",
                values=sorted(unread),
            ))

    # ── Not used ────────────────────────────────────────────────────────
    for m in mods:
        if m["id"] in used:
            continue
        if m.get("type") != "constraint" and _module_sets(m) & template_reads:
            continue  # a saved template prints what it sets
        out.append(_finding(
            "unused", _item("module", m),
            "No bundle, template, constraint or reference uses it"
            + (", and it isn't on the open canvas." if canvas_open else
               ". It may still sit on a canvas: open one to check."),
        ))

    # ── Tags and categories ─────────────────────────────────────────────
    tag_uses: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for kind, rows in (("module", mods), ("bundle", bundles), ("template", templates)):
        for r in rows:
            for tag in r.get("tags") or []:
                if isinstance(tag, str) and tag.strip():
                    tag_uses.setdefault(tag.strip(), []).append((kind, r))
    names = list(tag_uses)
    for tag, uses in tag_uses.items():
        if len(uses) != 1:
            continue
        kind, row = uses[0]
        lowered = [x.lower() for x in names]
        near = [n for n in difflib.get_close_matches(tag.lower(), lowered, n=3, cutoff=0.8)
                if n != tag.lower()]
        near_names = [x for x in names if x.lower() in near]
        out.append(_finding(
            "tag_once", {"kind": "tag", "id": tag, "name": tag, "type": "tag"},
            f"Only on {row.get('name') or row.get('id')}."
            + (f" Did you mean {_quote(near_names, 2)}?" if near_names else ""),
            others=[_item(kind, row)], values=near_names,
        ))
    in_category = {r.get("category_id") for rows in (mods, bundles, templates) for r in rows}
    for c in categories:
        if isinstance(c, dict) and c.get("id") and c["id"] not in in_category:
            out.append(_finding(
                "empty_category", _item("category", c), "Nothing is filed under it.",
            ))

    # ── Install drift ───────────────────────────────────────────────────
    for rid in newer_format_ids or ():
        row = by_id.get(rid)
        kind = "module"
        if row is None:
            row = next((b for b in bundles if b.get("id") == rid), None)
            kind = "bundle"
        if row is not None:
            out.append(_finding(
                "newer_format", _item(kind, row),
                "Installed from a newer version of Wildcard Pipeline, so settings this "
                "version doesn't know were left out. Update the extension and reinstall it "
                "to get them back.",
            ))

    order = list(CHECKS)
    out.sort(key=lambda f: (order.index(f["check"]), _norm(f["item"]["name"])))
    return out


def _stale_rules(p: dict[str, Any], src: dict[str, Any], tgt: dict[str, Any]) -> list[str]:
    """Matrix tags and exception values a constraint names that its source
    or target wildcard no longer has. An empty value is the null option."""
    def tags(w: dict[str, Any]) -> set[str]:
        out = {t for t in w.get("sub_categories") or [] if isinstance(t, str)}
        for o in w.get("options") or []:
            if isinstance(o, dict):
                out |= {t for t in o.get("sub_categories") or [] if isinstance(t, str)}
        return out

    def values(w: dict[str, Any]) -> set[str]:
        opts = [o for o in w.get("options") or [] if isinstance(o, dict)]
        return {str(o.get("value") or "") for o in opts} | {""}

    src_tags, tgt_tags = tags(src), tags(tgt)
    src_vals, tgt_vals = values(src), values(tgt)
    stale: list[str] = []
    matrix = p.get("matrix") if isinstance(p.get("matrix"), dict) else {}
    for s_tag, row in matrix.items():
        if s_tag not in src_tags and s_tag not in stale:
            stale.append(s_tag)
        for t_tag in row if isinstance(row, dict) else {}:
            if t_tag not in tgt_tags and t_tag not in stale:
                stale.append(t_tag)
    for exc in p.get("exceptions") or []:
        if not isinstance(exc, dict):
            continue
        s = exc.get("source_value", exc.get("source"))
        t = exc.get("target_value", exc.get("target"))
        if isinstance(s, str) and s not in src_vals and s not in stale:
            stale.append(s)
        if isinstance(t, str) and t not in tgt_vals and t not in stale:
            stale.append(t)
    return stale


def counts(findings: list[dict[str, Any]], ignored: Iterable[str] = ()) -> dict[str, int]:
    """Findings per severity, ignored ones left out."""
    skip = set(ignored)
    out = {PROBLEM: 0, WARNING: 0, TIDY: 0}
    for f in findings:
        if f["key"] not in skip:
            out[f["severity"]] += 1
    return out
