"""Backfill stable per-option ids and migrate constraint exception strings.

After this migration:
* Every wildcard's payload.options[i] has a unique 8-hex `id` field.
* Every constraint's payload.exceptions[i] references options by
  `source_id` / `target_id` instead of value strings.
* Exceptions whose source or target string can no longer be resolved
  against the current option list are moved to `broken_exceptions[]`
  with a `reason` field describing the failure mode (source_value not
  found, target_value not found, source_wildcard missing,
  target_wildcard missing, ambiguous_match).

The migration is forward-only. The runner ensures it only applies
once, but the implementation is defensive: existing option ids are
preserved, and exceptions already in the new shape are left untouched.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
from typing import Any


def _load_modules(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    cur = conn.cursor()
    cur.execute(
        "SELECT id, type, payload FROM modules WHERE type IN ('wildcard', 'constraint');"
    )
    rows = cur.fetchall()
    return [
        {"id": r["id"], "type": r["type"], "payload": json.loads(r["payload"])}
        for r in rows
    ]


def _backfill_option_ids(payload: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    changed = False
    new_opts = []
    for opt in payload.get("options") or []:
        new_opt = dict(opt)
        if not isinstance(new_opt.get("id"), str) or not new_opt["id"]:
            new_opt["id"] = secrets.token_hex(4)
            changed = True
        new_opts.append(new_opt)
    if changed:
        payload = dict(payload)
        payload["options"] = new_opts
    return changed, payload


def _option_value_index(wc: dict[str, Any]) -> tuple[dict[str, str], set[str]]:
    """Return (value_to_id_map, ambiguous_values_set) for one wildcard."""
    value_to_id: dict[str, str] = {}
    counts: dict[str, int] = {}
    for opt in wc["payload"].get("options") or []:
        v = opt.get("value")
        oid = opt.get("id")
        if not isinstance(v, str) or not isinstance(oid, str):
            continue
        counts[v] = counts.get(v, 0) + 1
        value_to_id[v] = oid
    ambiguous = {v for v, count in counts.items() if count > 1}
    return value_to_id, ambiguous


def _resolve_axis(
    value: Any,
    wildcard_id: str | None,
    wildcards_by_id: dict[str, dict[str, Any]],
    axis_label: str,
) -> tuple[str | None, str | None]:
    """Return (option_id, reason) for a single exception axis.

    On success: (id, None). On failure: (None, reason_string).
    """
    if wildcard_id is None:
        return None, f"{axis_label}_wildcard_id missing"
    if wildcard_id not in wildcards_by_id:
        return None, f"{axis_label}_wildcard missing"
    if not isinstance(value, str):
        return None, f"{axis_label}_value not a string"
    lookup, ambiguous = _option_value_index(wildcards_by_id[wildcard_id])
    if value in ambiguous:
        return None, f"ambiguous_match: {axis_label}"
    if value not in lookup:
        return None, f"{axis_label}_value not found: {value!r}"
    return lookup[value], None


def _migrate_constraint_exceptions(
    payload: dict[str, Any],
    wildcards_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    src_id = payload.get("source_wildcard_id")
    tgt_id = payload.get("target_wildcard_id")

    new_exceptions: list[dict[str, Any]] = []
    broken: list[dict[str, Any]] = list(payload.get("broken_exceptions") or [])

    for ex in payload.get("exceptions") or []:
        if "source_id" in ex and "target_id" in ex:
            new_exceptions.append(ex)
            continue

        sid, sreason = _resolve_axis(ex.get("source"), src_id, wildcards_by_id, "source")
        if sreason:
            broken.append({**ex, "reason": sreason})
            continue
        tid, treason = _resolve_axis(ex.get("target"), tgt_id, wildcards_by_id, "target")
        if treason:
            broken.append({**ex, "reason": treason})
            continue

        # Keep `source` / `target` value strings alongside new ids.
        # The runtime constraint resolver still keys instance-override
        # lookups by encoded (source_value, target_value) pairs (see
        # `engine/modules/constraint_handler.py`'s exception loop), so
        # dropping the legacy fields would break Tier-2 overrides for
        # any constraint touched by this migration. Cascade indexing
        # uses `source_id`/`target_id`; runtime stays on value strings.
        migrated = dict(ex)
        migrated["source_id"] = sid
        migrated["target_id"] = tid
        new_exceptions.append(migrated)

    payload = dict(payload)
    payload["exceptions"] = new_exceptions
    if broken:
        payload["broken_exceptions"] = broken
    return payload


def up(conn: sqlite3.Connection) -> None:
    mods = _load_modules(conn)
    wildcards_by_id: dict[str, dict[str, Any]] = {}

    cur = conn.cursor()
    # Pass 1: backfill option ids on every wildcard.
    for m in mods:
        if m["type"] != "wildcard":
            continue
        changed, new_payload = _backfill_option_ids(m["payload"])
        m["payload"] = new_payload
        if changed:
            cur.execute(
                "UPDATE modules SET payload = ? WHERE id = ?;",
                (json.dumps(new_payload), m["id"]),
            )
        wildcards_by_id[m["id"]] = m

    # Pass 2: migrate constraint exceptions.
    for m in mods:
        if m["type"] != "constraint":
            continue
        migrated = _migrate_constraint_exceptions(m["payload"], wildcards_by_id)
        if migrated != m["payload"]:
            cur.execute(
                "UPDATE modules SET payload = ? WHERE id = ?;",
                (json.dumps(migrated), m["id"]),
            )
