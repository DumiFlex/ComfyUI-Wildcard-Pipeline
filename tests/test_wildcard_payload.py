"""SP1 wildcard payload validation — option sub_categories[] + tag_groups."""
import pytest

from engine.modules.wildcard_handler import WildcardHandler


def _ok(payload):
    WildcardHandler.validate_payload(payload)  # raises ValueError on bad


def test_sub_categories_list():
    _ok({
        "options": [
            {"id": "o1", "value": "x", "weight": 1, "sub_categories": ["warm", "red"]},
        ],
        "sub_categories": ["warm", "red"],
    })


def test_option_with_no_tags_is_allowed():
    # Untagged non-null option (sub_categories []) is valid (bypasses filter).
    _ok({
        "options": [{"id": "o1", "value": "x", "weight": 1, "sub_categories": []}],
        "sub_categories": ["warm"],
    })
    # Missing sub_categories defaults to [].
    _ok({
        "options": [{"id": "o1", "value": "x", "weight": 1}],
        "sub_categories": ["warm"],
    })


def test_sub_category_must_be_in_registry():
    with pytest.raises(ValueError, match="not in"):
        _ok({
            "options": [
                {"id": "o1", "value": "x", "weight": 1, "sub_categories": ["banana"]},
            ],
            "sub_categories": ["warm"],
        })


def test_reserved_subcat_name_rejected():
    with pytest.raises(ValueError, match="reserved"):
        _ok({"options": [], "sub_categories": ["or"]})


def test_boolean_grammar_char_in_name_rejected():
    with pytest.raises(ValueError, match="character"):
        _ok({"options": [], "sub_categories": ["a(b"]})


def test_tag_groups_members_must_be_registry():
    with pytest.raises(ValueError, match="tag_groups"):
        _ok({
            "options": [],
            "sub_categories": ["warm"],
            "tag_groups": {"temp": ["warm", "ghost"]},
        })


def test_tag_groups_member_in_at_most_one_group():
    with pytest.raises(ValueError, match="more than one group"):
        _ok({
            "options": [],
            "sub_categories": ["warm"],
            "tag_groups": {"a": ["warm"], "b": ["warm"]},
        })


def test_tag_groups_valid():
    _ok({
        "options": [],
        "sub_categories": ["warm", "cold"],
        "tag_groups": {"temperature": ["warm", "cold"]},
    })


def test_null_option_empty_tags():
    _ok({
        "options": [
            {"id": "n", "value": "", "weight": 1, "is_null": True, "sub_categories": []},
        ],
        "sub_categories": [],
    })


def test_null_option_with_tags_rejected():
    with pytest.raises(ValueError, match="no sub_categories"):
        _ok({
            "options": [
                {
                    "id": "n", "value": "", "weight": 1, "is_null": True,
                    "sub_categories": ["warm"],
                },
            ],
            "sub_categories": ["warm"],
        })
