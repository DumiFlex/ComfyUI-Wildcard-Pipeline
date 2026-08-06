"""Booru tag index: format tolerance, prefix search, alias handling.

The index reads one CSV the user supplies. Two shapes exist in the wild and
both must work, because a user will point this at whichever file they already
have:

    name,post_count                       ComfyUI-Custom-Scripts
    name,category,post_count,"aliases"    Danbooru API export

Benchmarked against real files (2026-08-06): 286,337 entries load in ~785 ms
and a query answers in 5-950 us. Load cost is why the API builds this on the
first request rather than at plugin import.
"""
from __future__ import annotations

import pytest

from wp_api._tag_index import CATEGORY_NAMES, load_index


def _write(tmp_path, text, name="tags.csv"):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


class TestFormatTolerance:
    def test_reads_the_two_column_shape(self, tmp_path):
        idx = load_index(_write(tmp_path, "1girl,4114588\nsolo,3426446\n"))
        assert len(idx) == 2
        assert idx.has_categories is False
        assert idx.search("1g")[0].name == "1girl"

    def test_reads_the_four_column_shape_with_categories(self, tmp_path):
        idx = load_index(_write(
            tmp_path, '1girl,0,6008644,"1girls"\nhighres,5,5256195,"hires"\n',
        ))
        assert idx.has_categories is True
        assert idx.search("1girl")[0].category == 0
        assert CATEGORY_NAMES[5] == "meta"

    def test_a_large_second_column_is_a_count_not_a_category(self, tmp_path):
        """The shapes are told apart by magnitude, with no header to rely on.

        Categories are a small enum; post counts are not. A two-column file
        with a trailing field must not be read as `name,category,count`.
        """
        idx = load_index(_write(tmp_path, "1girl,4114588,extra\n"))
        assert idx.search("1girl")[0].count == 4114588
        assert idx.search("1girl")[0].category is None

    def test_blank_lines_comments_and_junk_rows_are_skipped(self, tmp_path):
        idx = load_index(_write(
            tmp_path, "# a comment\n\n1girl,100\nbroken\nalso,notanumber\nsolo,50\n",
        ))
        assert len(idx) == 2


class TestSearch:
    @pytest.fixture
    def idx(self, tmp_path):
        return load_index(_write(tmp_path, (
            '1girl,0,6008644,"1girls"\n'
            'highres,5,5256195,"hires,high_resolution"\n'
            "blue_hair,0,855605\n"
            "blue_hat,0,32945\n"
            "zzz_rare,0,3\n"
        )))

    def test_prefix_matches_ranked_by_post_count(self, idx):
        assert [t.name for t in idx.search("blue_")] == ["blue_hair", "blue_hat"]

    def test_is_prefix_only_not_substring(self, idx):
        """Substring matching over 200k tags buries the wanted tag in noise,
        and every booru autocomplete users already know is prefix-based."""
        assert idx.search("hair") == []

    def test_spaces_are_normalised_to_underscores(self, idx):
        assert idx.search("blue ha")[0].name == "blue_hair"

    def test_an_alias_finds_its_canonical_tag(self, idx):
        hit = idx.search("hires")[0]
        assert hit.name == "hires"
        assert hit.aliased_to == "highres"

    def test_a_canonical_tag_is_not_listed_twice_via_its_own_alias(self, idx):
        """`1girl` matches both itself and the alias `1girls`, which resolves
        back to `1girl` — without dedup the same row rendered twice."""
        names = [t.aliased_to or t.name for t in idx.search("1girl")]
        assert names.count("1girl") == 1

    def test_a_direct_hit_beats_an_alias_hit_for_the_same_tag(self, idx):
        """So `1girl` lists as itself rather than as `1girls -> 1girl`."""
        assert idx.search("1girl")[0].aliased_to is None

    def test_limit_is_honoured(self, idx):
        assert len(idx.search("blue_", limit=1)) == 1

    def test_an_empty_query_returns_nothing(self, idx):
        assert idx.search("") == []
        assert idx.search("   ") == []


class TestUnusableFiles:
    def test_a_missing_file_is_not_an_error(self, tmp_path):
        assert load_index(tmp_path / "nope.csv") is None

    def test_an_empty_file_yields_no_index(self, tmp_path):
        assert load_index(_write(tmp_path, "")) is None

    def test_a_file_of_only_junk_yields_no_index(self, tmp_path):
        assert load_index(_write(tmp_path, "nonsense\nmore nonsense\n")) is None


class TestStaleness:
    def test_rewriting_the_file_marks_the_index_stale(self, tmp_path):
        path = _write(tmp_path, "1girl,100\n")
        idx = load_index(path)
        assert idx.is_stale() is False
        import os
        stat = path.stat()
        path.write_text("1girl,100\nsolo,50\n", encoding="utf-8")
        os.utime(path, (stat.st_atime + 10, stat.st_mtime + 10))
        assert idx.is_stale() is True

    def test_a_deleted_file_reads_as_stale(self, tmp_path):
        path = _write(tmp_path, "1girl,100\n")
        idx = load_index(path)
        path.unlink()
        assert idx.is_stale() is True
