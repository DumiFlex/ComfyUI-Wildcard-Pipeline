"""WP_Context caches its live-library catalog expansion per widget value.

Every frame of a Context Loop (and every repeat queue) used to redo the walk
over the library. The cache must never serve a stale catalog: any library
edit that changes what the walk read, or a node entry's live option count,
re-walks. And a run must never be able to change what the next one reads.
"""
from __future__ import annotations

import json

import pytest

import wp_nodes.context_node as context_node
from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.repositories import ModuleRepository
from wp_nodes.types import deserialize_node_input

POOL = "05c54db9"
DEEP = "0d0d0d0d"
MISSING = "0e0e0e0e"
NODE = "aa11bb22"


def _pool_payload(values, extra_ref=None):
    opts = [{"id": f"p{i}", "value": v, "weight": 1.0, "sub_categories": []}
            for i, v in enumerate(values)]
    if extra_ref:
        opts.append({"id": "pref", "value": f"via @{{{extra_ref}}}", "weight": 1.0,
                     "sub_categories": []})
    return {"var_binding": "pool", "sub_categories": [], "options": opts}


@pytest.fixture
def lib(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "wp.db"))
    monkeypatch.setattr(context_node, "_CATALOG_CACHE", type(context_node._CATALOG_CACHE)())
    conn = get_connection()
    migrate(conn)
    repo = ModuleRepository(conn)
    repo.create(id=POOL, type="wildcard", name="Pool", description="", category_id=None,
                tags=[], payload=_pool_payload(["kneeling", "standing"]))
    repo.create(id=NODE, type="wildcard", name="Carrier", description="", category_id=None,
                tags=[], payload={"var_binding": "pose", "sub_categories": [], "options": [
                    {"id": "o1", "value": f"@{{{POOL}}}", "weight": 1.0}]})
    yield conn, repo
    conn.close()


def _widget(node_options=1, extra=None):
    options = [{"id": "o1", "value": f"@{{{POOL}}}", "weight": 1.0}]
    options += [{"id": f"x{i}", "value": f"x{i}", "weight": 1.0} for i in range(node_options - 1)]
    if extra:
        options.append({"id": "o9", "value": f"@{{{extra}}}", "weight": 1.0})
    return json.dumps({"modules": [{
        "id": NODE, "type": "wildcard", "enabled": True, "meta": {"name": "Carrier"},
        "payload": {"var_binding": "pose", "sub_categories": [], "options": options},
        "instance": {},
    }]})


def _expand(widget):
    modules, catalog, _ = deserialize_node_input(widget)
    return context_node._expand_catalog_via_live_db(
        catalog, modules, widget_key=context_node._widget_key(widget),
    )


def _uncached(widget):
    modules, catalog, _ = deserialize_node_input(widget)
    return context_node._expand_catalog_via_live_db(catalog, modules)


def _values(cat, uuid):
    return [o["value"] for o in cat[uuid]["payload"]["options"]]


def test_hit_equals_a_fresh_walk(lib):
    w = _widget()
    first = _expand(w)
    assert len(context_node._CATALOG_CACHE) == 1
    again = _expand(w)
    assert again == first == _uncached(w)
    assert list(again) == list(first)


def test_hit_hands_out_fresh_objects(lib):
    w = _widget()
    first = _expand(w)
    first[POOL]["payload"]["options"].clear()
    first[POOL]["pool_origin"] = "mutated"
    first[NODE]["source"]["kind"] = "mutated"
    again = _expand(w)
    assert _values(again, POOL) == ["kneeling", "standing"]
    assert again[POOL]["pool_origin"] == "library"
    assert again[NODE]["source"] == {"kind": "user"}
    assert again[POOL] is not first[POOL]


def test_editing_a_walked_row_rewalks(lib):
    _conn, repo = lib
    w = _widget()
    _expand(w)
    repo.update(POOL, payload=_pool_payload(["sitting"]))
    assert _values(_expand(w), POOL) == ["sitting"]


def test_rename_of_a_walked_row_rewalks(lib):
    _conn, repo = lib
    w = _widget()
    _expand(w)
    repo.update(POOL, name="Renamed pool")
    assert _expand(w)[POOL]["name"] == "Renamed pool"


def test_deleting_a_walked_row_rewalks(lib):
    _conn, repo = lib
    w = _widget()
    assert POOL in _expand(w)
    repo.delete(POOL)
    assert POOL not in _expand(w)


def test_a_new_ref_inside_a_walked_row_is_followed(lib):
    _conn, repo = lib
    w = _widget()
    _expand(w)
    repo.create(id=DEEP, type="wildcard", name="Deep", description="", category_id=None,
                tags=[], payload=_pool_payload(["deep"]))
    repo.update(POOL, payload=_pool_payload(["kneeling"], extra_ref=DEEP))
    got = _expand(w)
    assert DEEP in got and _values(got, DEEP) == ["deep"]


def test_creating_a_missing_target_rewalks(lib):
    _conn, repo = lib
    w = _widget(extra=MISSING)
    assert MISSING not in _expand(w)
    repo.create(id=MISSING, type="wildcard", name="Late", description="", category_id=None,
                tags=[], payload=_pool_payload(["late"]))
    assert _values(_expand(w), MISSING) == ["late"]


def test_node_entry_drift_follows_the_live_option_count(lib):
    _conn, repo = lib
    w = _widget(node_options=1)
    assert "library_option_count" not in _expand(w)[NODE]
    repo.update(NODE, payload={"var_binding": "pose", "sub_categories": [], "options": [
        {"id": "o1", "value": "a", "weight": 1.0}, {"id": "o2", "value": "b", "weight": 1.0}]})
    assert _expand(w)[NODE]["library_option_count"] == 2


def test_node_entry_not_in_the_library_still_hits(lib, monkeypatch):
    _conn, repo = lib
    repo.delete(NODE)
    w = _widget()
    first = _expand(w)
    calls = []
    real = context_node._walk_live
    monkeypatch.setattr(context_node, "_walk_live", lambda *a, **k: calls.append(1) or real(*a, **k))
    assert _expand(w) == first
    assert calls == []


def test_unrelated_library_edit_keeps_the_hit(lib, monkeypatch):
    _conn, repo = lib
    w = _widget()
    first = _expand(w)
    repo.create(id="0f0f0f0f", type="wildcard", name="Other", description="", category_id=None,
                tags=[], payload=_pool_payload(["other"]))
    calls = []
    real = context_node._walk_live
    monkeypatch.setattr(context_node, "_walk_live", lambda *a, **k: calls.append(1) or real(*a, **k))
    assert _expand(w) == first
    assert calls == []


def test_another_widget_value_misses(lib):
    _expand(_widget(node_options=1))
    got = _expand(_widget(node_options=3))
    assert len(got[NODE]["payload"]["options"]) == 3
    assert len(context_node._CATALOG_CACHE) == 2


def test_cache_is_bounded(lib):
    for n in range(context_node._CATALOG_CACHE_MAX + 4):
        _expand(_widget(node_options=n + 1))
    assert len(context_node._CATALOG_CACHE) == context_node._CATALOG_CACHE_MAX


def test_another_db_path_misses(lib, tmp_path, monkeypatch):
    w = _widget()
    assert POOL in _expand(w)
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "other.db"))
    context_node._MIGRATED.discard(str(tmp_path / "other.db"))
    assert POOL not in _expand(w)


def test_widget_key_handles_dicts_and_junk():
    assert context_node._widget_key({"modules": []}) == context_node._widget_key({"modules": []})
    assert context_node._widget_key({"modules": []}) != context_node._widget_key({"modules": [1]})
    assert context_node._widget_key({"x": object()}) is None
