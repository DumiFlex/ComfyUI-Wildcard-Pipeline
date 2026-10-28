"""engine/label_grid.py — label reading, templates, wrap, single labels, grids."""

from __future__ import annotations

from PIL import Image

from engine import label_grid as g


def img(w=200, h=100, color=(255, 0, 0)):
    return Image.new("RGB", (w, h), color)


# ── labels ────────────────────────────────────────────────────────────────


def test_item_labels_split_broadcast_and_missing():
    out = g.item_labels(["a\nb", "one", None, "x\ny"], [2, 3, 1, 3])
    assert out == [["a", "b"], ["one"] * 3, [""], ["x", "y", ""]]


def test_item_labels_one_text_spread_over_items():
    assert g.item_labels(["a\nb\nc"], [1, 2]) == [["a"], ["b", "c"]]
    # line count doesn't match: first item only, as usual
    assert g.item_labels(["a\nb"], [1, 2]) == [["a"], ["", ""]]


def test_item_labels_without_input_or_with_fewer_entries():
    assert g.item_labels(None, [2]) == [["", ""]]
    assert g.item_labels(["a"], [1, 1]) == [["a"], [""]]


def test_template_tokens_and_empty_template():
    assert g.apply_template("#{index}/{count} f{frame} i{image}: {label}", "red", 1, 0, 4, 9) == (
        "#5/9 f2 i1: red"
    )
    assert g.apply_template("", "kept", 0, 0, 0, 1) == "kept"
    assert g.apply_template("a\\nb", "", 0, 0, 0, 1) == "a\nb"
    assert g.apply_template("{unknown}", "", 0, 0, 0, 1) == "{unknown}"


def test_parts():
    label = "#3 · red · pencil · 2"
    assert g.split_parts(label) == ["#3", "red", "pencil", "2"]
    assert g.part(label, 2) == "red"
    assert g.part(label, -1) == "2"
    assert g.part(label, 9) == ""
    assert g.part("", 1) == ""
    assert g.drop_parts(label, [2, 3]) == "#3 · 2"
    assert g.drop_parts(label, [-1]) == "#3 · red · pencil"


def test_typed_headers():
    assert g.typed_headers("a\n b \nc\\nd") == ["a", "b", "c\nd"]
    assert g.typed_headers("  ") == []


def test_parse_color():
    assert g.parse_color("#fff", (0, 0, 0, 0)) == (255, 255, 255, 255)
    assert g.parse_color("#00000080", (1, 1, 1, 1)) == (0, 0, 0, 128)
    assert g.parse_color("none", (1, 1, 1, 1)) == (0, 0, 0, 0)
    assert g.parse_color("not a colour", (1, 2, 3, 4)) == (1, 2, 3, 4)
    assert g.parse_color("red", (0, 0, 0, 0)) == (255, 0, 0, 255)


def test_fonts_fall_back_and_list_starts_with_default():
    assert g.list_fonts()[0] == g.DEFAULT_FONT
    font = g.load_font("no-such-font.ttf", 20)
    assert font.getlength("abc") > 0


# ── wrap ──────────────────────────────────────────────────────────────────


def test_wrap_words_long_words_and_ellipsis():
    font = g.load_font(g.DEFAULT_FONT, 16)
    lines = g.wrap("one two three four five six seven eight nine ten", font, 60, 10)
    assert len(lines) > 1
    assert all(font.getlength(ln) <= 60 for ln in lines)
    long = g.wrap("x" * 80, font, 50, 40)
    assert len(long) > 1 and "".join(long) == "x" * 80
    cut = g.wrap("word " * 60, font, 60, 2)
    assert len(cut) == 2 and cut[-1].endswith("…")
    assert g.wrap("a\nb", font, 500, 5) == ["a", "b"]


# ── single image ──────────────────────────────────────────────────────────


def test_label_strip_positions_change_size_the_right_way():
    base = img()
    top = g.label_image(base, "hello", g.Style(position="top"))
    assert top.width == 200 and top.height > 100
    # the image sits under the strip
    assert top.getpixel((100, top.height - 1)) == (255, 0, 0)
    bottom = g.label_image(base, "hello", g.Style(position="bottom"))
    assert bottom.getpixel((100, 0)) == (255, 0, 0)
    left = g.label_image(base, "hello", g.Style(position="left"))
    assert left.height == 100 and left.width > 200
    assert left.getpixel((left.width - 1, 50)) == (255, 0, 0)
    right = g.label_image(base, "hello", g.Style(position="right"))
    assert right.getpixel((0, 50)) == (255, 0, 0)


def test_overlay_keeps_size_and_blends():
    base = img()
    over = g.label_image(base, "hi", g.Style(position="over_bottom", label_color="#0000ff80"))
    assert over.size == base.size
    r, _g, b = over.getpixel((2, 98))
    assert 100 < r < 160 and 100 < b < 160
    assert over.getpixel((100, 2)) == (255, 0, 0)


def test_no_text_or_none_leaves_the_image():
    base = img()
    assert g.label_image(base, "", g.Style()) is base
    assert g.label_image(base, "x", g.Style(position="none")) is base
    assert g.label_image(base, "", g.Style(position="over_top")) is base


def test_batch_keeps_one_shape():
    out = g.label_batch([img(), img()], ["short", "a much longer label " * 6], g.Style())
    assert out[0].size == out[1].size
    plain = g.label_batch([img(), img()], ["", ""], g.Style())
    assert [p.size for p in plain] == [(200, 100), (200, 100)]


def test_font_size_auto_and_fixed():
    assert g.Style().auto_size(1000) == 45
    assert g.Style().auto_size(10) == 12
    assert g.Style(font_size=30).auto_size(1000) == 30


# ── grid ──────────────────────────────────────────────────────────────────


def cells_from(labels, w=100, h=80, items=None):
    return [
        g.Cell(img(w, h, (i * 20 % 255, 0, 0)), lab, items[i] if items else i, 0)
        for i, lab in enumerate(labels)
    ]


def test_frames_as_rows_and_columns():
    cells = [g.Cell(img(), "", it, ix) for it in range(2) for ix in range(3)]
    grid, _c, _r = g.arrange(cells, g.GridSpec())
    assert [[c.item if c else None for c in row] for row in grid] == [[0, 0, 0], [1, 1, 1]]
    grid, _c, _r = g.arrange(cells, g.GridSpec(arrange="columns"))
    assert len(grid) == 3 and len(grid[0]) == 2


def test_fill_rows_with_columns_and_auto_square():
    cells = cells_from([""] * 7)
    grid, _c, _r = g.arrange(cells, g.GridSpec(arrange="fill", columns=3))
    assert [len(r) for r in grid] == [3, 3, 3]
    assert grid[2][1] is None
    one_batch = [g.Cell(img(), "", 0, i) for i in range(5)]
    grid, _c, _r = g.arrange(one_batch, g.GridSpec())
    assert len(grid[0]) == 3 and len(grid) == 2


def test_xy_from_label_parts_any_order():
    labels = ["#4 · b · y", "#1 · a · x", "#2 · a · y", "#3 · b · x"]
    grid, cols, rows = g.arrange(cells_from(labels), g.GridSpec(row_part=2, column_part=3))
    assert rows == ["b", "a"] and cols == ["y", "x"]
    assert [[c.label for c in row] for row in grid] == [
        ["#4 · b · y", "#3 · b · x"],
        ["#2 · a · y", "#1 · a · x"],
    ]


def test_xy_duplicate_spot_repeats_the_row():
    labels = ["#1 · a · x", "#2 · a · x", "#3 · a · y"]
    grid, _cols, rows = g.arrange(cells_from(labels), g.GridSpec(row_part=2, column_part=3))
    assert rows == ["a", "a"]
    assert grid[1][1] is None and grid[1][0] is not None


def test_one_axis_from_labels():
    labels = ["#1 · a", "#2 · b", "#3 · a"]
    grid, cols, _rows = g.arrange(cells_from(labels), g.GridSpec(column_part=2))
    assert cols == ["a", "b"]
    assert len(grid) == 2 and grid[1][1] is None
    grid, _cols, rows = g.arrange(cells_from(labels), g.GridSpec(row_part=2))
    assert rows == ["a", "b"] and len(grid[0]) == 2


def test_build_grid_size_headers_and_gap():
    cells = cells_from(["#1 · a · x", "#2 · a · y", "#3 · b · x", "#4 · b · y"])
    style = g.Style(position="none", gap=10, margin=5)
    plain = g.build_grid(cells, style, g.GridSpec(arrange="fill", columns=2))
    assert plain.size == (5 * 2 + 100 * 2 + 10, 5 * 2 + 80 * 2 + 10)
    headed = g.build_grid(cells, style, g.GridSpec(row_part=2, column_part=3, title="T"))
    assert headed.width > plain.width and headed.height > plain.height


def test_build_grid_mixed_sizes_center_in_largest_cell():
    cells = [g.Cell(img(100, 80), "", 0, 0), g.Cell(img(50, 40, (0, 255, 0)), "", 0, 1)]
    out = g.build_grid(
        cells, g.Style(position="none", gap=0), g.GridSpec(arrange="fill", columns=2)
    )
    assert out.size == (200, 80)
    assert out.getpixel((150, 40)) == (0, 255, 0)
    assert out.getpixel((101, 1)) == (255, 255, 255)


def test_build_grid_cell_width_scales_and_labels_add_strips():
    cells = cells_from(["a", "b"], w=400, h=200)
    out = g.build_grid(cells, g.Style(gap=0, cell_width=100), g.GridSpec(arrange="fill", columns=2))
    assert out.width == 200 and out.height > 50


def test_build_grid_caps_huge_output(monkeypatch):
    monkeypatch.setattr(g, "MAX_GRID_SIDE", 150)
    out = g.build_grid(
        cells_from(["", ""]),
        g.Style(position="none", gap=0),
        g.GridSpec(arrange="fill", columns=2),
    )
    assert max(out.size) == 150


def test_build_grid_rejects_nothing():
    try:
        g.build_grid([], g.Style(), g.GridSpec())
    except ValueError:
        return
    raise AssertionError("expected ValueError")


# ── config ────────────────────────────────────────────────────────────────


def test_parse_config_defaults_and_recovery():
    assert g.parse_config("") == g.DEFAULT_CONFIG
    assert g.parse_config("not json") == g.DEFAULT_CONFIG
    assert g.parse_config("[1]") == g.DEFAULT_CONFIG
    cfg = g.parse_config(
        {
            "position": "over_bottom",
            "align": "nope",
            "arrange": "fill",
            "columns": 999,
            "gap": -4,
            "font_size": 12.7,
            "grid": False,
            "rows_from": "part:2",
            "columns_from": "part:x",
            "title": "T",
            "label": 5,
            "unknown": 1,
        }
    )
    assert cfg["position"] == "over_bottom"
    assert cfg["align"] == "center"
    assert cfg["arrange"] == "fill"
    assert cfg["columns"] == 256
    assert cfg["gap"] == 0
    assert cfg["font_size"] == 12
    assert cfg["grid"] is False
    assert cfg["rows_from"] == "part:2"
    assert cfg["columns_from"] == "none"
    assert cfg["title"] == "T"
    assert cfg["label"] == "{label}"
    assert "unknown" not in cfg


def test_header_part_and_examples():
    assert g.header_part("part:3") == 3
    assert g.header_part("part:-1") == -1
    assert g.header_part("typed") == 0
    labels = [
        f"#{i} · {t} · {s}"
        for i, (t, s) in enumerate(
            [("dawn", "a"), ("noon", "a"), ("night", "b"), ("dusk", "b"), ("x", "c")], 1
        )
    ]
    ex = g.part_examples(labels, per_part=3)
    assert ex[0] == {"values": ["#1", "#2", "#3"], "count": 5}
    assert ex[1] == {"values": ["dawn", "noon", "night"], "count": 5}
    assert ex[2] == {"values": ["a", "b", "c"], "count": 3}
    assert g.part_examples([]) == []


def test_auto_arrange_follows_the_run_shape():
    assert g.auto_arrange([1]) == "fill"
    assert g.auto_arrange([9]) == "fill"
    assert g.auto_arrange([1, 1, 1]) == "strip"
    assert g.auto_arrange([1] * 12) == "fill"
    assert g.auto_arrange([4, 4]) == "rows"
    assert g.auto_arrange([]) == "fill"


def test_auto_strip_and_stack_layouts():
    singles = [g.Cell(img(), "", i, 0) for i in range(3)]
    grid, _c, _r = g.arrange(singles, g.GridSpec(arrange="auto"))
    assert len(grid) == 1 and len(grid[0]) == 3
    batches = [g.Cell(img(), "", it, ix) for it in range(2) for ix in range(2)]
    grid, _c, _r = g.arrange(batches, g.GridSpec(arrange="auto"))
    assert [[c.item if c else None for c in row] for row in grid] == [[0, 0], [1, 1]]
    grid, _c, _r = g.arrange(batches, g.GridSpec(arrange="strip"))
    assert len(grid) == 1 and len(grid[0]) == 4
    grid, _c, _r = g.arrange(batches, g.GridSpec(arrange="stack"))
    assert len(grid) == 4 and len(grid[0]) == 1


def test_config_corpus_matches_the_canvas_mirror():
    """src/extension/label-grid.test.ts reads the same cases."""
    import json
    from pathlib import Path

    corpus = Path(__file__).parents[1] / "fixtures" / "label-grid-config-corpus.json"
    for case in json.loads(corpus.read_text(encoding="utf-8"))["cases"]:
        assert g.parse_config(case["raw"]) == case["expected"], case["name"]
