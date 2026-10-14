"""Migration 021 -- pinned flag on AI assistant chats.

The chat list in the assistant's drawer lets the user pin a chat. A
pinned chat sorts first and is never pruned by the newest-100 cap
(``MAX_AI_CHATS``), so ``ai_chats`` gains ``pinned`` (INTEGER, 0 or 1,
default 0).

Local-only table, not a payload shape: no ``schema_version`` bump.

Idempotent: the ALTER is gated on ``PRAGMA table_info``.
"""
from __future__ import annotations

import sqlite3


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table});")
    return any(row[1] == column for row in cur.fetchall())


def up(conn: sqlite3.Connection) -> None:
    with conn:
        if not _has_column(conn, "ai_chats", "pinned"):
            conn.execute("ALTER TABLE ai_chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;")
