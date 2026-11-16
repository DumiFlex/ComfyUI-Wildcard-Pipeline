"""`GET /wp/api/ai/index` skips loading the library and syncing when nothing
changed since the last sync (`engine.ai.index.library_stamp`)."""
from __future__ import annotations

import pytest

from engine.ai import config as ai_config
from engine.ai import index as ai_index
from engine.db.connection import get_connection
from engine.db.migrations import migrate
from wp_api import _ai_context


def _wildcard(name: str, var: str) -> dict:
    return {"type": "wildcard", "name": name,
            "payload": {"var_binding": var, "options": [{"id": "o1", "value": "x", "weight": 1}]}}


@pytest.fixture
def counted(monkeypatch):
    loads: list[int] = []
    real = _ai_context.load_library

    def counting(conn):
        loads.append(1)
        return real(conn)

    monkeypatch.setattr(_ai_context, "load_library", counting)
    return loads


async def test_unchanged_library_is_not_loaded_again(wp_client, fake_llm, counted):
    if not ai_index.has_fts5():
        pytest.skip("SQLite without FTS5")
    _ai_context._INDEXES.clear()
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    resp = await wp_client.post("/wp/api/modules", json=_wildcard("Hair", "hair"))
    assert resp.status in (200, 201)
    first = await (await wp_client.get("/wp/api/ai/index")).json()
    assert first["items"] == 1 and counted == [1]
    for _ in range(3):
        again = await (await wp_client.get("/wp/api/ai/index")).json()
        assert again == first
    assert counted == [1]
    # A change is picked up.
    created = await (await wp_client.post("/wp/api/modules", json=_wildcard("Eyes", "eyes"))).json()
    changed = await (await wp_client.get("/wp/api/ai/index")).json()
    assert changed["items"] == 2 and counted == [1, 1]
    # Rebuild clears the index, so it loads again.
    rebuilt = await (await wp_client.post("/wp/api/ai/index/rebuild")).json()
    assert rebuilt["items"] == 2 and counted == [1, 1, 1]
    await wp_client.delete(f"/wp/api/modules/{created['id']}")
    after = await (await wp_client.get("/wp/api/ai/index")).json()
    assert after["items"] == 1 and len(counted) == 4


def test_library_stamp_moves_with_every_change(tmp_path):
    conn = get_connection(tmp_path / "lib.db")
    migrate(conn)
    empty = ai_index.library_stamp(conn)
    assert isinstance(empty, str)
    with conn:
        conn.execute(
            "INSERT INTO templates (id, name, template_string, created_at, updated_at) "
            "VALUES ('t1', 'T', 'x', '2026-01-01', '2026-01-01')")
    one = ai_index.library_stamp(conn)
    assert one != empty
    with conn:
        conn.execute("UPDATE templates SET updated_at = '2026-01-02' WHERE id = 't1'")
    assert ai_index.library_stamp(conn) not in (empty, one)
    with conn:
        conn.execute("UPDATE templates SET updated_at = '' WHERE id = 't1'")
    # Stamped by content then: no stand-in.
    assert ai_index.library_stamp(conn) is None
    conn.close()


def test_clear_forgets_the_synced_stamp():
    idx = ai_index.open_index(None)
    if idx is None:
        pytest.skip("SQLite without FTS5")
    idx.synced = "abc"
    idx.clear()
    assert idx.synced is None
    idx.close()
