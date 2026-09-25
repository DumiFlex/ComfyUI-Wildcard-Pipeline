"""Export payload builder tests."""
from engine.exporter import build_export_payload
from engine.migrations import (
    CURRENT_SCHEMA_VERSION,
    SP2B_SCHEMA_VERSION,
    SP3_REACH_SCHEMA_VERSION,
    TAG_AXES_SCHEMA_VERSION,
)


def test_stamps_schema_version_and_exported_at(wp_db):
    payload = build_export_payload(
        wp_db,
        bundle_uuids=[], wildcard_uuids=[], fixed_values_uuids=[],
        combine_uuids=[], derivation_uuids=[], constraint_uuids=[],
        category_uuids=[], template_uuids=[],
    )
    assert payload["schema_version"] == CURRENT_SCHEMA_VERSION
    assert "exported_at" in payload
    assert isinstance(payload["exported_at"], str)


def test_empty_export_returns_empty_arrays(wp_db):
    payload = build_export_payload(
        wp_db,
        bundle_uuids=[], wildcard_uuids=[], fixed_values_uuids=[],
        combine_uuids=[], derivation_uuids=[], constraint_uuids=[],
        category_uuids=[], template_uuids=[],
    )
    for key in (
        "bundles", "wildcards", "fixed_values",
        "combines", "derivations", "constraints", "categories",
        "templates",
    ):
        assert payload[key] == [], f"{key} should be empty array"


def test_wildcard_included_with_fingerprint(wp_db):
    from engine.db.repositories import ModuleRepository
    repo = ModuleRepository(wp_db)
    m = repo.create(
        type="wildcard", name="color", description="", category_id=None,
        tags=[], payload={"options": [{"id": "r", "value": "red", "weight": 1}]},
    )
    payload = build_export_payload(
        wp_db,
        bundle_uuids=[], wildcard_uuids=[m["id"]], fixed_values_uuids=[],
        combine_uuids=[], derivation_uuids=[], constraint_uuids=[],
        category_uuids=[], template_uuids=[],
    )
    assert len(payload["wildcards"]) == 1
    w = payload["wildcards"][0]
    assert w["name"] == "color"
    assert w["snapshot_fingerprint"]  # non-empty string (stamped by Task 3)


def test_module_uuid_only_appears_in_correct_type_bucket(wp_db):
    """Cross-bucket isolation: a wildcard's UUID passed to combine_uuids
    should NOT cause it to land in combines[]."""
    from engine.db.repositories import ModuleRepository
    repo = ModuleRepository(wp_db)
    w = repo.create(
        type="wildcard", name="x", description="", category_id=None,
        tags=[], payload={"options": []},
    )
    # Pass the wildcard's UUID under combine_uuids by mistake.
    payload = build_export_payload(
        wp_db,
        bundle_uuids=[], wildcard_uuids=[],
        fixed_values_uuids=[], combine_uuids=[w["id"]],
        derivation_uuids=[], constraint_uuids=[], category_uuids=[],
        template_uuids=[],
    )
    # Exporter must filter — a wildcard requested under combines should not be
    # silently coerced into the combines[] array.
    assert len(payload["combines"]) == 0
    assert len(payload["wildcards"]) == 0


def test_fixed_values_combine_derivation_constraint_each_routed_to_correct_bucket(wp_db):
    from engine.db.repositories import ModuleRepository
    repo = ModuleRepository(wp_db)
    fv = repo.create(
        type="fixed_values", name="fv", description="", category_id=None,
        tags=[], payload={"values": [{"name": "v", "value": "x"}]},
    )
    co = repo.create(
        type="combine", name="co", description="", category_id=None,
        tags=[], payload={"template": "$a", "output_var": "out"},
    )
    de = repo.create(
        type="derivation", name="de", description="", category_id=None,
        tags=[], payload={"rules": [{"id": "r1", "branches": [{"key": "default", "actions": []}]}]},
    )
    cn = repo.create(
        type="constraint", name="cn", description="", category_id=None,
        tags=[], payload={
            "source_wildcard_id": "s", "target_wildcard_id": "t",
            "matrix": {}, "exceptions": [],
        },
    )
    payload = build_export_payload(
        wp_db,
        bundle_uuids=[], wildcard_uuids=[],
        fixed_values_uuids=[fv["id"]],
        combine_uuids=[co["id"]],
        derivation_uuids=[de["id"]],
        constraint_uuids=[cn["id"]],
        category_uuids=[], template_uuids=[],
    )
    assert len(payload["fixed_values"]) == 1 and payload["fixed_values"][0]["name"] == "fv"
    assert len(payload["combines"]) == 1 and payload["combines"][0]["name"] == "co"
    assert len(payload["derivations"]) == 1 and payload["derivations"][0]["name"] == "de"
    assert len(payload["constraints"]) == 1 and payload["constraints"][0]["name"] == "cn"


def test_inner_bundle_auto_include(wp_db):
    from engine.db.repositories import BundleRepository
    repo = BundleRepository(wp_db)
    # BundleRepository.create uses kwargs: name, description="", color=None,
    # category_id=None, tags=None, children=None, is_favorite=False, id=None.
    # Inner-bundle child entries store {id, type, name, color} references
    # (not full snapshots); type=="bundle" triggers the transitive walk.
    inner = repo.create(name="inner", children=[])
    outer = repo.create(
        name="outer",
        children=[{"id": inner["id"], "type": "bundle", "name": "inner", "color": None}],
    )
    payload = build_export_payload(
        wp_db,
        bundle_uuids=[outer["id"]],
        wildcard_uuids=[], fixed_values_uuids=[], combine_uuids=[],
        derivation_uuids=[], constraint_uuids=[], category_uuids=[],
        template_uuids=[],
    )
    uuids = {b["id"] for b in payload["bundles"]}
    assert outer["id"] in uuids
    assert inner["id"] in uuids  # auto-resolved via transitive walk


def test_category_included(wp_db):
    from engine.db.repositories import CategoryRepository
    repo = CategoryRepository(wp_db)
    # CategoryRepository.create: name, color, icon, sort_order=0 (all keyword).
    # Returns row with id = slug of name ("style"), name, color, icon, sort_order.
    cat = repo.create(name="Style", color="#ff0000", icon="palette")
    payload = build_export_payload(
        wp_db,
        bundle_uuids=[], wildcard_uuids=[], fixed_values_uuids=[],
        combine_uuids=[], derivation_uuids=[], constraint_uuids=[],
        category_uuids=[cat["id"]], template_uuids=[],
    )
    assert len(payload["categories"]) == 1
    assert payload["categories"][0]["name"] == "Style"


def test_template_included(wp_db):
    from engine.db.repositories import TemplateRepository
    repo = TemplateRepository(wp_db)
    # TemplateRepository.create: name, template_string, description,
    # category_id, tags, is_favorite (all keyword). Returns the row.
    tpl = repo.create(name="Hero shot", template_string="$subject, $style")
    payload = build_export_payload(
        wp_db,
        bundle_uuids=[], wildcard_uuids=[], fixed_values_uuids=[],
        combine_uuids=[], derivation_uuids=[], constraint_uuids=[],
        category_uuids=[], template_uuids=[tpl["id"]],
    )
    assert len(payload["templates"]) == 1
    t = payload["templates"][0]
    assert t["id"] == tpl["id"]
    assert t["name"] == "Hero shot"
    assert t["template_string"] == "$subject, $style"


def test_bogus_template_uuid_silently_dropped(wp_db):
    """A template_uuid that doesn't exist is filtered out, not raised —
    mirrors the missing-bundle / missing-category behaviour."""
    payload = build_export_payload(
        wp_db,
        bundle_uuids=[], wildcard_uuids=[], fixed_values_uuids=[],
        combine_uuids=[], derivation_uuids=[], constraint_uuids=[],
        category_uuids=[], template_uuids=["does-not-exist"],
    )
    assert payload["templates"] == []


def _export(conn, **uuids):
    kwargs = {k: [] for k in (
        "bundle_uuids", "wildcard_uuids", "fixed_values_uuids", "combine_uuids",
        "derivation_uuids", "constraint_uuids", "category_uuids", "template_uuids",
    )}
    kwargs.update(uuids)
    return build_export_payload(conn, **kwargs)


def _wildcard(conn, value="red", **extra):
    from engine.db.repositories import ModuleRepository
    return ModuleRepository(conn).create(
        type="wildcard", name="w", description="", category_id=None, tags=[],
        payload={"options": [{"id": "a", "value": value, "weight": 1}], **extra},
    )


def test_plain_content_stamps_current(wp_db):
    w = _wildcard(wp_db, "{2$$, $$a|b}")
    assert _export(wp_db, wildcard_uuids=[w["id"]])["schema_version"] == CURRENT_SCHEMA_VERSION


def test_range_multi_pick_stamps_sp2b(wp_db):
    w = _wildcard(wp_db, "{1-3$$, $$a|b|c}")
    assert _export(wp_db, wildcard_uuids=[w["id"]])["schema_version"] == SP2B_SCHEMA_VERSION


def test_accepts_tag_axis_stamps_tag_axes(wp_db):
    w = _wildcard(wp_db, tag_group_kinds={"SHOES": "accepts"})
    assert _export(wp_db, wildcard_uuids=[w["id"]])["schema_version"] == TAG_AXES_SCHEMA_VERSION


def test_non_default_constraint_reach_stamps_sp3(wp_db):
    from engine.db.repositories import ModuleRepository
    src = _wildcard(wp_db)
    tgt = _wildcard(wp_db, "blue")
    c = ModuleRepository(wp_db).create(
        type="constraint", name="c", description="", category_id=None, tags=[],
        payload={
            "source_wildcard_id": src["id"], "target_wildcard_id": tgt["id"],
            "rules": [], "target_select": {"mode": "next", "count": 2},
        },
    )
    assert _export(wp_db, constraint_uuids=[c["id"]])["schema_version"] == SP3_REACH_SCHEMA_VERSION


def test_feature_in_unselected_row_does_not_bump(wp_db):
    plain = _wildcard(wp_db)
    _wildcard(wp_db, tag_group_kinds={"SHOES": "accepts"})
    assert _export(wp_db, wildcard_uuids=[plain["id"]])["schema_version"] == CURRENT_SCHEMA_VERSION


def test_feature_in_auto_included_inner_bundle_bumps(wp_db):
    from engine.db.repositories import BundleRepository
    w = _wildcard(wp_db, "{2~$$ $$a|b}")
    bundles = BundleRepository(wp_db)
    inner = bundles.create(name="inner", children=[
        {"id": w["id"], "type": "wildcard", "name": w["name"], "payload": w["payload"]},
    ])
    outer = bundles.create(name="outer", children=[
        {"id": inner["id"], "type": "bundle", "name": "inner", "color": None},
    ])
    payload = _export(wp_db, bundle_uuids=[outer["id"]])
    assert {b["id"] for b in payload["bundles"]} == {inner["id"], outer["id"]}
    assert payload["schema_version"] == SP2B_SCHEMA_VERSION
