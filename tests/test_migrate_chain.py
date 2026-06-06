"""Envelope migration chain walks v1 -> CURRENT (2)."""
from engine.migrations import CURRENT_SCHEMA_VERSION, migrate_payload


def test_current_schema_version_is_2():
    assert CURRENT_SCHEMA_VERSION == 2


def test_chain_v1_to_current():
    out = migrate_payload({"schema_version": 1, "wildcards": [
        {"id": "w", "payload": {"sub_categories": ["warm"], "options": [
            {"id": "o", "value": "x", "weight": 1, "sub_category": "warm"}]}}]})
    assert out["ok"] is True
    assert out["migrated"]["schema_version"] == 2
    opt = out["migrated"]["wildcards"][0]["payload"]["options"][0]
    assert opt["sub_categories"] == ["warm"]


def test_chain_v0_to_current_walks_both_steps():
    out = migrate_payload({"schema_version": 0, "wildcards": [
        {"id": "w", "payload": {"sub_categories": ["warm"], "options": [
            {"id": "o", "value": "x", "weight": 1, "sub_category": "warm"}]}}]})
    assert out["ok"] is True
    assert out["migrated"]["schema_version"] == 2
    # v0->v1 tags migrated_from; v1->v2 converts the option tag.
    w = out["migrated"]["wildcards"][0]
    assert w["migrated_from"] == 0
    assert w["payload"]["options"][0]["sub_categories"] == ["warm"]
