"""Plain wildcard-file export (engine/wildcard_export.py)."""

from __future__ import annotations

import io
import zipfile

from engine import wildcard_export as wx
from engine.syntax import tokenize
from engine.wildcard_files import convert_files, read_zip


def _wc(id_: str, name: str, var: str, options: list[dict]) -> dict:
    return {
        "id": id_,
        "type": "wildcard",
        "name": name,
        "payload": {"var_binding": var, "options": options},
    }


def _opt(value: str, weight: float = 1, **extra) -> dict:
    return {"id": "o" + value[:6], "value": value, "weight": weight, **extra}


def test_patterns_match_the_engine_tokenizer() -> None:
    # The exporter keeps its own parser so the community site can vendor it
    # alone; it must read $vars and @{refs} exactly as the engine does.
    assert wx._VAR_RE.pattern == tokenize._VAR_RE.pattern
    assert wx._REF_RE.pattern == tokenize._REF_RE.pattern


def test_wildcard_lines_refs_and_vars() -> None:
    hair = _wc("aaaaaaaa", "Hair colour", "hair", [_opt("red"), _opt("blonde")])
    look = _wc(
        "bbbbbbbb",
        "Look",
        "look",
        [_opt("$hair hair, {smiling|serious}"), _opt("@{aaaaaaaa#Hair colour} wig")],
    )
    out = wx.export_items([hair, look], "My Pack")
    texts = out.file_texts()
    assert texts["my_pack/hair.txt"] == "red\nblonde\n"
    assert texts["my_pack/look.txt"] == (
        "__my_pack/hair__ hair, {smiling|serious}\n__my_pack/hair__ wig\n"
    )
    look_file = next(f for f in out.files if f.path == "look")
    assert any("new pick" in n for n in look_file.notes)


def test_weights_become_repeated_lines() -> None:
    w = _wc("cccccccc", "W", "w", [_opt("a", 1), _opt("b", 2), _opt("c", 0.5)])
    assert wx.export_items([w], "p").file_texts()["p/w.txt"] == "a\na\nb\nb\nb\nb\nc\n"


def test_extreme_weights_are_capped_and_noted() -> None:
    w = _wc("cccccccc", "W", "w", [_opt("rare", 1), _opt("common", 100)])
    out = wx.export_items([w], "p")
    lines = out.file_texts()["p/w.txt"].splitlines()
    assert lines.count("common") == wx.MAX_COPIES
    assert lines.count("rare") == 1
    assert any("rounded" in n for n in out.files[0].notes)


def test_null_tags_negatives_fallback_are_noted() -> None:
    w = _wc(
        "dddddddd",
        "W",
        "w",
        [
            _opt("a", sub_categories=["x"], negative="ugly", fallback=True),
            {"id": "n", "value": "", "weight": 1, "is_null": True},
            _opt("zero", 0),
        ],
    )
    out = wx.export_items([w], "p")
    assert out.file_texts()["p/w.txt"] == "a\n"
    notes = " | ".join(out.files[0].notes)
    for word in ("50% chance of nothing", "tags", "negative", "fallback", "weight 0"):
        assert word in notes


def test_multi_pick_escapes_and_missing_refs() -> None:
    w = _wc(
        "eeeeeeee",
        "W",
        "w",
        [_opt("{1-2~$$ and $$a|$$b} costs $$5 @@home @{12345678#Other Thing:red} $nope")],
    )
    out = wx.export_items([w], "p")
    assert out.file_texts()["p/w.txt"] == (
        "{1-2$$ and $$a|$b} costs $5 @home __other_thing__ $nope\n"
    )
    notes = " | ".join(out.files[0].notes)
    assert "`~`" in notes and "filter" in notes and "not in this pack" in notes


def test_fixed_values_combines_templates_and_bundles() -> None:
    bundle = {
        "id": "bun00001",
        "name": "Bundle",
        "children": [
            {"id": "f1", "type": "fixed_values", "meta": {"name": "Style"},
             "payload": {"values": [{"id": "v", "name": "style", "value": "oil painting"}]}},
            {"id": "c1", "type": "combine", "meta": {"name": "Scene"},
             "payload": {"template": "$style of $who", "output_var": "scene"}},
            {"id": "w1", "type": "wildcard", "meta": {"name": "Who"},
             "payload": {"var_binding": "who", "options": [_opt("a cat")]}},
            {"id": "d1", "type": "derivation", "meta": {"name": "Rules"}, "payload": {}},
        ],
    }
    env = {
        "bundles": [bundle],
        "templates": [{"id": "t1", "name": "Portrait", "template_string": "$scene, best quality",
                       "negative_template": "blurry"}],
    }
    out = wx.export_envelope(env, "Pack")
    texts = out.file_texts()
    assert texts["pack/style.txt"] == "oil painting\n"
    assert texts["pack/scene.txt"] == "__pack/style__ of __pack/who__\n"
    assert texts["pack/templates/portrait.txt"] == "__pack/scene__, best quality\n"
    assert texts["pack/templates/portrait.negative.txt"] == "blurry\n"
    assert any("Rules" in s for s in out.skipped)


def test_post_payload_and_zip_round_trip_through_the_importer() -> None:
    w = _wc("ffffffff", "Colours", "colour", [_opt("red", 2), _opt("blue")])
    items = wx.items_from_post_payload(w)
    data = wx.export_items(items, "colours").to_zip(
        title="Colours", source="https://wp.example.dev/p/a/colours"
    )
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = sorted(zf.namelist())
    assert names == ["colours/README.md", "colours/colour.txt"]
    readme = zf.read("colours/README.md").decode()
    assert "https://wp.example.dev/p/a/colours" in readme
    assert "__colours/colour__" in readme
    # Our own importer reads it back, folding the repeated line into a weight.
    result = convert_files(read_zip(data))
    opts = result["payload"]["wildcards"][0]["payload"]["options"]
    assert {o["value"]: o["weight"] for o in opts} == {"red": 2, "blue": 1}


def test_duplicate_names_get_their_own_files() -> None:
    a = _wc("aaaaaaa1", "A", "same", [_opt("1")])
    b = _wc("aaaaaaa2", "B", "same", [_opt("2")])
    paths = sorted(f.path for f in wx.export_items([a, b], "p").files)
    assert paths == ["same", "same_2"]


def test_empty_wildcard_and_leading_hash() -> None:
    w = _wc("aaaaaaa3", "W", "w", [_opt("# heading"), _opt("##")])
    out = wx.export_items([w], "p")
    assert out.file_texts()["p/w.txt"] == "heading\n"
    e = _wc("aaaaaaa4", "E", "e", [])
    assert wx.export_items([e], "p").file_texts()["p/e.txt"] == "# (empty)\n"
