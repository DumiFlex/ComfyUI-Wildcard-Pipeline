import pytest

from engine.db.repositories import TemplateNotFound, TemplateRepository


def test_create_assigns_8hex_id_and_timestamps(wp_db):
    repo = TemplateRepository(wp_db)
    row = repo.create(name="portrait", template_string="$subject $style")
    assert len(row["id"]) == 8
    assert all(c in "0123456789abcdef" for c in row["id"])
    assert row["name"] == "portrait"
    assert row["template_string"] == "$subject $style"
    assert row["tags"] == []
    assert row["is_favorite"] is False
    assert row["created_at"] and row["updated_at"] == row["created_at"]


def test_get_unknown_raises(wp_db):
    with pytest.raises(TemplateNotFound):
        TemplateRepository(wp_db).get("deadbeef")


def test_update_partial_keeps_other_fields(wp_db):
    repo = TemplateRepository(wp_db)
    row = repo.create(name="a", template_string="$x", description="d")
    updated = repo.update(row["id"], template_string="$y")
    assert updated["template_string"] == "$y"
    assert updated["name"] == "a"
    assert updated["description"] == "d"


def test_update_favorite(wp_db):
    repo = TemplateRepository(wp_db)
    row = repo.create(name="a", template_string="$x")
    updated = repo.update(row["id"], is_favorite=True)
    assert updated["is_favorite"] is True


def test_tags_json_roundtrip(wp_db):
    repo = TemplateRepository(wp_db)
    row = repo.create(name="a", template_string="$x", tags=["p", "q"])
    assert repo.get(row["id"])["tags"] == ["p", "q"]


def test_list_filters_by_query_and_favorites(wp_db):
    repo = TemplateRepository(wp_db)
    repo.create(name="alpha", template_string="$x", is_favorite=True)
    repo.create(name="beta", template_string="$y")
    assert {r["name"] for r in repo.list()} == {"alpha", "beta"}
    assert [r["name"] for r in repo.list(query="alph")] == ["alpha"]
    assert [r["name"] for r in repo.list(favorites_only=True)] == ["alpha"]
    assert repo.count() == 2


def test_delete_unknown_raises(wp_db):
    with pytest.raises(TemplateNotFound):
        TemplateRepository(wp_db).delete("deadbeef")
