"""Backfill the `#name` segment into every `@{uuid}` / `@{uuid:subcat}` ref.

The ref grammar gained an optional `#name` cache so a broken ref can
still tell the user which wildcard it pointed at. Existing rows store
bare-uuid refs; this migration walks every surface that holds ref
strings and rewrites them with the current library name.

Surfaces walked:
* `wildcard.payload.options[].value` — other wildcards' option text.
* `derivation.payload.rules[].branches[].actions[].*` — derivation
  rules' string action fields (the only non-wildcard surface where
  `@{uuid}` refs resolve at runtime).
* `bundle.children[].payload.options[].value` — frozen module
  snapshots inside bundle library entries. Same shape as live
  wildcards, walked separately so the snapshot survives in lockstep.

Refs whose target uuid doesn't resolve to a live wildcard are left
unchanged (bare-uuid form). On the next save the cascade-rename fixer
will either fill them in or the user re-attaches the missing entry.

The migration is forward-only and idempotent: refs that already
carry a `#name` segment (e.g. authored after this code lands) pass
through unchanged. payload_hash + fingerprint columns are recomputed
in-place by the repository layer the next time each row is updated;
this script only touches the JSON blobs so the workflow JSON the
engine reads is consistent with the new tokenizer.
"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

# Same shape as `engine/syntax/tokenize.py:_REF_RE` minus the anchors.
# Groups: 1=uuid, 2=optional existing name, 3=optional subcat list.
_REF_RE = re.compile(r"@\{([0-9a-f]{8})(?:#([^#:}@{]*))?(?::([^}]*))?\}")


def _build_wildcard_name_map(conn: sqlite3.Connection) -> dict[str, str]:
    """{uuid → current display name} for every wildcard in the library."""
    cur = conn.cursor()
    cur.execute("SELECT id, name FROM modules WHERE type = 'wildcard';")
    return {row["id"]: row["name"] for row in cur.fetchall()}


def _rewrite_ref_string(s: str, name_map: dict[str, str]) -> str:
    """Apply the name cache to every ref in *s*. Returns the input
    unchanged when no rewrite was needed (preserves identity so the
    caller can cheaply detect changes)."""
    def repl(m: re.Match[str]) -> str:
        uuid = m.group(1)
        old_name = m.group(2)
        subcat = m.group(3)
        live_name = name_map.get(uuid)
        # Skip refs whose target wildcard is gone — bare-uuid form is
        # honest signal that the ref is broken.
        if live_name is None:
            return m.group(0)
        # Idempotency: if the existing name already matches live, no-op.
        if old_name == live_name:
            return m.group(0)
        sub_seg = f":{subcat}" if subcat is not None else ""
        return f"@{{{uuid}#{live_name}{sub_seg}}}"
    return _REF_RE.sub(repl, s)


def _walk_wildcard_payload(payload: dict[str, Any], name_map: dict[str, str]) -> bool:
    """In-place mutate option values. Returns True when anything changed."""
    changed = False
    for opt in payload.get("options") or []:
        v = opt.get("value")
        if isinstance(v, str):
            new_v = _rewrite_ref_string(v, name_map)
            if new_v != v:
                opt["value"] = new_v
                changed = True
    return changed


def _walk_derivation_payload(payload: dict[str, Any], name_map: dict[str, str]) -> bool:
    """In-place mutate string fields on rule actions."""
    changed = False
    for rule in payload.get("rules") or []:
        for branch in rule.get("branches") or []:
            for action in branch.get("actions") or []:
                if not isinstance(action, dict):
                    continue
                for k, v in list(action.items()):
                    if isinstance(v, str):
                        new_v = _rewrite_ref_string(v, name_map)
                        if new_v != v:
                            action[k] = new_v
                            changed = True
    return changed


def _walk_bundle_children(
    children: list[Any], name_map: dict[str, str],
) -> bool:
    """In-place mutate children list. Mirrors the engine fixer's bundle
    walk — module snapshots get their option values rewritten."""
    changed = False
    for ch in children:
        if not isinstance(ch, dict):
            continue
        if ch.get("type") != "wildcard":
            continue
        payload = ch.get("payload")
        if isinstance(payload, dict):
            if _walk_wildcard_payload(payload, name_map):
                changed = True
    return changed


def up(conn: sqlite3.Connection) -> None:
    name_map = _build_wildcard_name_map(conn)
    if not name_map:
        return  # empty library — nothing to rewrite

    # Modules — wildcards + derivations carry ref strings.
    cur = conn.cursor()
    cur.execute(
        "SELECT id, type, payload FROM modules "
        "WHERE type IN ('wildcard', 'derivation');"
    )
    rows = cur.fetchall()
    for row in rows:
        try:
            payload = json.loads(row["payload"])
        except (TypeError, json.JSONDecodeError):
            continue
        if row["type"] == "wildcard":
            changed = _walk_wildcard_payload(payload, name_map)
        else:
            changed = _walk_derivation_payload(payload, name_map)
        if changed:
            conn.execute(
                "UPDATE modules SET payload = ? WHERE id = ?;",
                (json.dumps(payload), row["id"]),
            )

    # Bundles — children snapshots may carry ref strings inside frozen
    # module copies.
    cur.execute("SELECT id, children FROM bundles;")
    bundle_rows = cur.fetchall()
    for row in bundle_rows:
        try:
            children = json.loads(row["children"]) if row["children"] else []
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(children, list):
            continue
        if _walk_bundle_children(children, name_map):
            conn.execute(
                "UPDATE bundles SET children = ? WHERE id = ?;",
                (json.dumps(children), row["id"]),
            )

    conn.commit()
