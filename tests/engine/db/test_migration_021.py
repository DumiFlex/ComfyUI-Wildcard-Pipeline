"""Migration 021: pinned AI chats."""
from __future__ import annotations

import importlib
import sqlite3

from engine.db.migrations import migrate
from engine.db.repositories import MAX_AI_CHATS, ChatRepository


def _conn(_tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    migrate(conn)
    return conn


def test_column_exists_with_default(tmp_path):
    conn = _conn(tmp_path)
    cols = {r[1]: r for r in conn.execute("PRAGMA table_info(ai_chats);").fetchall()}
    assert "pinned" in cols
    chat = ChatRepository(conn).create(title="t")
    assert chat["pinned"] is False


def test_rerun_is_idempotent(tmp_path):
    conn = _conn(tmp_path)
    mod = importlib.import_module("engine.db.migrations_sql.021_ai_chat_pins")
    mod.up(conn)
    mod.up(conn)


def test_list_rename_pin_and_prune_keeps_pins(tmp_path):
    conn = _conn(tmp_path)
    repo = ChatRepository(conn)
    first = repo.create(title="Hats")
    repo.append(first["id"], [{"kind": "user", "text": "make hats", "sent": "make hats"}],
                meta={})
    before = repo.get(first["id"])["updated_at"]
    repo.update(first["id"], title="Hat ideas", pinned=True)
    got = repo.get(first["id"])
    assert got["title"] == "Hat ideas" and got["pinned"] is True
    # Renaming and pinning aren't activity.
    assert got["updated_at"] == before
    for i in range(MAX_AI_CHATS + 3):
        repo.create(title=f"c{i}")
    rows = repo.list()
    assert rows[0]["id"] == first["id"] and rows[0]["turns"] == 1
    assert len(rows) == MAX_AI_CHATS + 1
    assert [r["id"] for r in repo.list("make hat")] == [first["id"]]
    assert repo.list("100%") == []


def test_truncate_drops_the_tail_only(tmp_path):
    conn = _conn(tmp_path)
    repo = ChatRepository(conn)
    chat = repo.create(title="t")
    repo.append(chat["id"], [{"kind": "user", "text": str(i)} for i in range(5)], meta={})
    repo.truncate(chat["id"], 3, meta={"x": 1})
    assert [e["text"] for e in repo.messages(chat["id"])] == ["0", "1", "2"]
    repo.truncate(chat["id"], 10, meta={})
    assert len(repo.messages(chat["id"])) == 3
    repo.append(chat["id"], [{"kind": "user", "text": "new"}], meta={})
    assert repo.messages(chat["id"])[-1]["text"] == "new"
