"""Catalog seeding for `@{uuid}` refs that live OUTSIDE a wildcard payload.

Regression cover for the nested-ref bug: the catalog is synthesised from
wildcard modules only, and `walk_transitive_refs` follows refs found in
wildcard payloads only. A `@{uuid}` on a derivation action — or in the
per-instance `action_value_overrides` the edit modal writes when a user
retargets a branch on the canvas — was never discovered, so its target
reached the catalog ONLY when the user happened to also have that wildcard
picked in the same Context node.

That made the failure look like a resolution bug rather than a discovery one:
removing the wildcard from the node (a reasonable thing to do once a derivation
references it by uuid) silently turned every such ref into `unknown_ref` → empty
string, no matter what the live library held.
"""
from __future__ import annotations

import pytest

from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.repositories import ModuleRepository
from engine.modules.snapshot import ref_seed_uuids
from engine.pipeline import PipelineEngine
from wp_nodes.context_node import _expand_catalog_via_live_db
from wp_nodes.types import deserialize_node_input

POOL = "05c54db9"
RULE = "614d1517"
#: uuid + cached `#name` + `:subcategory` filter — the exact shape the SPA
#: writes when a user filters a nested ref.
REF = f"@{{{POOL}#pose_pool_presenting:test}}"


@pytest.fixture
def library(tmp_path, monkeypatch):
    """Live library holding ONE wildcard, whose single `test`-tagged option is
    the only thing the filtered ref can pick."""
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "wp.db"))
    conn = get_connection()
    migrate(conn)
    ModuleRepository(conn).create(
        id=POOL,
        type="wildcard",
        name="Pose pool — presenting",
        description="",
        category_id=None,
        tags=[],
        payload={
            "var_binding": "pose_pool_presenting",
            "sub_categories": ["test"],
            "options": [
                {"id": "a1", "value": "kneeling", "weight": 1.0, "sub_categories": []},
                {"id": "a2", "value": "test", "weight": 1.0, "sub_categories": ["test"]},
            ],
        },
    )
    conn.close()
    yield


def _tier_wildcard() -> dict:
    """Always rolls `presenting`, so the derivation branch below fires."""
    return {
        "id": "11112222",
        "type": "wildcard",
        "enabled": True,
        "meta": {"name": "Tier"},
        "payload": {
            "var_binding": "tier",
            "sub_categories": [],
            "options": [{"id": "t1", "value": "presenting", "weight": 1.0}],
        },
        "payload_hash": "",
        "instance": {},
    }


def _derivation(*, in_instance: bool) -> dict:
    """Rewrites `$pose` from the ref. `in_instance=True` puts the ref in the
    per-instance action override (canvas retarget) and leaves the library
    payload bound to a plain `$var`, which is what the user's setup looked
    like; `False` puts it straight in the payload."""
    payload_value = "$pose_placeholder" if in_instance else REF
    instance = {"action_value_overrides": {RULE: {"0": REF}}} if in_instance else {}
    return {
        "id": "33334444",
        "type": "derivation",
        "enabled": True,
        "meta": {"name": "Pose select (tier)"},
        "payload": {
            "rules": [
                {
                    "id": RULE,
                    "branches": [
                        {
                            "condition": {"var": "tier", "op": "equals", "value": "presenting"},
                            "action": {
                                "target_var": "pose",
                                "mode": "replace",
                                "value": payload_value,
                            },
                        },
                    ],
                },
            ],
        },
        "payload_hash": "",
        "instance": instance,
    }


def _run(widget_modules: list[dict]) -> dict:
    modules, catalog, _ = deserialize_node_input(
        {"modules": widget_modules, "bundles": []},
    )
    expanded = _expand_catalog_via_live_db(catalog, modules)
    ctx = PipelineEngine().run(modules, ctx={"__wp_catalog__": expanded}, seed=99)
    return {
        "catalog": sorted(expanded),
        "pose": ctx.get("pose"),
        "warnings": [w.get("type") for w in ctx.get("__wp_warnings__", [])],
    }


# ---------- seed extraction (pure) ----------


def test_seeds_include_refs_from_a_derivation_payload():
    assert POOL in ref_seed_uuids([_derivation(in_instance=False)])


def test_seeds_include_refs_from_an_instance_override():
    """The canvas retarget lives in `instance`, which is not part of the
    library payload the walker would otherwise see."""
    assert POOL in ref_seed_uuids([_derivation(in_instance=True)])


def test_seeds_ignore_modules_without_refs():
    assert ref_seed_uuids([_tier_wildcard()]) == set()


def test_seeds_tolerate_malformed_rows():
    assert ref_seed_uuids([None, "nonsense", {}, {"payload": None}]) == set()  # type: ignore[list-item]


# ---------- end-to-end through the node's catalog builder ----------


@pytest.mark.usefixtures("library")
def test_ref_resolves_when_target_is_also_picked():
    """Baseline — this always worked, because the pick put the target in the
    catalog. It is the case that masked the bug."""
    pool_row = {
        "id": POOL, "type": "wildcard", "enabled": True,
        "meta": {"name": "Pose pool"},
        "payload": {
            "var_binding": "pose_pool_presenting",
            "sub_categories": ["test"],
            "options": [
                {"id": "a1", "value": "kneeling", "weight": 1.0, "sub_categories": []},
                {"id": "a2", "value": "test", "weight": 1.0, "sub_categories": ["test"]},
            ],
        },
        "payload_hash": "", "instance": {},
    }
    result = _run([_tier_wildcard(), _derivation(in_instance=True), pool_row])
    assert result["pose"] == "test", result


@pytest.mark.usefixtures("library")
def test_ref_resolves_when_target_removed_from_context():
    """The regression: with the wildcard removed from the node, the ref must
    still find its pool in the live library."""
    result = _run([_tier_wildcard(), _derivation(in_instance=True)])
    assert POOL in result["catalog"], result
    assert result["warnings"] == [], result
    assert result["pose"] == "test", result


@pytest.mark.usefixtures("library")
def test_ref_in_derivation_payload_also_seeds():
    """Same, for a ref saved into the library payload rather than overridden
    per-instance."""
    result = _run([_tier_wildcard(), _derivation(in_instance=False)])
    assert result["pose"] == "test", result


@pytest.mark.usefixtures("library")
def test_unknown_target_still_warns_rather_than_crashing():
    """A ref to a uuid in neither the node nor the library keeps the existing
    lenient behaviour — warn, resolve to empty, never raise."""
    deriv = _derivation(in_instance=True)
    deriv["instance"] = {"action_value_overrides": {RULE: {"0": "@{deadbeef:test}"}}}
    result = _run([_tier_wildcard(), deriv])
    assert result["pose"] == ""
    assert "unknown_ref" in result["warnings"], result
