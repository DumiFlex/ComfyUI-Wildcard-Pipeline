from engine.migrations import CURRENT_SCHEMA_VERSION, migrate_payload


def test_returns_payload_as_is_at_current_version():
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "bundles": [], "wildcards": [], "variables": [], "constraints": [],
    }
    result = migrate_payload(payload)
    assert result["ok"] is True
    assert result["migrated"] == payload
    assert result["migrated_entity_count"] == 0


def test_rejects_future_version():
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION + 1,
        "bundles": [], "wildcards": [], "variables": [], "constraints": [],
    }
    result = migrate_payload(payload)
    assert result["ok"] is False
    assert "future" in result["reason"].lower()


def test_rejects_missing_version():
    result = migrate_payload({"bundles": [], "wildcards": [], "variables": [], "constraints": []})
    assert result["ok"] is False
    assert "schema_version" in result["reason"]


def test_walks_chain_to_current():
    v0_payload = {
        "schema_version": 0,
        "bundles": [],
        "wildcards": [{"uuid": "u", "name": "old"}],
        "variables": [],
        "constraints": [],
    }
    result = migrate_payload(v0_payload)
    assert result["ok"] is True
    assert result["migrated"]["schema_version"] == CURRENT_SCHEMA_VERSION
    assert result["migrated"]["wildcards"][0]["migrated_from"] == 0
    assert result["migrated_entity_count"] == 1


def test_walks_chain_on_empty_payload():
    v0_empty = {
        "schema_version": 0,
        "bundles": [],
        "wildcards": [],
        "variables": [],
        "constraints": [],
    }
    result = migrate_payload(v0_empty)
    assert result["ok"] is True
    assert result["migrated"]["schema_version"] == CURRENT_SCHEMA_VERSION
    assert result["migrated_entity_count"] == 0
