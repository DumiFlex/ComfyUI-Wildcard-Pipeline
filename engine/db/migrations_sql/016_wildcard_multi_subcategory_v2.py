"""Migration 016: wildcard multi-sub-category v2 (SP1).

Marches every stale row from schema_version 1 -> 2 by eager iteration of
the lazy-read routine (see `_014_helpers.run_bulk_lazy`), using the SP1
per-row migrators. The transform:

  * option `sub_category: "x"` -> `sub_categories: ["x"]`;
  * sub-category names slugified (whitespace / grammar chars -> `_`),
    reserved words suffixed, de-duped, cascaded to options + groups;
  * nested `@{uuid:a,b,null}` refs -> `@{uuid:a or b!null}`.

See engine/migrations/v1_to_v2.py for the shared transform + the envelope
mirror used by import/export, and CLAUDE.md "Schema versioning".

Idempotent: rows already at schema_version 2 are not stale, so a re-run
(or a run on a fresh DB with no v1 rows) is a no-op. validators /
tolerant_strip are empty — the forward 1->2 chain needs neither (there is
no future-shaped `original_payload_json` to recover at this bump).
"""
from __future__ import annotations

import sqlite3

from engine.db.migrations_sql._014_helpers import run_bulk_lazy
from engine.migrations.v1_to_v2 import (
    migrate_bundle_v1_to_v2,
    migrate_module_v1_to_v2,
)


def up(conn: sqlite3.Connection) -> None:
    run_bulk_lazy(
        conn,
        current_version=2,
        migrators={
            ("module", 1): migrate_module_v1_to_v2,
            ("bundle", 1): migrate_bundle_v1_to_v2,
        },
        validators={},
        tolerant_strip={},
    )
