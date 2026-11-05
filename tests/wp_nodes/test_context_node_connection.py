"""WP_Context closes its library connection and migrates once per process.

Regression: `_expand_catalog_via_live_db` opened a SQLite connection on every
graph run and never closed it (50 runs left 50 connections open), and ran
`migrate()` each time on ComfyUI's execution thread. The preview route had
the same leak.
"""
from __future__ import annotations

import pytest

import wp_nodes.context_node as context_node
from engine.db import connection as db_connection
from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.repositories import ModuleRepository

POOL = "05c54db9"
REF = f"@{{{POOL}}}"


class _Tracked:
    """Proxy over a sqlite3 connection that records close()."""

    def __init__(self, conn, opened: list):
        self._conn = conn
        self.closed = False
        opened.append(self)

    def close(self):
        self.closed = True
        self._conn.close()

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def __enter__(self):
        return self._conn.__enter__()

    def __exit__(self, *exc):
        return self._conn.__exit__(*exc)


@pytest.fixture
def tracked(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "wp.db"))
    conn = get_connection()
    migrate(conn)
    ModuleRepository(conn).create(
        id=POOL, type="wildcard", name="Pool", description="", category_id=None,
        tags=[],
        payload={"var_binding": "pool", "options": [{"id": "a", "value": "x", "weight": 1.0}]},
    )
    conn.close()
    opened: list[_Tracked] = []
    real = db_connection.get_connection

    def _get_connection(*a, **k):
        return _Tracked(real(*a, **k), opened)

    monkeypatch.setattr(context_node, "get_connection", _get_connection)
    monkeypatch.setattr(context_node, "_MIGRATED", set())
    return opened


def _modules():
    return [{
        "id": "11112222", "type": "fixed_values", "enabled": True,
        "payload": {"values": [{"id": "v0", "name": "pose", "value": REF}]},
    }]


def test_every_run_closes_its_connection(tracked):
    for _ in range(20):
        expanded = context_node._expand_catalog_via_live_db({}, _modules())
        assert POOL in expanded
    assert len(tracked) == 20
    assert all(c.closed for c in tracked)


def test_migrate_runs_once_per_db(tracked, monkeypatch):
    calls = []
    monkeypatch.setattr(context_node, "migrate", lambda conn: calls.append(1))
    for _ in range(5):
        context_node._expand_catalog_via_live_db({}, _modules())
    assert calls == [1]
