"""Tests for the FileStore service layer."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.file_store import FileStore, _slugify


class TestSlugify:
    def test_basic(self):
        assert _slugify("Hello World") == "hello-world"

    def test_special_characters(self):
        assert _slugify("foo@bar#baz") == "foo-bar-baz"

    def test_leading_trailing_whitespace(self):
        assert _slugify("  spaced  ") == "spaced"

    def test_multiple_hyphens_collapsed(self):
        assert _slugify("a---b") == "a-b"

    def test_empty_string(self):
        assert _slugify("") == "unnamed"

    def test_only_special_chars(self):
        assert _slugify("@#$") == "unnamed"

    def test_already_slugified(self):
        assert _slugify("already-slug") == "already-slug"


class TestFileStoreList:
    def test_list_empty_directory(self, tmp_path):
        store = FileStore(tmp_path / "empty")
        assert store.list_all() == []

    def test_list_returns_all_json_files(self, tmp_path):
        (tmp_path / "a.json").write_text('{"name": "a"}', encoding="utf-8")
        (tmp_path / "b.json").write_text('{"name": "b"}', encoding="utf-8")
        store = FileStore(tmp_path)
        items = store.list_all()
        assert len(items) == 2
        names = {item["name"] for item in items}
        assert names == {"a", "b"}

    def test_list_skips_invalid_json(self, tmp_path):
        (tmp_path / "good.json").write_text('{"name": "good"}', encoding="utf-8")
        (tmp_path / "bad.json").write_text("not json", encoding="utf-8")
        store = FileStore(tmp_path)
        items = store.list_all()
        assert len(items) == 1
        assert items[0]["name"] == "good"

    def test_list_skips_non_json_files(self, tmp_path):
        (tmp_path / "readme.txt").write_text("hello", encoding="utf-8")
        (tmp_path / "data.json").write_text('{"name": "data"}', encoding="utf-8")
        store = FileStore(tmp_path)
        assert len(store.list_all()) == 1


class TestFileStoreGet:
    def test_get_existing(self, tmp_path):
        (tmp_path / "test.json").write_text(
            '{"name": "test", "value": 42}', encoding="utf-8"
        )
        store = FileStore(tmp_path)
        result = store.get("test")
        assert result == {"name": "test", "value": 42}

    def test_get_nonexistent(self, tmp_path):
        store = FileStore(tmp_path)
        assert store.get("nope") is None

    def test_get_slugifies_name(self, tmp_path):
        (tmp_path / "hello-world.json").write_text(
            '{"name": "Hello World"}', encoding="utf-8"
        )
        store = FileStore(tmp_path)
        assert store.get("Hello World") is not None


class TestFileStoreCreate:
    def test_create_new(self, tmp_path):
        store = FileStore(tmp_path)
        data = {"name": "my-wildcard", "options": []}
        store.create(data)
        path = tmp_path / "my-wildcard.json"
        assert path.is_file()
        saved = json.loads(path.read_text(encoding="utf-8"))
        assert saved == data

    def test_create_duplicate_raises(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "dupe", "options": []})
        with pytest.raises(FileExistsError):
            store.create({"name": "dupe", "options": []})

    def test_create_slugifies_name(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "My Wildcard", "options": []})
        assert (tmp_path / "my-wildcard.json").is_file()

    def test_create_creates_directory(self):
        """FileStore creates the base directory if it doesn't exist."""
        import tempfile

        base = Path(tempfile.mkdtemp()) / "nested" / "dir"
        store = FileStore(base)
        store.create({"name": "test", "options": []})
        assert (base / "test.json").is_file()


class TestFileStoreUpdate:
    def test_update_existing(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "item", "options": [{"value": "old"}]})
        store.update("item", {"name": "item", "options": [{"value": "new"}]})
        result = store.get("item")
        assert result is not None
        assert result["options"][0]["value"] == "new"

    def test_update_nonexistent_raises(self, tmp_path):
        store = FileStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.update("nope", {"name": "nope", "options": []})

    def test_update_with_rename(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "old-name", "options": []})
        store.update("old-name", {"name": "new-name", "options": []})
        assert store.get("old-name") is None
        assert store.get("new-name") is not None

    def test_update_rename_conflict_raises(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "first", "options": []})
        store.create({"name": "second", "options": []})
        with pytest.raises(FileExistsError):
            store.update("first", {"name": "second", "options": []})


class TestFileStoreDelete:
    def test_delete_existing(self, tmp_path):
        store = FileStore(tmp_path)
        store.create({"name": "doomed", "options": []})
        store.delete("doomed")
        assert store.get("doomed") is None

    def test_delete_nonexistent_raises(self, tmp_path):
        store = FileStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.delete("nope")
