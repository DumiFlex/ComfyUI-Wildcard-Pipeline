"""Walker + SnapshotEntry tests. Mirrors spec §2.4–2.10 + §6 (5.5.0).

The walker is the single shared lazy-walk implementation used by:
- wp_api/test_runner.py:run_test (request-scoped roots)
- wp_api/modules.py:embed_bundle (user pick roots)
NEVER called from wp_nodes/context_node.py — graph runs use pre-walked
snapshots embedded in workflow JSON."""
from __future__ import annotations

import importlib
import sys


def test_snapshot_entry_canonical_shape():
    """SnapshotEntry has the 7 fields locked in spec §2.4. Other code
    grep-asserts these names; never rename without updating callers."""
    from engine.modules.snapshot import SnapshotEntry
    # SnapshotEntry is a TypedDict — read its annotations
    annotations = SnapshotEntry.__annotations__
    assert set(annotations.keys()) == {
        "snapshot_version", "uuid", "type", "name",
        "payload", "payload_hash", "source",
    }


def test_engine_modules_snapshot_does_not_import_db_or_wp_api():
    """Engine isolation: snapshot.py must be importable with no DB layer
    in sys.modules. CLAUDE.md isolation rule — engine/ never knows about
    wp_api/ or wp_nodes/. Any future contributor adding `from engine.db
    import ...` here breaks the runtime separation."""
    # Force fresh import to capture import-time side effects
    if "engine.modules.snapshot" in sys.modules:
        del sys.modules["engine.modules.snapshot"]
    importlib.import_module("engine.modules.snapshot")
    mod = sys.modules["engine.modules.snapshot"]
    forbidden_prefixes = ("engine.db", "wp_api", "wp_nodes", "comfy_api")
    for name in dir(mod):
        attr = getattr(mod, name)
        attr_module = getattr(attr, "__module__", "")
        for prefix in forbidden_prefixes:
            assert not attr_module.startswith(prefix), (
                f"engine.modules.snapshot leaks {prefix} via attribute "
                f"{name!r} (came from {attr_module})"
            )


# ---------------------------------------------------------------------------
# Walker tests (Task 5)
# ---------------------------------------------------------------------------

def _make_module(uuid: str, *, type: str = "wildcard", name: str | None = None,
                 payload: dict | None = None) -> dict:
    """Test helper — builds a row matching what repo.get_by_uuid returns."""
    p = payload or {"options": [{"value": "x", "weight": 1}]}
    return {
        "id": f"wc_{name or uuid}_{uuid}",
        "uuid": uuid,
        "type": type,
        "name": name or uuid,
        "payload": p,
        "payload_hash": "deadbeef" * 8,  # actual hash not tested here
    }


def test_walk_single_module_no_refs_returns_one_entry():
    from engine.modules.snapshot import walk_transitive_refs
    catalog = {"a1111111": _make_module("a1111111")}
    result = walk_transitive_refs(
        ["a1111111"], fetch_module=catalog.get,
    )
    assert set(result.snapshots.keys()) == {"a1111111"}
    assert result.snapshots["a1111111"]["source"] == {"kind": "user"}
    assert result.walk_overflow == []


def test_walk_follows_at_uuid_refs_marks_deps():
    from engine.modules.snapshot import walk_transitive_refs
    # outfit references @{color_uuid}
    catalog = {
        "aa111111": _make_module("aa111111", name="outfit", payload={
            "options": [{"value": "@{bb222222} dress", "weight": 1}],
        }),
        "bb222222": _make_module("bb222222", name="color", payload={
            "options": [{"value": "red", "weight": 1}],
        }),
    }
    result = walk_transitive_refs(["aa111111"], fetch_module=catalog.get)
    assert set(result.snapshots.keys()) == {"aa111111", "bb222222"}
    assert result.snapshots["aa111111"]["source"] == {"kind": "user"}
    assert result.snapshots["bb222222"]["source"] == {
        "kind": "dep", "parent_uuids": ["aa111111"],
    }


def test_walk_records_missing_target_overflow():
    from engine.modules.snapshot import walk_transitive_refs
    catalog = {
        "a1111111": _make_module("a1111111", payload={
            "options": [{"value": "@{deadc0de}", "weight": 1}],
        }),
    }
    result = walk_transitive_refs(["a1111111"], fetch_module=catalog.get)
    # Walker returns the picked module but records the missing dep
    assert "a1111111" in result.snapshots
    assert "deadc0de" not in result.snapshots
    assert {"uuid": "deadc0de", "reason": "missing_target"} in result.walk_overflow


def test_walk_records_max_depth_overflow():
    """Spec §2.10 + §6 — walker honors max_ref_depth=8 cap."""
    from engine.modules.snapshot import walk_transitive_refs
    # Build a 10-deep linear chain: a → b → c → ... → j
    chain_uuids = [f"a{i:07x}" for i in range(10)]
    catalog = {}
    for i, u in enumerate(chain_uuids):
        next_ref = f"@{{{chain_uuids[i+1]}}}" if i + 1 < len(chain_uuids) else "leaf"
        catalog[u] = _make_module(u, payload={
            "options": [{"value": next_ref, "weight": 1}],
        })
    result = walk_transitive_refs(
        [chain_uuids[0]], fetch_module=catalog.get, max_depth=8,
    )
    # First 9 (depth 0..8 inclusive) are walked, 10th is overflow
    assert len(result.snapshots) == 9
    assert any(o["reason"] == "max_depth" for o in result.walk_overflow)


def test_walk_handles_cycle_records_overflow():
    """A → B → A. Walker terminates, records cycle, includes both."""
    from engine.modules.snapshot import walk_transitive_refs
    catalog = {
        "a1111111": _make_module("a1111111", payload={
            "options": [{"value": "@{b2222222}", "weight": 1}],
        }),
        "b2222222": _make_module("b2222222", payload={
            "options": [{"value": "@{a1111111}", "weight": 1}],
        }),
    }
    result = walk_transitive_refs(["a1111111"], fetch_module=catalog.get)
    assert set(result.snapshots.keys()) == {"a1111111", "b2222222"}
    assert any(o["reason"] == "cycle_detected" for o in result.walk_overflow)


def test_walk_multi_parent_dep_lists_both_parents():
    """A and C both ref B. B's source.parent_uuids contains both."""
    from engine.modules.snapshot import walk_transitive_refs
    catalog = {
        "a1111111": _make_module("a1111111", payload={
            "options": [{"value": "@{b2222222}", "weight": 1}],
        }),
        "c3333333": _make_module("c3333333", payload={
            "options": [{"value": "@{b2222222}", "weight": 1}],
        }),
        "b2222222": _make_module("b2222222"),
    }
    result = walk_transitive_refs(
        ["a1111111", "c3333333"], fetch_module=catalog.get,
    )
    assert result.snapshots["b2222222"]["source"]["kind"] == "dep"
    assert sorted(
        result.snapshots["b2222222"]["source"]["parent_uuids"]
    ) == ["a1111111", "c3333333"]


def test_walk_skips_non_wildcard_picks_at_root():
    """Spec §2.7 — catalog only ever contains wildcards. If a non-wildcard
    is in the roots list (e.g. user picked a Combine), walker emits it but
    does NOT walk its payload for refs (combines aren't @{}-targets)."""
    from engine.modules.snapshot import walk_transitive_refs
    catalog = {
        "dd111111": _make_module("dd111111", type="combine", payload={
            "template": "$alpha and @{cc333333}",  # ref ignored
        }),
        "cc333333": _make_module("cc333333"),
    }
    result = walk_transitive_refs(["dd111111"], fetch_module=catalog.get)
    # Combine present at root level (the picker still wants to embed it),
    # but its @{} refs are NOT followed because non-wildcards do not
    # participate in the catalog.
    assert "dd111111" in result.snapshots
    assert "cc333333" not in result.snapshots
