"""Per-mutation cleanup fixers for cascade-edit operations.

Each fixer handles one (kind, action) combination. All take a live
``sqlite3.Connection`` plus target identifiers, mutate affected entities
via repositories, and return:

    (touched, diff)

* ``touched`` — list of entity row dicts captured *before* mutation
  (BEFORE-state snapshots). Passed back to the orchestrator so it can
  persist them in the undo log.
* ``diff``    — list of lightweight index-patch dicts that describe what
  changed, keyed by ``entity_id``.

Contracts:
- Fixers do NOT delete the target entity. The orchestrator handles the
  primary mutation.
- Fixers do NOT write to ``cascade_undo``. The orchestrator persists the
  undo entry.
- All mutations go through repository methods — never raw SQL.
- Zero ComfyUI imports. Stdlib ``re`` + repositories only.

Caller contract (atomicity)
---------------------------
The caller (orchestrator at engine/cascade/orchestrator.py, Task 5)
MUST wrap each fixer call in an explicit BEGIN…COMMIT/ROLLBACK
transaction. Individual repository methods auto-commit via their
own `with conn:` blocks; the outer transaction the orchestrator
opens is the only rollback boundary if a fixer raises mid-loop.
Without an outer transaction, partial mutations are persisted.
"""
from __future__ import annotations

import copy
import re
import sqlite3
from typing import Any

from engine.db.repositories import BundleRepository, ModuleRepository
from engine.syntax.subcat_filter import ParseError as _ParseError
from engine.syntax.subcat_filter import parse as _parse_subcat
from engine.syntax.subcat_filter import reads_as as _reads_as

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _deepcopy_row(row: dict[str, Any]) -> dict[str, Any]:
    """Return a deep-copied snapshot of a row dict."""
    return copy.deepcopy(row)


def _rewrite_var_in_string(s: str, old_name: str, new_name: str) -> str:
    """Replace ``$old_name`` → ``$new_name`` word-boundary-safe.

    Uses a negative-lookbehind/lookahead so ``$mood`` matches but
    ``$moodier`` does not.
    """
    pattern = re.compile(
        r"\$" + re.escape(old_name) + r"(?![A-Za-z0-9_])"
    )
    return pattern.sub(f"${new_name}", s)


def _map_tags(ast: dict[str, Any] | None, fn) -> dict[str, Any] | None:
    """Apply *fn* to each tag leaf of a parsed sub-category expression;
    drop tags *fn* maps to ``None`` and collapse the now-childless
    operator (a one-child and/or becomes that child). Returns ``None``
    when the whole expression empties. Mirror of TS `mapTags`
    (src/manager/cascade/subcatExprCascade.ts)."""
    if ast is None:
        return None
    if "tag" in ast:
        v = fn(ast["tag"])
        return None if v is None else {"tag": v}
    if ast["op"] == "not":
        x = _map_tags(ast["x"], fn)
        return {"op": "not", "x": x} if x is not None else None
    kids = [k for k in (_map_tags(c, fn) for c in ast["kids"]) if k is not None]
    if not kids:
        return None
    return kids[0] if len(kids) == 1 else {"op": ast["op"], "kids": kids}


def _expr_tags(ast: dict[str, Any] | None) -> set[str]:
    out: set[str] = set()

    def walk(n: dict[str, Any] | None) -> None:
        if n is None:
            return
        if "tag" in n:
            out.add(n["tag"])
            return
        if n["op"] == "not":
            walk(n["x"])
            return
        for k in n["kids"]:
            walk(k)

    walk(ast)
    return out


def collect_tags(expr: str | None) -> set[str]:
    """Distinct sub-category tags referenced by a filter *expr* string.

    Mirror of TS ``collectTags`` (src/manager/cascade/subcatExprCascade.ts).
    Empty or malformed expressions yield the empty set — the caller simply
    won't link the ref; ``validate_expression`` surfaces real syntax errors
    elsewhere. Used by the discovery scan so a rename/delete of any one tag
    finds every ref whose boolean filter mentions it (negated tags count).
    """
    if not expr or not expr.strip():
        return set()
    try:
        ast = _parse_subcat(expr)
    except _ParseError:
        return set()
    return _expr_tags(ast)


def _ref_expr_pattern(wildcard_id: str) -> re.Pattern[str]:
    # 4-segment ref to a specific wildcard: groups = (#name, :expr, !null).
    return re.compile(
        r"@\{" + re.escape(wildcard_id)
        + r"(?:#([^#:}@{!]*))?(?::([^}!]*))?(?:!([^}]*))?\}"
    )


def _rewrite_ref_expr(s: str, wildcard_id: str, target: str, fn) -> str:
    """Rewrite the boolean ``:expr`` of every ``@{wildcard_id...}`` ref
    whose expression contains *target*, mapping its tags via *fn*
    (rename, or remove + collapse). Refs that don't mention *target* are
    left verbatim — no cosmetic re-serialization. ``#name`` + ``!null``
    are preserved; an expression that empties drops the ``:expr``
    segment, collapsing ``@{uuid:cold}`` to a bare ``@{uuid}``."""
    pattern = _ref_expr_pattern(wildcard_id)

    def repl(m: re.Match[str]) -> str:
        name, expr, null = m.group(1), m.group(2), m.group(3)
        if expr is None or not expr.strip():
            return m.group(0)
        ast = _parse_subcat(expr)
        if target not in _expr_tags(ast):
            return m.group(0)
        new_expr = _reads_as(_map_tags(ast, fn))
        out = "@{" + wildcard_id + (f"#{name}" if name else "")
        if new_expr:
            out += ":" + new_expr
        if null == "null":
            out += "!null"
        return out + "}"

    return pattern.sub(repl, s)


def _rewrite_subcat_ref_in_string(
    s: str,
    wildcard_id: str,
    old_subcat: str,
    new_subcat: str,
) -> str:
    """Rename ``old_subcat`` -> ``new_subcat`` inside every
    ``@{wildcard_id...}`` ref's boolean expression (e.g.
    ``@{u:warm or cold}`` -> ``@{u:warm or chilly}``). Structure,
    ``#name``, and ``!null`` are preserved."""
    return _rewrite_ref_expr(
        s, wildcard_id, old_subcat,
        lambda t: new_subcat if t == old_subcat else t,
    )


def _strip_subcat_ref_in_string(
    s: str,
    wildcard_id: str,
    subcat_name: str,
) -> str:
    """Remove ``subcat_name`` from every ``@{wildcard_id...}`` ref's
    expression, collapsing operators (``@{u:warm or cold}`` ->
    ``@{u:warm}``); a ref whose expression empties collapses to the bare
    ``@{wildcard_id}`` (the nested insertion survives, only its filter
    is dropped)."""
    return _rewrite_ref_expr(
        s, wildcard_id, subcat_name,
        lambda t: None if t == subcat_name else t,
    )


def _strip_whole_ref_in_string(s: str, wildcard_id: str) -> str:
    """Remove every whole ``@{wildcard_id...}`` token from *s*.

    Unlike ``_strip_subcat_ref_in_string`` (which only drops the
    ``:expr`` filter, collapsing to a bare ``@{uuid}``), this deletes the
    entire nested-insertion token — used by ``fix_wildcard_delete`` when
    the referenced wildcard itself is gone, so the insertion can't
    resolve at all. Surrounding text is preserved; whitespace left at the
    seam is collapsed (doubled spaces -> single) and the result trimmed,
    so ``"warm @{u} glow"`` -> ``"warm glow"`` rather than
    ``"warm  glow"``.

    Reuses the shared 4-segment ref pattern (``_ref_expr_pattern``) so the
    ``#name`` / ``:expr`` / ``!null`` variants of the token all match.
    """
    pattern = _ref_expr_pattern(wildcard_id)
    stripped = pattern.sub("", s)
    if stripped == s:
        return s
    # Collapse whitespace left at the seam, then trim edges.
    return re.sub(r"[ \t]{2,}", " ", stripped).strip()


def _rewrite_ref_name_in_string(
    s: str,
    wildcard_id: str,
    new_name: str,
) -> str:
    """Rewrite every ``@{wildcard_id...}`` ref in *s* so its ``#name``
    segment matches *new_name*. Bare-uuid refs gain the segment;
    refs that already carry an old name get it replaced. Subcat
    suffix is preserved.

    Empty *new_name* drops the segment entirely (canonical bare-uuid
    form), which lets the same fixer handle "name was cleared" later
    without a separate code path."""
    pattern = re.compile(
        r"@\{" + re.escape(wildcard_id)
        + r"(?:#[^#:}@{]*)?(:[^}]*)?\}"
    )
    name_seg = f"#{new_name}" if new_name else ""
    def repl(m: re.Match[str]) -> str:
        sub_seg = m.group(1) or ""
        return f"@{{{wildcard_id}{name_seg}{sub_seg}}}"
    return pattern.sub(repl, s)


# ---------------------------------------------------------------------------
# Public fixers
# ---------------------------------------------------------------------------

def fix_wildcard_delete(
    conn: sqlite3.Connection,
    wildcard_id: str,
    cleanup_ids: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Opt-in strip of nested ``@{wildcard_id...}`` refs to a deleted wildcard.

    Constraints are never DELETED here. They reference the wildcard by id
    only and are healable via the reattach UI — the cascade leaves them
    broken so the user can re-point them later, rather than deleting them
    (the old behavior, removed). The ONE constraint mutation that does run
    is a display-only name stamp: the deleted wildcard's name is cached onto
    every dependent constraint's ``source_wildcard_name`` /
    ``target_wildcard_name`` (the last moment the live name is known), so the
    broken-reference banner shows "(was …)" instead of a bare uuid. The
    id/matrix/exceptions stay untouched. The stamp is in `touched` (undo) but
    not in `diff` (it's not a ref removal). It runs regardless of cleanup_ids.

    Nested ``@{wildcard_id...}`` refs (the deleted wildcard inserted
    inside ANOTHER wildcard's option value, or a derivation action's
    string value) are stripped ONLY for the specific entity ids the
    caller lists in *cleanup_ids*. Every entity not in *cleanup_ids* is
    left untouched — its broken ref survives and is healed later via a
    remap. An empty/absent *cleanup_ids* therefore strips nothing: only
    the wildcard row itself is dropped (by the orchestrator), and all
    constraints + nested refs survive.

    For each entity in *cleanup_ids*:
      * ``wildcard`` — every ``@{wildcard_id...}`` token is removed from
        each ``options[].value`` string (whole token, surrounding text
        preserved).
      * ``derivation`` — same strip applied to every string value inside
        ``rules[].branches[].actions[]`` (mirrors ``_scan_wildcard_delete``).

    Bundles are intentionally NOT touched (unchanged): bundle children
    are full frozen snapshots, so the bundle keeps resolving with its
    captured payload even when the source library row is deleted.

    The fixer does NOT delete the wildcard row itself; the orchestrator
    owns that mutation.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    mod_repo = ModuleRepository(conn)

    # Stamp the about-to-be-deleted wildcard's name onto every dependent
    # constraint's source/target name cache, BEFORE the orchestrator drops the
    # row. This is the last moment the live name is known; without it a
    # constraint broken by the deletion shows only a bare uuid in the reattach
    # banner ("Source wildcard 1e9c0e2c is not in your library"). Display-only:
    # the id/matrix/exceptions are untouched and the constraint is never deleted
    # (still healable via reattach). Recorded in `touched` for undo but NOT
    # emitted as a `diff` entry — it's not a ref removal, so it must not inflate
    # affected_count. Runs regardless of cleanup_ids (the empty-cleanup
    # early-return is below).
    target = mod_repo.get(wildcard_id)
    wc_name = target.get("name") if target else None
    if wc_name:
        for c in mod_repo.list():
            if c["type"] != "constraint":
                continue
            cp = c.get("payload") or {}
            new_cp = copy.deepcopy(cp)
            stamped = False
            if cp.get("source_wildcard_id") == wildcard_id:
                if cp.get("source_wildcard_name") != wc_name:
                    new_cp["source_wildcard_name"] = wc_name
                    stamped = True
            if cp.get("target_wildcard_id") == wildcard_id:
                if cp.get("target_wildcard_name") != wc_name:
                    new_cp["target_wildcard_name"] = wc_name
                    stamped = True
            if stamped:
                touched.append(_deepcopy_row(c))
                mod_repo.update(c["id"], payload=new_cp)

    cleanup = set(cleanup_ids)
    if not cleanup:
        return touched, diff

    for m in mod_repo.list():
        if m["id"] not in cleanup:
            continue
        t = m["type"]
        p = m.get("payload") or {}
        new_payload = copy.deepcopy(p)
        changed = False

        if t == "wildcard":
            for opt in new_payload.get("options") or []:
                v = opt.get("value")
                if isinstance(v, str):
                    new_v = _strip_whole_ref_in_string(v, wildcard_id)
                    if new_v != v:
                        opt["value"] = new_v
                        changed = True

        elif t == "derivation":
            for rule in new_payload.get("rules") or []:
                for branch in rule.get("branches") or []:
                    for action in branch.get("actions") or []:
                        if not isinstance(action, dict):
                            continue
                        for k, v in list(action.items()):
                            if isinstance(v, str):
                                new_v = _strip_whole_ref_in_string(v, wildcard_id)
                                if new_v != v:
                                    action[k] = new_v
                                    changed = True

        if changed:
            touched.append(_deepcopy_row(m))
            mod_repo.update(m["id"], payload=new_payload)
            diff.append({
                "entity_id": m["id"],
                "remove_ref": {"kind": "wildcard", "wildcard_id": wildcard_id},
            })

    return touched, diff


def fix_subcat_delete(
    conn: sqlite3.Connection,
    wildcard_id: str,
    subcat_name: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Strip all references to ``wildcard_id:subcat_name``.

    * Source wildcard's ``options[].sub_categories`` — removes the name.
    * Constraint matrix keys (source-side) — removes the top-level key.
    * Constraint matrix values (target-side) — removes nested keys.
    * Other wildcards' option values — removes ``@{wildcard_id:subcat_name}``.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    repo = ModuleRepository(conn)

    for m in repo.list():
        t = m["type"]
        p = m.get("payload") or {}
        changed = False
        new_payload = copy.deepcopy(p)

        if t == "wildcard" and m["id"] == wildcard_id:
            # Top-level declared list
            declared = new_payload.get("sub_categories") or []
            if subcat_name in declared:
                new_payload["sub_categories"] = [
                    s for s in declared if s != subcat_name
                ]
                changed = True
            # Per-option membership — drop the deleted subcat from each
            # option's sub_categories list (preserves the option).
            for opt in new_payload.get("options") or []:
                subs = opt.get("sub_categories")
                if isinstance(subs, list) and subcat_name in subs:
                    opt["sub_categories"] = [s for s in subs if s != subcat_name]
                    changed = True

        elif t == "constraint":
            matrix = new_payload.get("matrix") or {}

            # Source-side: top-level matrix keys are source subcat names
            if (new_payload.get("source_wildcard_id") == wildcard_id
                    and subcat_name in matrix):
                del matrix[subcat_name]
                new_payload["matrix"] = matrix
                changed = True

            # Target-side: nested keys within each row value
            if new_payload.get("target_wildcard_id") == wildcard_id:
                for _row_key, row_val in list(matrix.items()):
                    if isinstance(row_val, dict) and subcat_name in row_val:
                        del row_val[subcat_name]
                        changed = True

        elif t == "wildcard" and m["id"] != wildcard_id:
            # Strip @{wildcard_id:subcat_name} text refs from option values
            for opt in new_payload.get("options") or []:
                v = opt.get("value")
                if isinstance(v, str):
                    new_v = _strip_subcat_ref_in_string(v, wildcard_id, subcat_name)
                    if new_v != v:
                        opt["value"] = new_v
                        changed = True

        if changed:
            touched.append(_deepcopy_row(m))
            repo.update(m["id"], payload=new_payload)
            diff.append({
                "entity_id": m["id"],
                "remove_ref": {"kind": "subcat", "wildcard_id": wildcard_id, "subcat": subcat_name},
            })

    return touched, diff


def fix_subcat_rename(
    conn: sqlite3.Connection,
    wildcard_id: str,
    old_name: str,
    new_name: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Rewrite all references to ``wildcard_id:old_name`` → ``wildcard_id:new_name``.

    * Source wildcard's ``options[].sub_categories``.
    * Constraint matrix keys (source-side) — renamed top-level key.
    * Constraint matrix values (target-side) — renamed nested keys.
    * Other wildcards' option values — ``@{uuid:old}`` → ``@{uuid:new}``.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    repo = ModuleRepository(conn)

    for m in repo.list():
        t = m["type"]
        p = m.get("payload") or {}
        changed = False
        new_payload = copy.deepcopy(p)

        if t == "wildcard" and m["id"] == wildcard_id:
            # Top-level declared sub_categories list
            declared = new_payload.get("sub_categories") or []
            if old_name in declared:
                new_payload["sub_categories"] = [
                    new_name if s == old_name else s for s in declared
                ]
                changed = True
            # Per-option membership list (`opt.sub_categories`)
            for opt in new_payload.get("options") or []:
                subs = opt.get("sub_categories")
                if isinstance(subs, list) and old_name in subs:
                    opt["sub_categories"] = [
                        new_name if s == old_name else s for s in subs
                    ]
                    changed = True

        elif t == "constraint":
            matrix = new_payload.get("matrix") or {}

            # Source-side: rename top-level matrix key
            if (new_payload.get("source_wildcard_id") == wildcard_id
                    and old_name in matrix):
                matrix[new_name] = matrix.pop(old_name)
                new_payload["matrix"] = matrix
                changed = True

            # Target-side: rename nested keys in each row
            if new_payload.get("target_wildcard_id") == wildcard_id:
                for row_val in matrix.values():
                    if isinstance(row_val, dict) and old_name in row_val:
                        row_val[new_name] = row_val.pop(old_name)
                        changed = True

        elif t == "wildcard" and m["id"] != wildcard_id:
            # Rewrite @{wildcard_id:old_name} → @{wildcard_id:new_name}
            for opt in new_payload.get("options") or []:
                v = opt.get("value")
                if isinstance(v, str):
                    new_v = _rewrite_subcat_ref_in_string(v, wildcard_id, old_name, new_name)
                    if new_v != v:
                        opt["value"] = new_v
                        changed = True

        if changed:
            touched.append(_deepcopy_row(m))
            repo.update(m["id"], payload=new_payload)
            diff.append({
                "entity_id": m["id"],
                "rename_ref": {
                    "kind": "subcat",
                    "wildcard_id": wildcard_id,
                    "old": old_name,
                    "new": new_name,
                },
            })

    return touched, diff


def fix_wildcard_rename_name(
    conn: sqlite3.Connection,
    wildcard_id: str,
    new_name: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Rewrite every ``@{wildcard_id...}`` ref so its ``#name`` segment
    matches *new_name*. Walks the same surfaces ``fix_wildcard_delete``
    + ``fix_subcat_rename`` cover for ref strings:

    * Other wildcards' option values.
    * Derivation rules' action string values (the only surface besides
      wildcards where ``@{}`` text refs are resolved).

    Combine templates, fixed-values, and constraint payloads don't hold
    ``@{}`` text refs (constraints reference by id only via
    ``source_wildcard_id`` / ``target_wildcard_id``), so they're
    skipped. Bundle children are frozen point-in-time snapshots and are
    intentionally NOT rewritten (mirrors ``fix_wildcard_delete``): a rename
    leaves the bundle's cached ``#name`` / refs stale until the user
    explicitly refreshes the bundle. Otherwise editing ANY module would
    silently mutate every bundle holding a snapshot of it — a bundle must
    stay a fixed snapshot, not auto-track its source modules.

    Skips the renamed wildcard itself — its own name lives on the row,
    not in its own option values.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    mod_repo = ModuleRepository(conn)

    for m in mod_repo.list():
        if m["id"] == wildcard_id:
            continue
        t = m["type"]
        p = m.get("payload") or {}
        new_payload = copy.deepcopy(p)
        changed = False

        if t == "wildcard":
            for opt in new_payload.get("options") or []:
                v = opt.get("value")
                if isinstance(v, str):
                    new_v = _rewrite_ref_name_in_string(v, wildcard_id, new_name)
                    if new_v != v:
                        opt["value"] = new_v
                        changed = True

        elif t == "derivation":
            for rule in new_payload.get("rules") or []:
                for branch in rule.get("branches") or []:
                    for action in branch.get("actions") or []:
                        if not isinstance(action, dict):
                            continue
                        for k, v in list(action.items()):
                            if isinstance(v, str):
                                new_v = _rewrite_ref_name_in_string(v, wildcard_id, new_name)
                                if new_v != v:
                                    action[k] = new_v
                                    changed = True

        if changed:
            touched.append(_deepcopy_row(m))
            mod_repo.update(m["id"], payload=new_payload)
            diff.append({
                "entity_id": m["id"],
                "rename_ref": {
                    "kind": "wildcard_name",
                    "wildcard_id": wildcard_id,
                    "new": new_name,
                },
            })

    # Bundle children are frozen snapshots — intentionally NOT rewritten
    # here (see docstring). They drift; the explicit bundle-refresh flow
    # re-snapshots them on demand, so a module edit never auto-mutates a
    # bundle.
    return touched, diff


def fix_bundle_delete(
    conn: sqlite3.Connection,
    bundle_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Strip every ``{type: "bundle", id: bundle_id}`` ref from other
    bundles' ``children[]`` lists. Mirrors `fix_wildcard_delete` for
    bundles — when a bundle is removed, parent bundles holding it as
    a tier-2 ref are cleaned so they don't ship `_missing_ref` on
    their next GET expansion.

    The fixer does NOT delete the bundle row itself; the orchestrator
    owns that mutation. Skips self-reference (tier-2 cap forbids it,
    defensive).
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []
    bundle_repo = BundleRepository(conn)

    for b in bundle_repo.list():
        if b["id"] == bundle_id:
            continue
        children = b.get("children") or []
        new_children = [
            ch for ch in children
            if not (ch.get("type") == "bundle" and ch.get("id") == bundle_id)
        ]
        if len(new_children) != len(children):
            touched.append(_deepcopy_row(b))
            bundle_repo.update(b["id"], children=new_children)
            diff.append({
                "entity_id": b["id"],
                "remove_ref": {"kind": "bundle", "id": bundle_id},
            })

    return touched, diff


def fix_combine_output_var_rename(
    conn: sqlite3.Connection,
    combine_id: str,
    old_name: str,
    new_name: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Rename a combine's output variable and all ``$old_name`` references.

    * Combine's ``output_var`` field updated to *new_name*.
    * Other wildcards: ``$old_name`` → ``$new_name`` in option values.
    * Derivations: ``$old_name`` → ``$new_name`` in action string values;
      ``set_var: "old_name"`` → ``set_var: "new_name"``.
    * Other combines: ``$old_name`` → ``$new_name`` in template.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    repo = ModuleRepository(conn)

    for m in repo.list():
        t = m["type"]
        p = m.get("payload") or {}
        changed = False
        new_payload = copy.deepcopy(p)

        if t == "combine" and m["id"] == combine_id:
            # Update the combine's own output_var
            if new_payload.get("output_var") == old_name:
                new_payload["output_var"] = new_name
                changed = True
            # Also rewrite $old in its own template in case it self-references
            tpl = new_payload.get("template", "")
            if isinstance(tpl, str):
                new_tpl = _rewrite_var_in_string(tpl, old_name, new_name)
                if new_tpl != tpl:
                    new_payload["template"] = new_tpl
                    changed = True

        elif t == "wildcard":
            for opt in new_payload.get("options") or []:
                v = opt.get("value")
                if isinstance(v, str):
                    new_v = _rewrite_var_in_string(v, old_name, new_name)
                    if new_v != v:
                        opt["value"] = new_v
                        changed = True

        elif t == "derivation":
            for rule in new_payload.get("rules") or []:
                for branch in rule.get("branches") or []:
                    for action in branch.get("actions") or []:
                        if not isinstance(action, dict):
                            continue
                        for k in list(action.keys()):
                            v = action[k]
                            if k == "set_var" and v == old_name:
                                action[k] = new_name
                                changed = True
                            elif isinstance(v, str):
                                new_v = _rewrite_var_in_string(v, old_name, new_name)
                                if new_v != v:
                                    action[k] = new_v
                                    changed = True

        elif t == "combine" and m["id"] != combine_id:
            tpl = new_payload.get("template", "")
            if isinstance(tpl, str):
                new_tpl = _rewrite_var_in_string(tpl, old_name, new_name)
                if new_tpl != tpl:
                    new_payload["template"] = new_tpl
                    changed = True

        if changed:
            touched.append(_deepcopy_row(m))
            repo.update(m["id"], payload=new_payload)
            diff.append({
                "entity_id": m["id"],
                "rename_ref": {"kind": "var", "old": old_name, "new": new_name},
            })

    return touched, diff


def fix_option_delete(
    conn: sqlite3.Connection,
    wildcard_id: str,
    option_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Remove option from source wildcard + scrub it from constraint exceptions.

    Standard fixer contract: returns (touched_snapshots, diff). The
    orchestrator's outer ``with conn:`` is the rollback boundary; this
    function neither opens nor commits a transaction.

    Matching is by stable ``option_id`` so a value-rename (which keeps
    the id) does not silently delete the wrong option.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []
    repo = ModuleRepository(conn)

    # --- Source wildcard: remove option entry --------------------------
    src = repo.get(wildcard_id)
    new_payload = copy.deepcopy(src.get("payload") or {})
    original_opts = list(new_payload.get("options") or [])
    new_options = [o for o in original_opts if o.get("id") != option_id]
    if len(new_options) == len(original_opts):
        # Option already missing; nothing to do.
        return touched, diff

    touched.append(_deepcopy_row(src))
    new_payload["options"] = new_options
    repo.update(wildcard_id, payload=new_payload)
    diff.append({"entity_id": wildcard_id, "remove_option": option_id})

    # --- Constraints: drop exceptions referencing option_id ------------
    for m in repo.list():
        if m["type"] != "constraint":
            continue
        p = m.get("payload") or {}
        exceptions = p.get("exceptions") or []
        kept = [
            e for e in exceptions
            if e.get("source_id") != option_id and e.get("target_id") != option_id
        ]
        if len(kept) == len(exceptions):
            continue
        touched.append(_deepcopy_row(m))
        new_p = copy.deepcopy(p)
        new_p["exceptions"] = kept
        repo.update(m["id"], payload=new_p)
        diff.append({
            "entity_id": m["id"],
            "remove_ref": {"kind": "option", "option_id": option_id},
        })

    return touched, diff


def fix_category_delete(
    conn: sqlite3.Connection,
    category_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Null out ``category_id`` on every module referencing *category_id*.

    Does NOT delete the category row itself; the orchestrator handles that.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    repo = ModuleRepository(conn)

    for m in repo.list():
        if m.get("category_id") == category_id:
            touched.append(_deepcopy_row(m))
            repo.update(m["id"], category_id=None)
            diff.append({
                "entity_id": m["id"],
                "remove_ref": {"kind": "category", "id": category_id},
            })

    return touched, diff
