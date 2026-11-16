"""engine/db/queries.py — the graph run's lightweight library reads."""
from __future__ import annotations

import json
import sqlite3

from engine.db import queries
from engine.db.repositories import ModuleRepository


def _make(repo, mid, payload, name="M"):
    repo.create(id=mid, type="wildcard", name=name, description="", category_id=None,
                tags=[], payload=payload)


def _opts(n):
    return {"var_binding": "v", "options": [{"id": f"o{i}", "value": f"v{i}"} for i in range(n)]}


def test_module_row_is_the_raw_row(wp_db):
    repo = ModuleRepository(wp_db)
    _make(repo, "aaaa0001", _opts(2), name="Pool")
    typ, name, text = queries.module_row(wp_db, "aaaa0001")
    assert (typ, name) == ("wildcard", "Pool")
    assert json.loads(text) == repo.get("aaaa0001")["payload"]
    assert queries.module_row(wp_db, "ffffffff") is None


def test_module_rows_many_ids_and_chunks(wp_db, monkeypatch):
    repo = ModuleRepository(wp_db)
    ids = [f"aaaa{i:04x}" for i in range(7)]
    for i, mid in enumerate(ids):
        _make(repo, mid, _opts(i + 1))
    monkeypatch.setattr(queries, "_CHUNK", 3)
    got = queries.module_rows(wp_db, ids + ["ffffffff", ids[0]])
    assert set(got) == set(ids)
    assert got[ids[2]] == queries.module_row(wp_db, ids[2])


def test_option_counts_matches_decoding(wp_db):
    repo = ModuleRepository(wp_db)
    _make(repo, "aaaa0001", _opts(3))
    _make(repo, "aaaa0002", {"var_binding": "v", "options": []})
    _make(repo, "aaaa0003", {"var_binding": "v"})
    _make(repo, "aaaa0004", _opts(1))
    wp_db.execute("UPDATE modules SET payload = ? WHERE id = ?",
                  ('{"options": {"not": "a list"}}', "aaaa0004"))
    _make(repo, "aaaa0005", _opts(1))
    # A payload SQLite's JSON parser rejects but Python accepts, and one
    # nobody can decode.
    wp_db.execute("UPDATE modules SET payload = ? WHERE id = ?",
                  ('{"options": [NaN, 1]}', "aaaa0005"))
    _make(repo, "aaaa0006", _opts(1))
    wp_db.execute("UPDATE modules SET payload = ? WHERE id = ?", ("{oops", "aaaa0006"))
    wp_db.commit()
    got = queries.option_counts(wp_db, [f"aaaa000{i}" for i in range(1, 7)] + ["ffffffff"])
    assert got == {
        "aaaa0001": 3, "aaaa0002": 0, "aaaa0003": None, "aaaa0004": None,
        "aaaa0005": 2, "aaaa0006": None,
    }


def test_option_counts_without_sqlite_json(wp_db):
    repo = ModuleRepository(wp_db)
    _make(repo, "aaaa0001", _opts(4))

    class _NoJson:
        def __init__(self, conn):
            self._conn = conn

        def execute(self, sql, params=()):
            if "json_" in sql:
                raise sqlite3.OperationalError("no such function: json_valid")
            return self._conn.execute(sql, params)

    assert queries.option_counts(_NoJson(wp_db), ["aaaa0001"]) == {"aaaa0001": 4}


def test_decode_payload():
    assert queries.decode_payload('{"a": 1}') == {"a": 1}
    assert queries.decode_payload("[1]") is None
    assert queries.decode_payload("{nope") is None
    assert queries.decode_payload(None) is None
