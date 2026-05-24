"""Migration 011: cleaner_presets table + built-in intensity seeding.

Schema mirrors the modules table for consistency — same id/name/desc/
tags/payload/payload_hash/version/timestamps. The `is_builtin` flag
marks the 3 seeded presets read-only at the API layer (PUT/DELETE
return 403). The migration is idempotent: INSERT OR IGNORE skips
re-seeding on repeat runs (defensive, even though the runner already
guards against double-application via the migrations version table).
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone

from engine.cleaner.pipeline import INTENSITY_TO_RULES

_BUILTIN_PRESETS = [
    ("builtin-gentle", "gentle"),
    ("builtin-balanced", "balanced"),
    ("builtin-aggressive", "aggressive"),
]


def _payload_for(intensity: str) -> dict:
    assert intensity in INTENSITY_TO_RULES
    return {
        "intensity": intensity,
        "mode": "tags",
        "rules_override": {},
        "blocklist": {"kind": "list", "entries": []},
    }


def _hash_payload(payload: dict) -> str:
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def up(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS cleaner_presets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category_id TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            is_favorite INTEGER NOT NULL DEFAULT 0,
            is_builtin  INTEGER NOT NULL DEFAULT 0,
            payload TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_cleaner_presets_name "
        "ON cleaner_presets(name);"
    )
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for preset_id, intensity in _BUILTIN_PRESETS:
        payload = _payload_for(intensity)
        cur.execute(
            """
            INSERT OR IGNORE INTO cleaner_presets
                (id, name, description, tags, is_builtin, payload, payload_hash,
                 version, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?, ?)
            """,
            (
                preset_id,
                intensity,
                f"Built-in {intensity} intensity",
                "[]",
                json.dumps(payload),
                _hash_payload(payload),
                now,
                now,
            ),
        )
