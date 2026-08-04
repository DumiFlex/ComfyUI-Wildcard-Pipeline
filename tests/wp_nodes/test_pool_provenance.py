"""The empty-pool warning must say WHICH pool it searched, and flag drift.

"Matched no options" alone cannot tell a wrong filter from a right filter
aimed at a stale copy — the ambiguity that made the nested-ref bug unreadable
from the Debug panel.
"""
from __future__ import annotations

import pytest

from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.repositories import ModuleRepository
from engine.pipeline import PipelineEngine
from wp_nodes.context_node import _expand_catalog_via_live_db
from wp_nodes.types import deserialize_node_input

POOL = "05c54db9"


def _library_payload(with_test_option: bool) -> dict:
    options = [{"id": "a1", "value": "kneeling", "weight": 1.0, "sub_categories": []}]
    if with_test_option:
        options.append(
            {"id": "a2", "value": "test", "weight": 1.0, "sub_categories": ["test"]},
        )
    return {
        "var_binding": "pose_pool",
        "sub_categories": ["test"],
        "options": options,
    }


@pytest.fixture
def library(tmp_path, monkeypatch):
    """Library row HAS the `test`-tagged option."""
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "wp.db"))
    conn = get_connection()
    migrate(conn)
    ModuleRepository(conn).create(
        id=POOL, type="wildcard", name="Pose pool", description="",
        category_id=None, tags=[], payload=_library_payload(True),
    )
    conn.close()
    yield


def _carrier() -> dict:
    return {
        "id": "aa11bb22", "type": "wildcard", "enabled": True,
        "meta": {"name": "Carrier"},
        "payload": {
            "var_binding": "pose", "sub_categories": [],
            "options": [{"id": "o1", "value": f"@{{{POOL}:test}}", "weight": 1.0}],
        },
        "payload_hash": "", "instance": {},
    }


def _stale_pool_row() -> dict:
    """What the node holds: the pool BEFORE the `test` option was added."""
    return {
        "id": POOL, "type": "wildcard", "enabled": True,
        "meta": {"name": "Pose pool"}, "payload": _library_payload(False),
        "payload_hash": "", "instance": {},
    }


def _run(widget_modules: list[dict]) -> dict:
    modules, catalog, _ = deserialize_node_input(
        {"modules": widget_modules, "bundles": []},
    )
    expanded = _expand_catalog_via_live_db(catalog, modules)
    ctx = PipelineEngine().run(modules, ctx={"__wp_catalog__": expanded}, seed=99)
    empty = [
        w for w in ctx.get("__wp_warnings__", [])
        if w.get("type") == "ref_subcategory_empty_pool"
    ]
    return {"catalog": expanded, "pose": ctx.get("pose"), "empty": empty}


@pytest.mark.usefixtures("library")
def test_node_pool_is_stamped_node_and_flags_the_drift():
    result = _run([_carrier(), _stale_pool_row()])
    entry = result["catalog"][POOL]
    assert entry["pool_origin"] == "node"
    # Node holds 1 option, library holds 2 → drift recorded.
    assert entry["library_option_count"] == 2


@pytest.mark.usefixtures("library")
def test_empty_pool_warning_names_the_pool_it_searched_and_the_drift():
    result = _run([_carrier(), _stale_pool_row()])
    assert result["pose"] == ""
    assert len(result["empty"]) == 1, result["empty"]
    warn = result["empty"][0]
    assert "this node's copy" in warn["message"], warn["message"]
    assert "the library now has 2" in warn["message"], warn["message"]
    detail = warn["detail"]
    assert detail["pool_origin"] == "node"
    assert detail["pool_total"] == 1
    assert detail["library_option_count"] == 2
    # The tags the searched pool ACTUALLY offers — `test` is absent, which is
    # the whole explanation.
    assert detail["available_sub_categories"] == []


@pytest.mark.usefixtures("library")
def test_library_pool_is_stamped_library_and_carries_no_drift_field():
    """Target not in the node → library answers, and there is no second pool
    to disagree with."""
    result = _run([_carrier()])
    entry = result["catalog"][POOL]
    assert entry["pool_origin"] == "library"
    assert "library_option_count" not in entry
    # The library HAS the tagged option, so nothing is empty.
    assert result["pose"] == "test"
    assert result["empty"] == []


@pytest.mark.usefixtures("library")
def test_no_drift_field_when_node_copy_matches_the_library():
    fresh = {
        "id": POOL, "type": "wildcard", "enabled": True,
        "meta": {"name": "Pose pool"}, "payload": _library_payload(True),
        "payload_hash": "", "instance": {},
    }
    entry = _run([_carrier(), fresh])["catalog"][POOL]
    assert entry["pool_origin"] == "node"
    assert "library_option_count" not in entry
