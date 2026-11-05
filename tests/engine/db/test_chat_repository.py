"""Migration 020 + ChatRepository: the AI assistant's stored chats."""
from __future__ import annotations

import sqlite3

import pytest

from engine.db import repositories
from engine.db.migrations import migrate
from engine.db.repositories import ChatNotFound, ChatRepository


@pytest.fixture
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    migrate(conn)
    return conn


def test_020_tables_exist_and_rerun_is_harmless(db: sqlite3.Connection) -> None:
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"ai_chats", "ai_chat_messages"} <= tables
    migrate(db)


def test_create_append_and_read_back(db: sqlite3.Connection) -> None:
    repo = ChatRepository(db)
    chat = repo.create(title="Hair", snapshot="The library now:", meta={"format": "json"})
    assert len(chat["id"]) == 8 and chat["meta"] == {"format": "json"}
    repo.append(chat["id"], [{"kind": "user", "text": "hi", "sent": "hi"}],
                meta={"format": "json", "proposals": {}})
    repo.append(chat["id"], [{"kind": "step", "text": "yo", "calls": []}],
                meta={"format": "native"})
    assert [m["kind"] for m in repo.messages(chat["id"])] == ["user", "step"]
    assert repo.get(chat["id"])["meta"] == {"format": "native"}
    repo.set_meta(chat["id"], {"x": 1})
    assert repo.get(chat["id"])["meta"] == {"x": 1}
    repo.delete(chat["id"])
    with pytest.raises(ChatNotFound):
        repo.get(chat["id"])
    assert repo.messages(chat["id"]) == []
    with pytest.raises(ChatNotFound):
        repo.append("deadbeef", [], meta={})


def test_old_chats_are_pruned(db: sqlite3.Connection, monkeypatch) -> None:
    monkeypatch.setattr(repositories, "MAX_AI_CHATS", 2)
    repo = ChatRepository(db)
    first = repo.create(title="a")
    repo.append(first["id"], [{"kind": "user", "text": "a", "sent": "a"}], meta={})
    db.execute("UPDATE ai_chats SET updated_at = '2000-01-01' WHERE id = ?", (first["id"],))
    repo.create(title="b")
    repo.create(title="c")
    with pytest.raises(ChatNotFound):
        repo.get(first["id"])
    assert repo.messages(first["id"]) == []
