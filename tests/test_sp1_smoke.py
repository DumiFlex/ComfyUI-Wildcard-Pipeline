"""SP1 end-to-end smoke: a v1 library payload migrates to v2, the migrated
payload validates, and the boolean pool filter resolves over the new
multi-tag option shape — the whole pipeline in one test."""
from engine.migrations import migrate_payload
from engine.modules.wildcard_handler import WildcardHandler


def test_v1_payload_migrates_validates_resolves():
    v1 = {
        "schema_version": 1,
        "wildcards": [{
            "id": "w",
            "instance": {"category_filter": ["warm", "null"]},
            "payload": {
                "sub_categories": ["warm tones", "cold"],
                "options": [{
                    "id": "o",
                    "value": "a @{aabbccdd:warm tones,null} b",
                    "weight": 1,
                    "sub_category": "warm tones",
                }],
            },
        }],
    }
    out = migrate_payload(v1)
    assert out["ok"], out
    assert out["migrated"]["schema_version"] == 2

    p = out["migrated"]["wildcards"][0]["payload"]
    WildcardHandler.validate_payload(p)  # must not raise post-migration

    # Registry + option tags slugified (whitespace -> "_"), cascaded.
    assert p["sub_categories"] == ["warm_tones", "cold"]
    assert p["options"][0]["sub_categories"] == ["warm_tones"]
    assert "sub_category" not in p["options"][0]
    # Nested ref: comma list -> `or`, slugified, `null` -> trailing `!null`.
    assert "@{aabbccdd:warm_tones!null}" in p["options"][0]["value"]
    # Instance filter: list -> boolean expr + separate exclude_null flag.
    inst = out["migrated"]["wildcards"][0]["instance"]
    assert inst["exclude_null"] is True


def test_migrated_v2_pool_filter_resolves_over_multitag():
    """The migrated v2 option shape drives the boolean pool matcher."""
    opts = [
        {"id": "a", "value": "crimson", "weight": 1, "sub_categories": ["warm_tones", "red"]},
        {"id": "b", "value": "navy", "weight": 1, "sub_categories": ["cold"]},
    ]
    kept = WildcardHandler._apply_pool_filter(opts, "warm_tones or cold", exclude_null=False)
    assert {o["id"] for o in kept} == {"a", "b"}
    kept2 = WildcardHandler._apply_pool_filter(opts, "warm_tones and not red", exclude_null=False)
    assert [o["id"] for o in kept2] == []
