"""Tests for CategoryRepository."""
import pytest

from engine.db.repositories import CategoryNotFound, CategoryRepository


def test_create_returns_row_with_id(wp_db):
    repo = CategoryRepository(wp_db)
    row = repo.create(name="Style", color="#a970ff", icon="pi pi-palette")
    assert row["id"] == "style"
    assert row["name"] == "Style"
    assert row["color"] == "#a970ff"
    assert row["icon"] == "pi pi-palette"
    assert row["sort_order"] == 0


def test_create_lowercase_collision_raises_value_error(wp_db):
    repo = CategoryRepository(wp_db)
    repo.create(name="Style", color=None, icon=None)
    with pytest.raises(ValueError):
        repo.create(name="STYLE", color=None, icon=None)


def test_get_returns_existing(wp_db):
    repo = CategoryRepository(wp_db)
    repo.create(name="Camera", color=None, icon=None)
    got = repo.get("camera")
    assert got["name"] == "Camera"


def test_get_missing_raises(wp_db):
    repo = CategoryRepository(wp_db)
    with pytest.raises(CategoryNotFound):
        repo.get("ghost")


def test_update_changes_fields(wp_db):
    repo = CategoryRepository(wp_db)
    repo.create(name="A", color=None, icon=None)
    updated = repo.update("a", color="#ff0000", icon="pi pi-tag", sort_order=10)
    assert updated["color"] == "#ff0000"
    assert updated["icon"] == "pi pi-tag"
    assert updated["sort_order"] == 10


def test_update_clears_color_with_explicit_none(wp_db):
    repo = CategoryRepository(wp_db)
    repo.create(name="A", color="#ff0000", icon="pi pi-tag")
    updated = repo.update("a", color=None)
    assert updated["color"] is None
    assert updated["icon"] == "pi pi-tag"  # untouched


def test_update_keeps_unchanged_fields(wp_db):
    repo = CategoryRepository(wp_db)
    repo.create(name="A", color="#ff0000", icon="pi pi-tag", sort_order=5)
    updated = repo.update("a", name="B")  # only name
    assert updated["name"] == "B"
    assert updated["color"] == "#ff0000"
    assert updated["icon"] == "pi pi-tag"
    assert updated["sort_order"] == 5


def test_update_missing_raises(wp_db):
    repo = CategoryRepository(wp_db)
    with pytest.raises(CategoryNotFound):
        repo.update("ghost", name="X")


def test_delete_removes(wp_db):
    repo = CategoryRepository(wp_db)
    repo.create(name="Tmp", color=None, icon=None)
    repo.delete("tmp")
    with pytest.raises(CategoryNotFound):
        repo.get("tmp")


def test_delete_missing_raises(wp_db):
    repo = CategoryRepository(wp_db)
    with pytest.raises(CategoryNotFound):
        repo.delete("ghost")


def test_list_orders_by_sort_order_then_name(wp_db):
    repo = CategoryRepository(wp_db)
    repo.create(name="Bravo", color=None, icon=None, sort_order=10)
    repo.create(name="Alpha", color=None, icon=None, sort_order=10)
    repo.create(name="Charlie", color=None, icon=None, sort_order=0)
    rows = repo.list()
    assert [r["name"] for r in rows] == ["Charlie", "Alpha", "Bravo"]


def test_list_empty(wp_db):
    repo = CategoryRepository(wp_db)
    assert repo.list() == []


def test_delete_nullifies_module_category_id(wp_db):
    """ON DELETE SET NULL is enforced on modules.category_id."""
    from engine.db.repositories import ModuleRepository

    cat_repo = CategoryRepository(wp_db)
    mod_repo = ModuleRepository(wp_db)
    cat = cat_repo.create(name="Style", color=None, icon=None)
    mod = mod_repo.create(
        type="wildcard", name="x", description="",
        category_id=cat["id"], tags=[],
        payload={"options": []},
    )
    cat_repo.delete(cat["id"])
    refreshed = mod_repo.get(mod["id"])
    assert refreshed["category_id"] is None


def test_create_slug_collision_distinct_names(wp_db):
    """Distinct names that collapse to the same slug fail with a clear ValueError."""
    repo = CategoryRepository(wp_db)
    repo.create(name="My Cat", color=None, icon=None)
    with pytest.raises(ValueError, match="slug"):
        repo.create(name="my-cat", color=None, icon=None)


def test_create_blank_name_raises_value_error(wp_db):
    """Names that produce no usable slug are rejected."""
    repo = CategoryRepository(wp_db)
    with pytest.raises(ValueError, match="alphanumeric"):
        repo.create(name="!@#", color=None, icon=None)
