"""v1 -> v2 migrator: option tags, name slugify+cascade, instance filter,
nested-ref null marker. Envelope + per-row (lazy/DB) entry points."""
from engine.migrations.v1_to_v2 import migrate_module_v1_to_v2, migrate_v1_to_v2


def _env(payload, **extra):
    return {"schema_version": 1, "wildcards": [{"id": "w", "payload": payload, **extra}]}


def test_option_subcategory_to_list():
    out = migrate_v1_to_v2(_env({"sub_categories": ["warm"], "options": [
        {"id": "o", "value": "x", "weight": 1, "sub_category": "warm"}]}))
    opt = out["wildcards"][0]["payload"]["options"][0]
    assert opt["sub_categories"] == ["warm"] and "sub_category" not in opt
    assert out["schema_version"] == 2


def test_null_option_becomes_empty_list():
    out = migrate_v1_to_v2(_env({"sub_categories": [], "options": [
        {"id": "n", "value": "", "weight": 1, "is_null": True, "sub_category": None}]}))
    assert out["wildcards"][0]["payload"]["options"][0]["sub_categories"] == []


def test_slugify_name_with_space_cascades_to_options():
    out = migrate_v1_to_v2(_env({"sub_categories": ["warm tones"], "options": [
        {"id": "o", "value": "x", "weight": 1, "sub_category": "warm tones"}]}))
    p = out["wildcards"][0]["payload"]
    assert p["sub_categories"] == ["warm_tones"]
    assert p["options"][0]["sub_categories"] == ["warm_tones"]


def test_reserved_name_suffixed():
    out = migrate_v1_to_v2(_env({"sub_categories": ["or"], "options": []}))
    assert out["wildcards"][0]["payload"]["sub_categories"] == ["or_1"]


def test_dedupe_after_slug_collision():
    out = migrate_v1_to_v2(_env(
        {"sub_categories": ["warm tones", "warm_tones"], "options": []}))
    assert out["wildcards"][0]["payload"]["sub_categories"] == ["warm_tones", "warm_tones_2"]


def test_tag_groups_remapped():
    out = migrate_v1_to_v2(_env({
        "sub_categories": ["warm tones"], "options": [],
        "tag_groups": {"temp": ["warm tones"]}}))
    assert out["wildcards"][0]["payload"]["tag_groups"] == {"temp": ["warm_tones"]}


def test_idempotent_on_v2_shape():
    v2 = migrate_v1_to_v2(_env({"sub_categories": ["warm"], "options": [
        {"id": "o", "value": "x", "weight": 1, "sub_category": "warm"}]}))
    again = migrate_v1_to_v2({**v2, "schema_version": 1})
    p = again["wildcards"][0]["payload"]
    assert p["sub_categories"] == ["warm"]
    assert p["options"][0]["sub_categories"] == ["warm"]


def test_instance_category_filter_list_to_expr():
    out = migrate_v1_to_v2(_env(
        {"sub_categories": ["warm", "cold"], "options": []},
        instance={"category_filter": ["warm", "cold", "null"]}))
    inst = out["wildcards"][0]["instance"]
    assert inst["category_filter"] == "warm or cold"
    assert inst["exclude_null"] is True


def test_nested_ref_null_to_bang_null():
    out = migrate_v1_to_v2(_env({"sub_categories": ["warm", "cold"], "options": [
        {"id": "o", "value": "a @{aabbccdd:warm,cold,null} b", "weight": 1,
         "sub_category": None}]}))
    val = out["wildcards"][0]["payload"]["options"][0]["value"]
    assert "@{aabbccdd:warm or cold!null}" in val


def test_nested_ref_v2_left_untouched():
    # Already-v2 refs must survive a re-run unchanged (idempotency).
    out = migrate_v1_to_v2(_env({"sub_categories": ["warm", "cold"], "options": [
        {"id": "o", "value": "@{aabbccdd:warm or cold!null} @{eeff0011:blue}",
         "weight": 1, "sub_categories": []}]}))
    val = out["wildcards"][0]["payload"]["options"][0]["value"]
    assert val == "@{aabbccdd:warm or cold!null} @{eeff0011:blue}"


def test_per_row_module_migrator_wildcard():
    # The lazy/DB path gets the inner wildcard payload column (no `type`).
    p = migrate_module_v1_to_v2({"sub_categories": ["warm"], "options": [
        {"id": "o", "value": "x", "weight": 1, "sub_category": "warm"}]})
    assert p["options"][0]["sub_categories"] == ["warm"]


def test_per_row_non_wildcard_only_rewrites_refs():
    p = migrate_module_v1_to_v2({"template": "x @{aabbccdd:warm,null} y"})
    assert p["template"] == "x @{aabbccdd:warm!null} y"
