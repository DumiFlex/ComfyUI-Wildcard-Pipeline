"""engine/ai/organize.py — category, tags and rating for a batch."""
from __future__ import annotations

import pytest

from engine.ai import organize


def _items():
    hair = organize.item_view(
        {"name": "Hair", "type": "wildcard", "description": "hair colours", "tags": ["Portrait"],
         "payload": {"options": [{"value": "red hair"}]}, "content_rating": "safe"},
        "module", "1", category="Characters", names={},
    )
    pose = organize.item_view(
        {"name": "Poses", "type": "wildcard", "tags": [], "payload": {"options": []}},
        "module", "2", category="", names={},
    )
    bundle = organize.item_view(
        {"name": "Kit", "children": [{"type": "wildcard", "name": "Hair"}], "tags": ["kit"],
         "content_rating": "nsfw"},
        "bundle", "3", category="", names={},
    )
    return [hair, pose, bundle]


def test_prompt_lists_items_categories_and_tags():
    text = organize.build_prompt(items=_items(), categories=["Characters", "Scenes"],
                                 library=["portrait", "pose"], hint="split by subject")
    assert "Library categories: Characters, Scenes" in text
    assert '1. wildcard "Hair"' in text and "Category: Characters" in text
    assert '3. bundle "Kit"' in text and "Rating: nsfw" in text
    assert "- wildcard Hair" in text  # the bundle's children
    assert "Request: split by subject" in text


def test_compile_maps_reuses_and_drops_no_ops():
    out = organize.compile_answer({"items": [
        {"id": "1", "category": "characters", "tags_add": ["portrait", "Anime"],
         "tags_remove": [], "rating": "keep", "reason": "already fine"},
        {"id": "2", "category": "Poses And Actions", "tags_add": ["#Pose", "pose"],
         "tags_remove": ["nope"], "rating": "nsfw", "reason": "explicit poses"},
        {"id": "3", "category": "Bundles", "tags_add": [], "tags_remove": ["KIT"],
         "rating": "nsfw", "reason": ""},
        {"id": "9", "category": "", "tags_add": [], "tags_remove": [], "rating": "keep",
         "reason": ""},
    ]}, items=_items(), categories=["Characters", "Scenes"], library=["pose"])
    [hair, pose, kit] = out["changes"]
    # Same category in another case is not a change; "portrait" is already on it.
    assert hair["category"] is None
    assert hair["tags_add"] == [{"tag": "anime", "new": True}]
    assert pose["category"] == {"name": "Poses And Actions", "new": True}
    assert pose["tags_add"] == [{"tag": "pose", "new": False}]
    assert pose["tags_remove"] == [] and pose["rating"] == "nsfw"
    # Bundles have no category; removal uses the item's own spelling.
    assert kit["category"] is None and kit["tags_remove"] == ["kit"] and kit["rating"] is None
    assert out["new_categories"] == ["Poses And Actions"]
    assert out["skipped"] == [{"text": "9", "reason": "no such item"}]


def test_unchanged_items_are_left_out():
    out = organize.compile_answer({"items": [
        {"id": "2", "category": "", "tags_add": [], "tags_remove": [], "rating": "safe",
         "reason": ""},
    ]}, items=_items(), categories=[], library=[])
    assert out["changes"] == []


@pytest.mark.parametrize("raw", [None, {}, {"items": "x"}, {"items": [{"id": "7"}]}])
def test_bad_answers_raise(raw):
    with pytest.raises(ValueError):
        organize.compile_answer(raw, items=_items(), categories=[], library=[])


def test_answers_naming_items_by_name_or_place_still_land():
    """The 9B and the 35B both wrote names where the number goes."""
    entry = {"category": "Scenes", "tags_add": [], "tags_remove": [], "rating": "keep",
             "reason": ""}
    out = organize.compile_answer({"items": [
        {**entry, "id": "Hair"}, {**entry, "id": "item 2"}, {**entry, "id": "3."},
    ]}, items=_items(), categories=["Scenes"], library=[])
    assert [c["id"] for c in out["changes"]] == ["1", "2"]  # bundles take no category
    # One answer per item in order: the n-th answer is the n-th item.
    out = organize.compile_answer({"items": [
        {**entry, "id": "the first"}, {**entry, "id": "?"}, {**entry, "id": "?"},
    ]}, items=_items(), categories=["Scenes"], library=[])
    assert [c["id"] for c in out["changes"]] == ["1", "2"]


def test_empty_ids_with_nothing_changed_are_an_unusable_answer():
    entry = {"category": "", "tags_add": [], "tags_remove": [], "rating": "keep", "reason": ""}
    with pytest.raises(ValueError, match="named none"):
        organize.compile_answer({"items": [{**entry, "id": ""}] * 3}, items=_items(),
                                categories=[], library=[])
