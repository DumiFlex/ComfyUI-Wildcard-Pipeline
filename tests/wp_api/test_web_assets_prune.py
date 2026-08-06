"""Stale build artefacts are removed on start; live files never are.

Context in `wp_api/web_assets.py`. Short version: chunks are content-hashed and
Manager extracts updates over the installed folder without deleting what the
new version dropped, so every update leaves the previous build behind. A real
2.13.1 install had 1,774 files across js/ and web/ where ~200 were live.

The risk in the fix is the obvious one — deleting something still in use — so
most of these tests are about what must SURVIVE.
"""
from __future__ import annotations

import json

from wp_api.web_assets import prune_package_assets, prune_stale_assets

MANIFEST = ".wp-assets.json"


def _build(root, live, stale=(), manifest=True):
    """Lay out a directory: `live` files are listed, `stale` ones are not."""
    root.mkdir(parents=True, exist_ok=True)
    for rel in list(live) + list(stale):
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x", encoding="utf-8")
    if manifest:
        (root / MANIFEST).write_text(
            json.dumps({"files": sorted(live)}), encoding="utf-8",
        )
    return root


class TestRemovesStaleArtefacts:
    def test_deletes_hashed_chunks_the_manifest_does_not_list(self, tmp_path):
        root = _build(
            tmp_path / "js",
            live=["main.js", "assets/context-AAAAAAAA.js"],
            stale=["assets/context-BBBBBBBB.js", "assets/context-CCCCCCCC.js"],
        )
        removed = prune_stale_assets(root)
        assert sorted(removed) == [
            "assets/context-BBBBBBBB.js", "assets/context-CCCCCCCC.js",
        ]
        assert (root / "assets/context-AAAAAAAA.js").exists()
        assert (root / "main.js").exists()

    def test_removes_orphaned_css_and_map_artefacts_too(self, tmp_path):
        root = _build(
            tmp_path / "web",
            live=["index.html"],
            stale=["assets/manager-D4E5F6A7.css", "assets/manager-D4E5F6A7.js.map"],
        )
        assert len(prune_stale_assets(root)) == 2

    def test_removes_the_unhashed_entry_sourcemap(self, tmp_path):
        """`main.js.map` carries no content hash, so the hashed pattern misses
        it and it would otherwise survive forever on an install that predates
        maps being switched off. Any `.map` is bundler output, never authored
        content, so it is safe to match on the extension alone."""
        root = _build(tmp_path / "js", live=["main.js"], stale=["main.js.map"])
        assert prune_stale_assets(root) == ["main.js.map"]
        assert (root / "main.js").exists()

    def test_a_sourcemap_the_build_did_produce_survives(self, tmp_path):
        """WP_DEBUG_MAPS=1 emits maps deliberately; the manifest lists them."""
        root = _build(tmp_path / "js", live=["main.js", "main.js.map"])
        assert prune_stale_assets(root) == []
        assert (root / "main.js.map").exists()

    def test_prunes_both_output_directories(self, tmp_path):
        _build(tmp_path / "js", live=["main.js"], stale=["assets/a-AAAAAAAA.js"])
        _build(tmp_path / "web", live=["index.html"], stale=["assets/b-BBBBBBBB.js"])
        assert prune_package_assets(tmp_path) == 2


class TestNeverRemovesWhatMatters:
    def test_unhashed_files_survive_even_when_unlisted(self, tmp_path):
        """The pattern is the safety net.

        Docs, images, fonts and anything a user dropped in by hand carry no
        content hash, so they are out of scope regardless of the manifest.
        Missing a stale file costs disk; deleting a live one breaks the
        install.
        """
        root = _build(
            tmp_path / "js",
            live=["main.js"],
            stale=[
                "docs/WP_Context.md",
                "images/logo.png",
                "assets/fonts/inter-latin.woff2",
                "assets/fonts/wp-fonts.css",
                "notes.txt",
            ],
        )
        assert prune_stale_assets(root) == []
        assert (root / "docs/WP_Context.md").exists()
        assert (root / "assets/fonts/wp-fonts.css").exists()

    def test_no_manifest_means_no_deletions(self, tmp_path):
        """Covers installs predating this mechanism and partial extracts."""
        root = _build(
            tmp_path / "js",
            live=["main.js"],
            stale=["assets/context-BBBBBBBB.js"],
            manifest=False,
        )
        assert prune_stale_assets(root) == []
        assert (root / "assets/context-BBBBBBBB.js").exists()

    def test_an_empty_manifest_is_refused_rather_than_obeyed(self, tmp_path):
        """An empty list reads as 'delete every hashed file'.

        That is indistinguishable from a truncated or half-written manifest,
        and obeying it would wipe a working install.
        """
        root = tmp_path / "js"
        root.mkdir()
        (root / "assets").mkdir()
        (root / "assets/context-AAAAAAAA.js").write_text("x", encoding="utf-8")
        (root / MANIFEST).write_text(json.dumps({"files": []}), encoding="utf-8")
        assert prune_stale_assets(root) == []
        assert (root / "assets/context-AAAAAAAA.js").exists()

    def test_a_corrupt_manifest_is_refused(self, tmp_path):
        root = tmp_path / "js"
        root.mkdir()
        (root / "assets").mkdir()
        (root / "assets/context-AAAAAAAA.js").write_text("x", encoding="utf-8")
        (root / MANIFEST).write_text("{not json", encoding="utf-8")
        assert prune_stale_assets(root) == []
        assert (root / "assets/context-AAAAAAAA.js").exists()

    def test_the_manifest_itself_is_never_deleted(self, tmp_path):
        root = _build(tmp_path / "js", live=["main.js"], stale=["assets/a-AAAAAAAA.js"])
        prune_stale_assets(root)
        assert (root / MANIFEST).exists()

    def test_a_missing_directory_is_not_an_error(self, tmp_path):
        assert prune_stale_assets(tmp_path / "nope") == []
        assert prune_package_assets(tmp_path) == 0
