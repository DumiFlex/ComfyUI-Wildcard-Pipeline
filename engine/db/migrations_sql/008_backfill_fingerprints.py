"""Backfill ``modules.snapshot_fingerprint`` for any row left NULL by
migration 006.

Migration 006 added the column but deferred populating it until the next
write (``ModuleRepository.update``/``create``). Rows that haven't been
touched since the upgrade therefore carry NULL — and the import-export
collision detector flags those as ``exists-unknown`` (amber "EXISTING"
badge), which is correct but misleading: a freshly-exported-and-imported
NULL row looks "drifted" when the content is actually byte-identical.

Running the backfill eagerly here turns every NULL into the same djb2
hash ``create`` would produce, so identical content reads as
``silent-skip`` instead of ``exists-unknown``. Pure read+UPDATE; no
schema change, no version bump on the row itself (``version`` stays
where the user left it).
"""
from __future__ import annotations

import json
import sqlite3

from engine._fingerprint import module_fingerprint
from engine.modules.snapshot import payload_hash


def up(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT id, type, name, description, tags, payload "
        "FROM modules WHERE snapshot_fingerprint IS NULL;"
    ).fetchall()
    for row in rows:
        payload = json.loads(row["payload"])
        tags = json.loads(row["tags"])
        fp = module_fingerprint({
            "type": row["type"],
            "name": row["name"],
            "description": row["description"],
            "tags": tags,
            "payload_hash": payload_hash(payload),
        })
        conn.execute(
            "UPDATE modules SET snapshot_fingerprint = ? WHERE id = ?;",
            (fp, row["id"]),
        )
