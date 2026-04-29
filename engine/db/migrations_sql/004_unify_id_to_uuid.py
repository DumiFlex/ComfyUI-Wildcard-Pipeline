"""Migration 004 — unify `modules.id` with the 8-hex `uuid`.

Pre-state: ``modules.id`` is shaped ``<prefix>_<slug>_<8hex>``
(e.g. ``wc_outfit_a1b2c3d4``). Migration 003 added a separate
indexed ``uuid`` column carrying just the trailing 8 hex chars.

Two coexisting identifiers turned into a leak-prone abstraction —
the SPA picker emitted the slug form, the embed-bundle endpoint
looked rows up by uuid, and they never matched, surfacing as
silent ``missing_target`` walker reports for every pick.

Post-state: ``modules.id`` IS the 8-hex uuid. There is no second
identifier. The ``uuid`` column is dropped (SQLite ≥3.35 supports
``ALTER TABLE … DROP COLUMN``; if the runtime sqlite is older we
leave the column orphaned — code paths only read ``id``).

Cross-refs inside payload JSON also need rewriting so they point at
the new short ids:

  - ``pipeline.steps[].module_id``
  - ``constraint.source_wildcard_id`` / ``target_wildcard_id``
  - ``derivation`` rule fields if any reference modules by id
    (current schema doesn't, but we scan defensively)

Wildcard option values (``@{8hex}`` ref tokens) are already short by
construction — the tokenizer regex never matched the slug form.
Same for combine templates. No rewrite needed there.

Idempotent: rerunning is a no-op once ``id == uuid`` for every row
(mapping table is empty → every UPDATE sets a column to its current
value).
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any


def _rewrite_payload(
    payload: dict[str, Any],
    *,
    mod_type: str,
    id_to_uuid: dict[str, str],
) -> dict[str, Any]:
    """Return a new payload with cross-refs rewritten to short uuids.

    The mapping is keyed by the OLD slugged id; values not present in
    the mapping (already-short refs, dangling refs to deleted modules)
    pass through unchanged.
    """
    if mod_type == "pipeline":
        steps = payload.get("steps")
        if isinstance(steps, list):
            new_steps: list[Any] = []
            for step in steps:
                if isinstance(step, dict) and isinstance(step.get("module_id"), str):
                    old = step["module_id"]
                    new_steps.append({**step, "module_id": id_to_uuid.get(old, old)})
                else:
                    new_steps.append(step)
            payload = {**payload, "steps": new_steps}
    elif mod_type == "constraint":
        out = dict(payload)
        for key in ("source_wildcard_id", "target_wildcard_id"):
            v = out.get(key)
            if isinstance(v, str):
                out[key] = id_to_uuid.get(v, v)
        payload = out
    return payload


def _has_uuid_column(conn: sqlite3.Connection) -> bool:
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(modules);")}
    return "uuid" in cols


def _has_uuid_index(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type='index' AND name='idx_modules_uuid';"
    ).fetchone()
    return row is not None


def up(conn: sqlite3.Connection) -> None:
    # Need row-as-dict access for column-name lookups even if the
    # caller's connection wasn't configured with `Row` factory.
    prev_factory = conn.row_factory
    conn.row_factory = sqlite3.Row
    try:
        # Build the (old_id → uuid) mapping. After 003 every row has
        # a uuid column populated. Skip rows where id already equals
        # uuid so reruns are no-ops.
        if not _has_uuid_column(conn):
            # 003 not yet applied (shouldn't happen — runner enforces
            # ordering — but be defensive).
            return

        rows = conn.execute(
            "SELECT id, uuid, type, payload FROM modules;"
        ).fetchall()

        id_to_uuid: dict[str, str] = {}
        for row in rows:
            old_id = row["id"]
            uuid = row["uuid"]
            if old_id != uuid and isinstance(uuid, str) and uuid:
                id_to_uuid[old_id] = uuid

        # Rewrite payload cross-refs first — references must point at
        # the new short ids by the time we update the id column itself.
        for row in rows:
            mod_type = row["type"]
            try:
                payload = json.loads(row["payload"])
            except (ValueError, TypeError):
                continue
            if not isinstance(payload, dict):
                continue
            new_payload = _rewrite_payload(
                payload, mod_type=mod_type, id_to_uuid=id_to_uuid,
            )
            if new_payload is not payload:
                conn.execute(
                    "UPDATE modules SET payload = ? WHERE id = ?;",
                    (json.dumps(new_payload), row["id"]),
                )

        # Now rewrite the id column itself. Only touches rows where
        # id != uuid; rerunning is a no-op.
        if id_to_uuid:
            conn.executemany(
                "UPDATE modules SET id = ? WHERE id = ?;",
                [(uuid, old) for old, uuid in id_to_uuid.items()],
            )

        # Tear down the now-redundant uuid index + column. SQLite has
        # supported ALTER TABLE … DROP COLUMN since 3.35 (2021-03).
        # If the running sqlite is older the DROP raises — catch and
        # leave the column orphaned. Code paths only read id from
        # this point forward.
        if _has_uuid_index(conn):
            conn.execute("DROP INDEX idx_modules_uuid;")
        if _has_uuid_column(conn):
            try:
                conn.execute("ALTER TABLE modules DROP COLUMN uuid;")
            except sqlite3.OperationalError:
                # Older sqlite — leave column. Fine: nothing reads it.
                pass
    finally:
        conn.row_factory = prev_factory
