from engine.migrations import CURRENT_SCHEMA_VERSION, migrate_payload

EMPTY_7 = {
    "bundles": [], "wildcards": [], "fixed_values": [],
    "combines": [], "derivations": [], "constraints": [], "categories": [],
}


def test_returns_payload_as_is_at_current_version():
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, **EMPTY_7}
    result = migrate_payload(payload)
    assert result["ok"] is True
    assert result["migrated"] == payload
    assert result["migrated_entity_count"] == 0


def test_rejects_future_version():
    payload = {"schema_version": CURRENT_SCHEMA_VERSION + 1, **EMPTY_7}
    result = migrate_payload(payload)
    assert result["ok"] is False
    assert "future" in result["reason"].lower()


def test_rejects_missing_version():
    result = migrate_payload({**EMPTY_7})
    assert result["ok"] is False
    assert "schema_version" in result["reason"]


def test_walks_chain_to_current():
    v0_payload = {
        "schema_version": 0,
        **EMPTY_7,
        "wildcards": [{"uuid": "u", "name": "old"}],
    }
    result = migrate_payload(v0_payload)
    assert result["ok"] is True
    assert result["migrated"]["schema_version"] == CURRENT_SCHEMA_VERSION
    assert result["migrated"]["wildcards"][0]["migrated_from"] == 0
    # 2 chain steps (v0->v1, v1->v2) each pass the 1 wildcard => count 2.
    assert result["migrated_entity_count"] == 2


def test_walks_chain_on_empty_payload():
    v0_empty = {"schema_version": 0, **EMPTY_7}
    result = migrate_payload(v0_empty)
    assert result["ok"] is True
    assert result["migrated"]["schema_version"] == CURRENT_SCHEMA_VERSION
    assert result["migrated_entity_count"] == 0


def test_tags_fixed_values_combines_derivations_categories():
    v0_payload = {
        "schema_version": 0,
        "bundles": [],
        "wildcards": [],
        "fixed_values": [{"uuid": "fv1", "name": "fv"}],
        "combines": [{"uuid": "cb1", "name": "cb"}],
        "derivations": [{"uuid": "dr1", "name": "dr"}],
        "constraints": [],
        "categories": [{"uuid": "cat1", "name": "cat"}],
    }
    result = migrate_payload(v0_payload)
    assert result["ok"] is True
    assert result["migrated"]["fixed_values"][0]["migrated_from"] == 0
    assert result["migrated"]["combines"][0]["migrated_from"] == 0
    assert result["migrated"]["derivations"][0]["migrated_from"] == 0
    assert result["migrated"]["categories"][0]["migrated_from"] == 0


def test_sums_all_7_arrays_for_migrated_entity_count():
    v0_payload = {
        "schema_version": 0,
        "bundles": [{"uuid": "b1"}],
        "wildcards": [{"uuid": "w1"}],
        "fixed_values": [{"uuid": "fv1"}],
        "combines": [{"uuid": "cb1"}],
        "derivations": [{"uuid": "dr1"}],
        "constraints": [{"uuid": "c1"}],
        "categories": [{"uuid": "cat1"}],
    }
    result = migrate_payload(v0_payload)
    assert result["ok"] is True
    # 7 entities x 2 chain steps (v0->v1, v1->v2) = 14.
    assert result["migrated_entity_count"] == 14


def test_defaults_missing_arrays_to_empty():
    # A partial payload (missing new buckets) should still succeed —
    # migrate_payload fills them in via .get("key", []).
    partial = {"schema_version": CURRENT_SCHEMA_VERSION, "wildcards": [{"uuid": "w1"}]}
    result = migrate_payload(partial)
    assert result["ok"] is True
    assert result["migrated"]["fixed_values"] == []
    assert result["migrated"]["combines"] == []
    assert result["migrated"]["derivations"] == []
    assert result["migrated"]["categories"] == []
