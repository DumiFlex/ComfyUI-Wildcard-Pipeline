"""LoRA / embedding completion source.

Matching rules only — the HTTP layer is a thin wrapper over these, and the
folder enumeration belongs to ComfyUI.
"""
from __future__ import annotations

from wp_api._model_index import build_hits, search


def hits(*paths: str):
    return build_hits(list(paths))


class TestDisplayShape:
    def test_strips_folder_and_extension_for_display(self):
        [h] = hits("style/watercolour_v2.safetensors")
        assert h.name == "watercolour_v2"
        assert h.folder == "style"
        # The insert must use the full path: two folders can hold the same
        # filename and ComfyUI resolves by path, so inserting the short name
        # would silently pick whichever it found first.
        assert h.path == "style/watercolour_v2.safetensors"

    def test_handles_windows_separators(self):
        [h] = hits("character\\anime\\miku.safetensors")
        assert h.name == "miku"
        assert h.folder == "character/anime"

    def test_a_file_at_the_root_has_no_folder(self):
        [h] = hits("detail_tweaker.safetensors")
        assert h.name == "detail_tweaker"
        assert h.folder == ""


class TestSearch:
    def test_empty_query_matches_nothing(self):
        # Guards against a stray keystroke dumping the entire model folder into
        # the popover.
        assert search(hits("a.safetensors", "b.safetensors"), "", 10) == []

    def test_prefix_matches_rank_above_substring_matches(self):
        found = search(
            hits("hand_fix.safetensors", "lazyhand.safetensors", "lazy_eyes.safetensors"),
            "lazy",
            10,
        )
        assert [h.name for h in found] == ["lazy_eyes", "lazyhand"]

    def test_substring_matches_are_included(self):
        found = search(hits("super_detail.safetensors"), "detail", 10)
        assert [h.name for h in found] == ["super_detail"]

    def test_matching_is_case_insensitive(self):
        found = search(hits("Watercolour.safetensors"), "water", 10)
        assert [h.name for h in found] == ["Watercolour"]

    def test_the_folder_is_searchable_too(self):
        # "which of my character loras was it" is a real way to look, and the
        # folder is often the only place that word appears.
        found = search(hits("character/miku.safetensors"), "character", 10)
        assert [h.name for h in found] == ["miku"]

    def test_limit_is_honoured(self):
        many = hits(*[f"lazy{i}.safetensors" for i in range(30)])
        assert len(search(many, "lazy", 5)) == 5

    def test_ordering_is_stable_across_calls(self):
        # An unstable list under a moving keyboard selection is how you press
        # Enter on the wrong row.
        pool = hits("lazyB.safetensors", "lazyA.safetensors", "lazyC.safetensors")
        first = [h.name for h in search(pool, "lazy", 10)]
        second = [h.name for h in search(pool, "lazy", 10)]
        assert first == second == ["lazyA", "lazyB", "lazyC"]
