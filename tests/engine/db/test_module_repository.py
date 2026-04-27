"""Tests for ModuleRepository CRUD + filtering."""
import pytest

from engine.db.repositories import ModuleNotFound, ModuleRepository


def _new_payload() -> dict:
    return {"options": [{"id": "opt_1", "value": "red", "weight": 1}]}


def test_create_assigns_id_and_timestamps(wp_db):
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type="wildcard", name="colors", description="",
        category_id=None, tags=["a", "b"], payload=_new_payload(),
    )
    assert row["id"].startswith("wc_colors_")
    assert row["version"] == 1
    assert row["created_at"]
    assert row["updated_at"] == row["created_at"]
    assert row["tags"] == ["a", "b"]
    assert row["payload"] == _new_payload()


def test_get_returns_existing_row(wp_db):
    repo = ModuleRepository(wp_db)
    created = repo.create(
        type="fixed_values", name="lens", description="",
        category_id=None, tags=[], payload={"values": []},
    )
    got = repo.get(created["id"])
    assert got["id"] == created["id"]
    assert got["type"] == "fixed_values"


def test_get_raises_module_not_found(wp_db):
    repo = ModuleRepository(wp_db)
    with pytest.raises(ModuleNotFound):
        repo.get("does_not_exist")


def test_update_bumps_version_and_updated_at(wp_db):
    repo = ModuleRepository(wp_db)
    created = repo.create(
        type="wildcard", name="colors", description="",
        category_id=None, tags=[], payload=_new_payload(),
    )
    updated = repo.update(created["id"], name="palette", payload=_new_payload())
    assert updated["name"] == "palette"
    assert updated["version"] == 2
    assert updated["updated_at"] > created["updated_at"]


def test_delete_removes_row(wp_db):
    repo = ModuleRepository(wp_db)
    created = repo.create(
        type="wildcard", name="x", description="",
        category_id=None, tags=[], payload=_new_payload(),
    )
    repo.delete(created["id"])
    with pytest.raises(ModuleNotFound):
        repo.get(created["id"])


def test_delete_missing_raises(wp_db):
    repo = ModuleRepository(wp_db)
    with pytest.raises(ModuleNotFound):
        repo.delete("ghost")


def test_list_filters_by_type(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="a", description="",
                category_id=None, tags=[], payload=_new_payload())
    repo.create(type="fixed_values", name="b", description="",
                category_id=None, tags=[], payload={"values": []})
    wcs = repo.list(type="wildcard")
    assert len(wcs) == 1
    assert wcs[0]["type"] == "wildcard"


def test_list_filters_by_category(wp_db):
    wp_db.execute(
        "INSERT INTO module_categories(id, name) VALUES('style', 'Style');"
    )
    wp_db.commit()
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="a", description="",
                category_id="style", tags=[], payload=_new_payload())
    repo.create(type="wildcard", name="b", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(category_id="style")
    assert len(rows) == 1
    assert rows[0]["name"] == "a"


def test_list_search_matches_name_case_insensitive(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="ColorPalette", description="",
                category_id=None, tags=[], payload=_new_payload())
    repo.create(type="wildcard", name="lighting", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(query="color")
    assert len(rows) == 1
    assert rows[0]["name"] == "ColorPalette"


def test_list_orders_by_updated_at_desc(wp_db):
    repo = ModuleRepository(wp_db)
    a = repo.create(type="wildcard", name="a", description="",
                    category_id=None, tags=[], payload=_new_payload())
    b = repo.create(type="wildcard", name="b", description="",
                    category_id=None, tags=[], payload=_new_payload())
    rows = repo.list()
    assert [r["id"] for r in rows] == [b["id"], a["id"]]


def test_list_favorites_only(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="a", description="",
                category_id=None, tags=[], payload=_new_payload(), is_favorite=True)
    repo.create(type="wildcard", name="b", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(favorites_only=True)
    assert len(rows) == 1
    assert rows[0]["name"] == "a"


def test_list_limit_offset(wp_db):
    repo = ModuleRepository(wp_db)
    for n in ["a", "b", "c"]:
        repo.create(type="wildcard", name=n, description="",
                    category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(limit=1, offset=1)
    assert len(rows) == 1
    assert rows[0]["name"] == "b"


def test_update_keeps_unchanged_fields(wp_db):
    repo = ModuleRepository(wp_db)
    created = repo.create(
        type="wildcard", name="x", description="hello",
        category_id=None, tags=["t1"], payload=_new_payload(),
    )
    updated = repo.update(created["id"], name="y")  # only name changes
    assert updated["description"] == "hello"
    assert updated["tags"] == ["t1"]
    assert updated["payload"] == _new_payload()


def test_create_id_uses_fv_prefix_for_fixed_values(wp_db):
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type="fixed_values", name="lens", description="",
        category_id=None, tags=[], payload={"values": []},
    )
    assert row["id"].startswith("fv_lens_")


def test_list_search_treats_percent_literally(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="50%_off", description="",
                category_id=None, tags=[], payload=_new_payload())
    repo.create(type="wildcard", name="other", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(query="50%")
    assert len(rows) == 1
    assert rows[0]["name"] == "50%_off"


def test_list_search_treats_underscore_literally(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="my_module", description="",
                category_id=None, tags=[], payload=_new_payload())
    repo.create(type="wildcard", name="myXmodule", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(query="my_")
    assert len(rows) == 1
    assert rows[0]["name"] == "my_module"


def test_list_offset_without_limit(wp_db):
    repo = ModuleRepository(wp_db)
    for n in ["a", "b", "c"]:
        repo.create(type="wildcard", name=n, description="",
                    category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(offset=1)
    # offset=1 skips the first (most-recent) row → expect 2 rows back
    assert len(rows) == 2


@pytest.mark.parametrize(
    "type_,prefix",
    [
        ("combine", "cb_"),
        ("derivation", "dr_"),
        ("constraint", "ct_"),
        ("pipeline", "pl_"),
    ],
)
def test_create_accepts_new_module_types(wp_db, type_, prefix):
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type=type_, name="thing", description="",
        category_id=None, tags=[], payload={},
    )
    assert row["type"] == type_
    assert row["id"].startswith(prefix)


def test_create_rejects_unknown_type(wp_db):
    repo = ModuleRepository(wp_db)
    with pytest.raises(ValueError, match="unknown module type"):
        repo.create(
            type="bogus", name="x", description="",
            category_id=None, tags=[], payload={},
        )
