"""Tests for the UUID-based FileStore service layer."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from api.services.file_store import FileStore


class TestFileStoreCreate:
    def test_create_returns_dict_with_id(self, tmp_path):
        store = FileStore(tmp_path)
        result = store.create({"name": "my-wildcard", "options": []})
        assert "id" in result
        assert isinstance(result["id"], str)
        assert len(result["id"]) == 8

    def test_create_file_exists_on_disk(self, tmp_path):
        store = FileStore(tmp_path)
        result = store.create({"name": "item", "options": []})
        path = tmp_path / f"{result['id']}.json"
        assert path.is_file()

    def test_create_file_content_includes_id(self, tmp_path):
        store = FileStore(tmp_path)
        result = store.create({"name": "item", "options": []})
        saved = json.loads(
            (tmp_path / f"{result['id']}.json").read_text(encoding="utf-8")
        )
        assert saved["id"] == result["id"]
        assert saved["name"] == "item"

    def test_create_duplicate_names_allowed(self, tmp_path):
        store = FileStore(tmp_path)
        r1 = store.create({"name": "dupe", "options": []})
        r2 = store.create({"name": "dupe", "options": []})
        assert r1["id"] != r2["id"]

    def test_create_creates_base_directory(self):
        base = Path(tempfile.mkdtemp()) / "nested" / "dir"
        store = FileStore(base)
        result = store.create({"name": "test", "options": []})
        assert (base / f"{result['id']}.json").is_file()

    def test_create_with_category_creates_subdirectory(self, tmp_path):
        store = FileStore(tmp_path)
        result = store.create({"name": "x"}, category="char > anime")
        subdir = tmp_path / "char" / "anime"
        assert (subdir / f"{result['id']}.json").is_file()

    def test_create_with_single_level_category(self, tmp_path):
        store = FileStore(tmp_path)
        result = store.create({"name": "x"}, category="nature")
        subdir = tmp_path / "nature"
        assert (subdir / f"{result['id']}.json").is_file()

    def test_create_with_empty_category_is_root(self, tmp_path):
        store = FileStore(tmp_path)
        result = store.create({"name": "root"}, category="")
        assert (tmp_path / f"{result['id']}.json").is_file()

    def test_create_category_max_2_levels_truncates(self, tmp_path):
        """Category with 3+ levels: only first 2 used (no ValueError, just truncation)."""
        store = FileStore(tmp_path)
        result = store.create({"name": "deep"}, category="a > b > c")
        # Should be stored in a/b/, not a/b/c/
        subdir = tmp_path / "a" / "b"
        assert (subdir / f"{result['id']}.json").is_file()


class TestFileStoreGet:
    def test_get_existing_by_id(self, tmp_path):
        store = FileStore(tmp_path)
        created = store.create({"name": "test", "value": 42})
        result = store.get(created["id"])
        assert result is not None
        assert result["name"] == "test"
        assert result["value"] == 42

    def test_get_nonexistent_returns_none(self, tmp_path):
        store = FileStore(tmp_path)
        assert store.get("deadbeef") is None

    def test_get_item_in_subdirectory(self, tmp_path):
        store = FileStore(tmp_path)
        created = store.create({"name": "sub"}, category="char > anime")
        result = store.get(created["id"])
        assert result is not None
        assert result["name"] == "sub"


class TestFileStoreUpdate:
    def test_update_existing(self, tmp_path):
        store = FileStore(tmp_path)
        created = store.create({"name": "item", "options": [{"value": "old"}]})
        id = created["id"]
        store.update(id, {"name": "item", "options": [{"value": "new"}]})
        result = store.get(id)
        assert result is not None
        assert result["options"][0]["value"] == "new"

    def test_update_preserves_id(self, tmp_path):
        store = FileStore(tmp_path)
        created = store.create({"name": "item"})
        id = created["id"]
        store.update(id, {"name": "renamed"})
        result = store.get(id)
        assert result is not None
        assert result["id"] == id

    def test_update_file_path_unchanged(self, tmp_path):
        store = FileStore(tmp_path)
        created = store.create({"name": "item"})
        id = created["id"]
        path = tmp_path / f"{id}.json"
        assert path.is_file()
        store.update(id, {"name": "different-name"})
        assert path.is_file()

    def test_update_nonexistent_raises(self, tmp_path):
        store = FileStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.update("deadbeef", {"name": "nope"})

    def test_update_item_in_subdirectory(self, tmp_path):
        store = FileStore(tmp_path)
        created = store.create({"name": "deep"}, category="a > b")
        id = created["id"]
        store.update(id, {"name": "updated"})
        result = store.get(id)
        assert result is not None
        assert result["name"] == "updated"


class TestFileStoreDelete:
    def test_delete_existing(self, tmp_path):
        store = FileStore(tmp_path)
        created = store.create({"name": "doomed"})
        id = created["id"]
        store.delete(id)
        assert store.get(id) is None

    def test_delete_removes_file(self, tmp_path):
        store = FileStore(tmp_path)
        created = store.create({"name": "doomed"})
        id = created["id"]
        path = tmp_path / f"{id}.json"
        store.delete(id)
        assert not path.exists()

    def test_delete_nonexistent_raises(self, tmp_path):
        store = FileStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.delete("deadbeef")

    def test_delete_returns_true(self, tmp_path):
        store = FileStore(tmp_path)
        created = store.create({"name": "item"})
        result = store.delete(created["id"])
        assert result is True


class TestFileStoreList:
    def test_list_empty_directory(self, tmp_path):
        store = FileStore(tmp_path / "empty")
        assert store.list_all() == []

    def test_list_returns_all_items(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "a"})
        store.create({"name": "b"})
        items = store.list_all()
        assert len(items) == 2
        names = {item["name"] for item in items}
        assert names == {"a", "b"}

    def test_list_items_have_category_field(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "root"})
        items = store.list_all()
        assert "category" in items[0]

    def test_list_root_items_have_empty_category(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "root"})
        items = store.list_all()
        assert items[0]["category"] == ""

    def test_list_categorized_items_have_correct_category(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "anime-char"}, category="char > anime")
        items = store.list_all()
        assert items[0]["category"] == "char > anime"

    def test_list_skips_invalid_json(self, tmp_path):
        store = FileStore(tmp_path)
        (tmp_path / "bad.json").write_text("not json", encoding="utf-8")
        store.create({"name": "good"})
        items = store.list_all()
        assert len(items) == 1
        assert items[0]["name"] == "good"

    def test_list_skips_non_json_files(self, tmp_path):
        store = FileStore(tmp_path)
        (tmp_path / "readme.txt").write_text("hello", encoding="utf-8")
        store.create({"name": "data"})
        assert len(store.list_all()) == 1

    def test_list_finds_files_in_subdirectories(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "root"})
        store.create({"name": "nested"}, category="examples")
        items = store.list_all()
        assert len(items) == 2
        names = {item["name"] for item in items}
        assert names == {"root", "nested"}


class TestFileStoreCategories:
    def test_list_categories_empty(self, tmp_path):
        store = FileStore(tmp_path)
        assert store.list_categories() == []

    def test_list_categories_root_not_included(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "root"})
        assert store.list_categories() == []

    def test_list_categories_returns_unique_sorted(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "a"}, category="nature")
        store.create({"name": "b"}, category="char > anime")
        store.create({"name": "c"}, category="nature")
        cats = store.list_categories()
        assert "char > anime" in cats
        assert "nature" in cats
        assert len(cats) == 2
        assert cats == sorted(cats)


class TestFileStoreTags:
    def test_list_tags_empty(self, tmp_path):
        store = FileStore(tmp_path)
        assert store.list_tags() == []

    def test_list_tags_returns_unique_sorted(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "a", "tags": ["nature", "dark"]})
        store.create({"name": "b", "tags": ["urban", "dark"]})
        tags = store.list_tags()
        assert tags == sorted(set(["nature", "dark", "urban"]))

    def test_list_tags_skips_non_strings(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "a", "tags": ["valid", 42, None]})
        tags = store.list_tags()
        assert tags == ["valid"]

    def test_list_tags_items_without_tags_ignored(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "no-tags"})
        assert store.list_tags() == []


class TestFileStoreFiltered:
    def test_filter_by_category(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "anime"}, category="char > anime")
        store.create({"name": "nature"}, category="nature")
        store.create({"name": "root"})
        items = store.list_filtered(category="char > anime")
        assert len(items) == 1
        assert items[0]["name"] == "anime"

    def test_filter_by_empty_category_returns_root(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "anime"}, category="char > anime")
        store.create({"name": "root"})
        items = store.list_filtered(category="")
        assert len(items) == 1
        assert items[0]["name"] == "root"

    def test_filter_by_tag(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "a", "tags": ["nature"]})
        store.create({"name": "b", "tags": ["urban"]})
        items = store.list_filtered(tag="nature")
        assert len(items) == 1
        assert items[0]["name"] == "a"

    def test_filter_by_category_and_tag(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "a", "tags": ["dark"]}, category="nature")
        store.create({"name": "b", "tags": ["bright"]}, category="nature")
        store.create({"name": "c", "tags": ["dark"]})
        items = store.list_filtered(category="nature", tag="dark")
        assert len(items) == 1
        assert items[0]["name"] == "a"

    def test_filter_none_category_returns_all(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "a"}, category="cat")
        store.create({"name": "b"})
        items = store.list_filtered(category=None)
        assert len(items) == 2

    def test_filter_no_match_returns_empty(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "x", "tags": ["urban"]})
        items = store.list_filtered(tag="nonexistent")
        assert items == []
