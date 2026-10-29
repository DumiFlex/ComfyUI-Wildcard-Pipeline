"""Pure logic behind ``WP_LabelGrid`` — draw labels on images and lay them out
in a labelled grid.

Shapes. The node is ``is_input_list``, so ``images`` arrives as a list of
items and each item is an IMAGE batch: one image, a batch, a Context Loop's
N frames, or N frames of batches. Here every image is a PIL image and an item
is a list of them; the node converts tensors on the way in and out.

Labels. The optional ``labels`` input is a STRING list aligned with the items
(the Image Filter's ``labels`` output, or any text). Each entry splits on
newlines for the images of its batch; one line broadcasts to every image in
the item, missing lines and missing entries mean no label. A label may hold
parts joined by ``" · "`` (the Image Filter writes ``#N · option · option · K``),
and the grid can lift a part into the row or column headers, which also
arranges the cells by those values (an XY plot from a sweep).

Kept free of torch and ComfyUI imports so it is tested with plain pytest.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

from PIL import Image, ImageColor, ImageDraw, ImageFont

PART_SEP = " · "

POSITIONS = ("top", "bottom", "left", "right", "over_top", "over_bottom", "none")
ALIGNS = ("center", "left", "right")
#: auto = fit the run's shape (see ``auto_arrange``), rows = one row per input
#: item (its batch across), columns = turned around, fill = every image in
#: turn, ``columns`` per row (0 = near square), strip = one row, stack = one
#: column.
ARRANGE = ("auto", "rows", "columns", "fill", "strip", "stack")
#: ``auto`` lays a list of single images out in one row up to this many.
STRIP_MAX = 6
#: ``none`` / ``typed`` / ``part:N`` (N from 1, ``part:-1`` = the last part).
HEADER_FROM = re.compile(r"^(none|typed|part:-?[1-9]\d?)$")

DEFAULT_FONT = "default"
#: Lines a cell label may wrap to before it is cut with an ellipsis.
MAX_LABEL_LINES = 3
#: Lines a header may wrap to.
MAX_HEADER_LINES = 4
#: Hard cap on the grid's longest side; bigger grids are scaled down to it.
MAX_GRID_SIDE = 16_384

_TOKEN = re.compile(r"\{(label|frame|image|index|count)\}")


# ── labels ────────────────────────────────────────────────────────────────


def item_labels(labels: list[Any] | None, batch_sizes: list[int]) -> list[list[str]]:
    """One label per image: ``out[item][image]``.

    ``labels[item]`` splits on newlines for the item's batch. One line covers
    every image of the item; with fewer lines than images the rest get none.
    A single entry for several items whose lines match the total image count
    is spread over all of them (typed text, one line per image), and a single
    one-line entry labels every image of every item.
    """
    out: list[list[str]] = []
    if labels is not None and len(labels) == 1 and len(batch_sizes) > 1:
        # One text for several items (a typed list, one line per image): when
        # its lines match the image count, spread them over every image.
        only = labels[0] if isinstance(labels[0], str) else ""
        lines = [ln.strip() for ln in only.splitlines()]
        if len(lines) == 1 and lines[0]:
            return [[lines[0]] * size for size in batch_sizes]
        if len(lines) == sum(batch_sizes):
            for size in batch_sizes:
                out.append(lines[:size])
                lines = lines[size:]
            return out
    for i, size in enumerate(batch_sizes):
        raw = labels[i] if labels is not None and i < len(labels) else None
        text = raw if isinstance(raw, str) else ("" if raw is None else str(raw))
        lines = [ln.strip() for ln in text.splitlines()] if text.strip() else []
        if len(lines) == 1:
            out.append([lines[0]] * size)
        else:
            out.append([lines[j] if j < len(lines) else "" for j in range(size)])
    return out


def apply_template(
    template: str, label: str, frame: int, image: int, index: int, count: int
) -> str:
    """Fill a label template. ``{label}`` is the incoming label; ``{frame}`` and
    ``{image}`` count from 1 inside the input, ``{index}`` from 1 across all
    images, ``{count}`` is the number of images. An empty template means the
    incoming label as it is."""
    if not template.strip():
        return label
    values = {
        "label": label,
        "frame": str(frame + 1),
        "image": str(image + 1),
        "index": str(index + 1),
        "count": str(count),
    }
    text = _TOKEN.sub(lambda m: values[m.group(1)], template)
    return text.replace("\\n", "\n").strip()


def split_parts(label: str) -> list[str]:
    return [p.strip() for p in label.split(PART_SEP)] if label else []


def part(label: str, index: int) -> str:
    """A label's part, counted from 1; negative counts from the end. ``""``
    when the label has no such part."""
    parts = split_parts(label)
    if index > 0 and index <= len(parts):
        return parts[index - 1]
    if index < 0 and -index <= len(parts):
        return parts[index]
    return ""


def drop_parts(label: str, indexes: list[int]) -> str:
    """The label without the parts lifted into headers."""
    parts = split_parts(label)
    n = len(parts)
    gone = {(i - 1) if i > 0 else (n + i) for i in indexes if i != 0}
    return PART_SEP.join(p for k, p in enumerate(parts) if k not in gone)


def typed_headers(text: str) -> list[str]:
    """Headers typed into a widget: one per line (``\\n`` inside a line breaks it)."""
    return [ln.strip().replace("\\n", "\n") for ln in text.splitlines()] if text.strip() else []


# ── config (the node's JSON widget) ───────────────────────────────────────

DEFAULT_CONFIG: dict[str, Any] = {
    "label": "{label}",
    "position": "top",
    "align": "center",
    "font": "default",
    "font_size": 0,
    "text_color": "#ffffff",
    "label_color": "#000000",
    "grid": True,
    "arrange": "auto",
    "columns": 0,
    "rows_from": "none",
    "row_headers": "",
    "columns_from": "none",
    "column_headers": "",
    "title": "",
    "gap": 8,
    "margin": 0,
    "background": "#ffffff",
    "header_color": "#000000",
    "cell_width": 0,
}

_INT_LIMITS = {"font_size": 1024, "columns": 256, "gap": 512, "margin": 1024, "cell_width": 8192}
_TEXT_KEYS = (
    "label",
    "font",
    "text_color",
    "label_color",
    "row_headers",
    "column_headers",
    "title",
    "background",
    "header_color",
)


def parse_config(raw: Any) -> dict[str, Any]:
    """Decode the node's JSON widget, falling back per key: unknown keys are
    ignored and a bad value takes its default, so an older or hand-edited
    workflow still runs."""
    out = dict(DEFAULT_CONFIG)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except ValueError:
            raw = {}
    if not isinstance(raw, dict):
        return out
    for key, allowed in (("position", POSITIONS), ("align", ALIGNS), ("arrange", ARRANGE)):
        if raw.get(key) in allowed:
            out[key] = raw[key]
    for key in ("rows_from", "columns_from"):
        value = raw.get(key)
        if isinstance(value, str) and HEADER_FROM.match(value) and value not in ("part:0",):
            out[key] = value
    for key, top in _INT_LIMITS.items():
        value = raw.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            out[key] = max(0, min(top, int(value)))
    for key in _TEXT_KEYS:
        value = raw.get(key)
        if isinstance(value, str):
            out[key] = value
    if isinstance(raw.get("grid"), bool):
        out["grid"] = raw["grid"]
    return out


def header_part(source: str) -> int:
    """The label part a ``part:N`` header source names; 0 for none / typed."""
    if source.startswith("part:"):
        try:
            return int(source[5:])
        except ValueError:
            return 0
    return 0


def part_examples(labels: list[str], parts: int = 6, per_part: int = 4) -> list[dict[str, Any]]:
    """Each label part's distinct values in first-seen order (a few of them)
    and how many there are, so the widget can show what "part 2" holds and
    pick the parts an XY plot should use."""
    out: list[dict[str, Any]] = []
    for k in range(1, parts + 1):
        seen: list[str] = []
        for label in labels:
            value = part(label, k)
            if value and value not in seen:
                seen.append(value)
        if not seen:
            break
        out.append({"values": seen[:per_part], "count": len(seen)})
    return out


def auto_arrange(batch_sizes: list[int]) -> str:
    """What ``arrange = auto`` does with this run: one image or one batch
    fills a near-square sheet, a few single images sit in one row, more of
    them fill a sheet, and a list of batches gets one row per item."""
    sizes = [s for s in batch_sizes if s > 0]
    if len(sizes) <= 1:
        return "fill"
    if all(s == 1 for s in sizes):
        return "strip" if len(sizes) <= STRIP_MAX else "fill"
    return "rows"


# ── fonts + colours ───────────────────────────────────────────────────────


def font_dirs() -> list[str]:
    """Folders searched for fonts: the extension's ``fonts/`` then the OS's."""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dirs = [os.path.join(here, "fonts")]
    windir = os.environ.get("WINDIR")
    if windir:
        dirs.append(os.path.join(windir, "Fonts"))
        local = os.environ.get("LOCALAPPDATA")
        if local:
            dirs.append(os.path.join(local, "Microsoft", "Windows", "Fonts"))
    dirs += [
        "/Library/Fonts",
        "/System/Library/Fonts",
        os.path.expanduser("~/Library/Fonts"),
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        os.path.expanduser("~/.fonts"),
    ]
    return dirs


def list_fonts() -> list[str]:
    """``default`` plus every ``.ttf`` / ``.otf`` / ``.ttc`` found, by file name."""
    seen: dict[str, str] = {}
    for d in font_dirs():
        if not os.path.isdir(d):
            continue
        for root, _dirs, files in os.walk(d):
            for name in files:
                if name.lower().endswith((".ttf", ".otf", ".ttc")) and name not in seen:
                    seen[name] = os.path.join(root, name)
    return [DEFAULT_FONT, *sorted(seen, key=str.lower)]


def _find_font(name: str) -> str | None:
    for d in font_dirs():
        if not os.path.isdir(d):
            continue
        for root, _dirs, files in os.walk(d):
            if name in files:
                return os.path.join(root, name)
    return None


_DEFAULT_CANDIDATES = (
    "segoeui.ttf",
    "arial.ttf",
    "DejaVuSans.ttf",
    "Arial.ttf",
    "NotoSans-Regular.ttf",
    "LiberationSans-Regular.ttf",
)

_FONT_CACHE: dict[tuple[str, int], Any] = {}


def load_font(name: str, size: int) -> Any:
    """A font at ``size`` px. Unknown names (a workflow from another machine)
    fall back to Pillow's built-in font."""
    key = (name, size)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    font: Any = None
    if name and name != DEFAULT_FONT:
        path = _find_font(name)
        if path:
            try:
                font = ImageFont.truetype(path, size)
            except OSError:
                font = None
    if font is None:
        # "default": a common Unicode font when the system has one, so labels
        # like "×" or accents render; Pillow's built-in Latin font otherwise.
        for fallback in _DEFAULT_CANDIDATES:
            path = _find_font(fallback)
            if path:
                try:
                    font = ImageFont.truetype(path, size)
                    break
                except OSError:
                    continue
    if font is None:
        try:
            font = ImageFont.load_default(size)
        except TypeError:  # Pillow < 10.1: one bitmap size only
            font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


def parse_color(value: str, fallback: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """``#rgb`` / ``#rrggbb`` / ``#rrggbbaa`` / a CSS name; ``""`` or ``none``
    is fully transparent."""
    text = (value or "").strip()
    if text.lower() in ("", "none", "transparent"):
        return (0, 0, 0, 0)
    try:
        rgba = ImageColor.getcolor(text, "RGBA")
    except ValueError:
        return fallback
    if isinstance(rgba, int):
        return (rgba, rgba, rgba, 255)
    return (rgba[0], rgba[1], rgba[2], rgba[3] if len(rgba) > 3 else 255)


# ── text layout ───────────────────────────────────────────────────────────


def _text_width(font: Any, text: str) -> float:
    return float(font.getlength(text))


def wrap(text: str, font: Any, width: float, max_lines: int) -> list[str]:
    """Greedy word wrap to ``width`` px; explicit newlines are kept. A word
    wider than the line is broken by characters. Past ``max_lines`` the last
    line ends with an ellipsis."""
    lines: list[str] = []
    for para in text.split("\n"):
        words = para.split(" ")
        line = ""
        for word in words:
            candidate = f"{line} {word}" if line else word
            fits = _text_width(font, candidate) <= width
            if fits or not line and _text_width(font, word) <= width:
                line = candidate
                continue
            if line:
                lines.append(line)
            line = ""
            while _text_width(font, word) > width and len(word) > 1:
                cut = len(word)
                while cut > 1 and _text_width(font, word[:cut]) > width:
                    cut -= 1
                lines.append(word[:cut])
                word = word[cut:]
            line = word
        lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and _text_width(font, last + "…") > width:
            last = last[:-1]
        lines[-1] = last.rstrip() + "…"
    return lines


def line_height(font: Any) -> int:
    ascent, descent = font.getmetrics()
    return int(round((ascent + descent) * 1.15))


def text_block_height(lines: list[str], font: Any) -> int:
    return line_height(font) * len(lines) if lines else 0


def draw_lines(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    font: Any,
    box: tuple[int, int, int, int],
    color: tuple[int, int, int, int],
    align: str = "center",
    valign: str = "center",
) -> None:
    """Draw wrapped lines inside ``box`` (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = box
    lh = line_height(font)
    total = lh * len(lines)
    if valign == "top":
        y = y0
    elif valign == "bottom":
        y = y1 - total
    else:
        y = y0 + (y1 - y0 - total) / 2
    for ln in lines:
        w = _text_width(font, ln)
        if align == "left":
            x = x0
        elif align == "right":
            x = x1 - w
        else:
            x = x0 + (x1 - x0 - w) / 2
        draw.text((x, y), ln, font=font, fill=color)
        y += lh


# ── style ─────────────────────────────────────────────────────────────────


@dataclass
class Style:
    position: str = "top"
    align: str = "center"
    font: str = DEFAULT_FONT
    #: 0 = automatic (a share of the image width).
    font_size: int = 0
    text_color: str = "#ffffff"
    label_color: str = "#000000"
    background: str = "#ffffff"
    header_color: str = "#000000"
    gap: int = 8
    margin: int = 0
    #: 0 = keep each image's size; otherwise every cell is scaled to this width.
    cell_width: int = 0

    def auto_size(self, width: int) -> int:
        if self.font_size > 0:
            return self.font_size
        return max(12, int(round(width * 0.045)))


@dataclass
class GridSpec:
    arrange: str = "rows"
    columns: int = 0
    title: str = ""
    column_headers: list[str] = field(default_factory=list)
    row_headers: list[str] = field(default_factory=list)
    #: Label part (from 1, negative from the end) that sets each cell's column
    #: / row; 0 = not used.
    column_part: int = 0
    row_part: int = 0


# ── single image ──────────────────────────────────────────────────────────


def _padding(size: int) -> int:
    return max(4, size // 3)


def label_image(img: Image.Image, text: str, style: Style, strip: int | None = None) -> Image.Image:
    """``img`` with ``text`` drawn on a strip beside it (top / bottom / left /
    right) or on a band over it. ``strip`` forces the strip's size so a batch
    keeps one shape; ``None`` fits the text. No text and no forced strip → the
    image unchanged."""
    if style.position == "none" or (not text and not strip):
        return img
    w, h = img.size
    size = style.auto_size(w)
    font = load_font(style.font, size)
    pad = _padding(size)
    fg = parse_color(style.text_color, (255, 255, 255, 255))
    bg = parse_color(style.label_color, (0, 0, 0, 255))
    pos = style.position
    if pos in ("left", "right"):
        side = strip or label_strip_size(text, w, h, style)
        out = Image.new("RGB", (w + side, h), _rgb(bg, style.background))
        out.paste(img, (side if pos == "left" else 0, 0))
        lines = wrap(text, font, side - 2 * pad, MAX_LABEL_LINES * 3)
        x0 = 0 if pos == "left" else w
        draw_lines(
            ImageDraw.Draw(out),
            lines,
            font,
            (x0 + pad, pad, x0 + side - pad, h - pad),
            fg,
            style.align,
        )
        return out
    lines = wrap(text, font, w - 2 * pad, MAX_LABEL_LINES)
    band = strip or label_strip_size(text, w, h, style)
    if pos in ("top", "bottom"):
        out = Image.new("RGB", (w, h + band), _rgb(bg, style.background))
        out.paste(img, (0, band if pos == "top" else 0))
        y0 = 0 if pos == "top" else h
        draw_lines(ImageDraw.Draw(out), lines, font, (pad, y0, w - pad, y0 + band), fg, style.align)
        return out
    # Over the image: a (possibly translucent) band.
    out = img.convert("RGBA")
    if not text:
        return img
    overlay = Image.new("RGBA", out.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    y0 = 0 if pos == "over_top" else h - band
    draw.rectangle((0, y0, w, y0 + band), fill=bg)
    draw_lines(draw, lines, font, (pad, y0, w - pad, y0 + band), fg, style.align)
    return Image.alpha_composite(out, overlay).convert("RGB")


def label_strip_size(text: str, w: int, h: int, style: Style) -> int:
    """The strip a label needs: its height (top / bottom / over) or width
    (left / right)."""
    if style.position == "none" or not text:
        return 0
    size = style.auto_size(w)
    font = load_font(style.font, size)
    pad = _padding(size)
    if style.position in ("left", "right"):
        longest = max((_text_width(font, ln) for ln in text.split("\n")), default=0)
        return int(min(longest + 2 * pad + 1, max(w * 0.6, 4 * size)))
    lines = wrap(text, font, w - 2 * pad, MAX_LABEL_LINES)
    return text_block_height(lines, font) + 2 * pad


def label_batch(images: list[Image.Image], texts: list[str], style: Style) -> list[Image.Image]:
    """Label every image of one batch with ONE strip size so the batch keeps
    one shape."""
    if not images:
        return []
    w, h = images[0].size
    strip = max((label_strip_size(t, w, h, style) for t in texts), default=0)
    if strip == 0:
        return list(images)
    return [label_image(img, t, style, strip) for img, t in zip(images, texts, strict=False)]


def _rgb(color: tuple[int, int, int, int], background: str) -> tuple[int, int, int]:
    """An RGBA strip colour flattened onto the background (strips are opaque
    once they sit outside the image)."""
    if color[3] == 255:
        return color[:3]
    base = parse_color(background, (255, 255, 255, 255))
    a = color[3] / 255
    return tuple(int(round(c * a + b * (1 - a))) for c, b in zip(color[:3], base[:3], strict=True))  # type: ignore[return-value]


# ── grid ──────────────────────────────────────────────────────────────────


@dataclass
class Cell:
    image: Image.Image
    label: str
    item: int
    index: int


def _scale(img: Image.Image, width: int) -> Image.Image:
    if width <= 0 or img.width == width:
        return img
    height = max(1, int(round(img.height * width / img.width)))
    return img.resize((width, height), Image.Resampling.LANCZOS)


Grid = list[list["Cell | None"]]


def arrange(cells: list[Cell], spec: GridSpec) -> tuple[Grid, list[str], list[str]]:
    """Place the cells: ``rows[r][c]``, plus the column and row headers.

    With a label part as a header, rows / columns are that part's distinct
    values in first-seen order (an XY plot); otherwise the arrange mode and the
    typed headers apply.
    """
    col_vals: list[str] = []
    row_vals: list[str] = []
    if spec.column_part or spec.row_part:
        for cell in cells:
            if spec.column_part:
                v = part(cell.label, spec.column_part)
                if v not in col_vals:
                    col_vals.append(v)
            if spec.row_part:
                v = part(cell.label, spec.row_part)
                if v not in row_vals:
                    row_vals.append(v)
    if spec.column_part and spec.row_part:
        spots: dict[tuple[int, int], list[Cell]] = {}
        for cell in cells:
            r = row_vals.index(part(cell.label, spec.row_part))
            c = col_vals.index(part(cell.label, spec.column_part))
            spots.setdefault((r, c), []).append(cell)
        # Several cells on one spot (same options, another seed): the row
        # repeats, once per extra cell, under the same header.
        grid: list[list[Cell | None]] = []
        heads: list[str] = []
        for r, value in enumerate(row_vals):
            depth = max((len(spots.get((r, c), [])) for c in range(len(col_vals))), default=1)
            for k in range(max(1, depth)):
                grid.append(
                    [
                        spots[(r, c)][k] if k < len(spots.get((r, c), [])) else None
                        for c in range(len(col_vals))
                    ]
                )
                heads.append(value)
        return grid, col_vals, heads
    if spec.column_part:
        grid = _group(cells, col_vals, lambda c: part(c.label, spec.column_part), by_column=True)
        return grid, col_vals, list(spec.row_headers)
    if spec.row_part:
        grid = _group(cells, row_vals, lambda c: part(c.label, spec.row_part), by_column=False)
        return grid, list(spec.column_headers), row_vals

    items = sorted({c.item for c in cells})
    mode = spec.arrange
    if mode == "auto":
        mode = auto_arrange([sum(1 for c in cells if c.item == it) for it in items])
    if mode == "strip":
        return [list(cells)], list(spec.column_headers), list(spec.row_headers)
    if mode == "stack":
        return [[c] for c in cells], list(spec.column_headers), list(spec.row_headers)
    if mode == "fill" or len(items) == 1 and spec.columns > 0:
        cols = spec.columns if spec.columns > 0 else _auto_columns(len(cells))
        grid = [list(cells[i : i + cols]) for i in range(0, len(cells), cols)]
        _pad_rows(grid)
        return grid, list(spec.column_headers), list(spec.row_headers)
    if len(items) == 1:
        # One batch, no column count: a near-square grid.
        cols = _auto_columns(len(cells))
        grid = [list(cells[i : i + cols]) for i in range(0, len(cells), cols)]
        _pad_rows(grid)
        return grid, list(spec.column_headers), list(spec.row_headers)
    per_item = [[c for c in cells if c.item == it] for it in items]
    grid = [list(r) for r in per_item]
    _pad_rows(grid)
    if mode == "columns":
        grid = [list(col) for col in zip(*grid, strict=True)]
    return grid, list(spec.column_headers), list(spec.row_headers)


def _group(cells: list[Cell], keys: list[str], key: Any, by_column: bool) -> Grid:
    lanes: list[list[Cell]] = [[] for _ in keys]
    for cell in cells:
        lanes[keys.index(key(cell))].append(cell)
    depth = max((len(lane) for lane in lanes), default=0)
    padded: list[list[Cell | None]] = [[*lane, *([None] * (depth - len(lane)))] for lane in lanes]
    if by_column:
        return [list(row) for row in zip(*padded, strict=True)] if padded else []
    return padded


def _pad_rows(grid: list[list[Any]]) -> None:
    width = max((len(r) for r in grid), default=0)
    for row in grid:
        row.extend([None] * (width - len(row)))


def _auto_columns(n: int) -> int:
    cols = 1
    while cols * cols < n:
        cols += 1
    return cols


def build_grid(cells: list[Cell], style: Style, spec: GridSpec) -> Image.Image:
    """The grid image: optional title, column headers on top, row headers on
    the left, every cell labelled per ``style`` (labels without the parts
    lifted into headers)."""
    if not cells:
        raise ValueError("no images to lay out")
    lifted = [p for p in (spec.column_part, spec.row_part) if p]
    scaled = [
        Cell(_scale(c.image.convert("RGB"), style.cell_width), c.label, c.item, c.index)
        for c in cells
    ]
    grid, col_heads, row_heads = arrange(scaled, spec)
    rows, cols = len(grid), max((len(r) for r in grid), default=0)

    cw = max(c.image.width for c in scaled)
    ch = max(c.image.height for c in scaled)
    labels = {id(c): drop_parts(c.label, lifted) if lifted else c.label for c in scaled}
    strip = max((label_strip_size(labels[id(c)], cw, ch, style) for c in scaled), default=0)
    side = style.position in ("left", "right")
    cell_w = cw + (strip if side else 0)
    cell_h = ch + (strip if style.position in ("top", "bottom") else 0)

    hsize = style.auto_size(cw)
    hfont = load_font(style.font, int(round(hsize * 1.25)))
    hpad = _padding(hsize)
    col_lines = [wrap(t, hfont, cell_w - 2 * hpad, MAX_HEADER_LINES) for t in col_heads[:cols]]
    top = max((text_block_height(ls, hfont) for ls in col_lines), default=0)
    top = top + 2 * hpad if any(col_heads[:cols]) else 0
    rh = [t for t in row_heads[:rows]]
    left = 0
    if any(rh):
        longest = max((_text_width(hfont, ln) for t in rh for ln in t.split("\n")), default=0)
        left = int(min(longest + 2 * hpad + 1, max(cell_w, 6 * hsize)))
    row_lines = [wrap(t, hfont, left - 2 * hpad, MAX_HEADER_LINES * 2) for t in rh] if left else []

    tfont = load_font(style.font, int(round(hsize * 1.6)))
    gap, m = max(0, style.gap), max(0, style.margin)
    body_w = left + cols * cell_w + (cols - 1) * gap
    title_lines = wrap(spec.title, tfont, body_w - 2 * hpad, 3) if spec.title.strip() else []
    title_h = text_block_height(title_lines, tfont) + 2 * hpad if title_lines else 0

    width = 2 * m + body_w
    height = 2 * m + title_h + top + rows * cell_h + (rows - 1) * gap
    bg = parse_color(style.background, (255, 255, 255, 255))
    fill = bg[:3] if bg[3] else (255, 255, 255)
    out = Image.new("RGB", (width, height), fill)
    draw = ImageDraw.Draw(out)
    hc = parse_color(style.header_color, (0, 0, 0, 255))
    if title_lines:
        draw_lines(draw, title_lines, tfont, (m + hpad, m, width - m - hpad, m + title_h), hc)
    y_body = m + title_h + top
    x_body = m + left
    for c, lines in enumerate(col_lines):
        x = x_body + c * (cell_w + gap)
        draw_lines(
            draw,
            lines,
            hfont,
            (x + hpad, m + title_h, x + cell_w - hpad, y_body),
            hc,
            valign="center",
        )
    for r, lines in enumerate(row_lines):
        y = y_body + r * (cell_h + gap)
        draw_lines(draw, lines, hfont, (m + hpad, y, x_body - hpad, y + cell_h), hc, align="right")
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            if cell is None:
                continue
            img = cell.image
            framed = Image.new("RGB", (cw, ch), fill)
            framed.paste(img, ((cw - img.width) // 2, (ch - img.height) // 2))
            tile = label_image(framed, labels[id(cell)], style, strip or None) if strip else framed
            out.paste(tile, (x_body + c * (cell_w + gap), y_body + r * (cell_h + gap)))
    longest_side = max(out.size)
    if longest_side > MAX_GRID_SIDE:
        k = MAX_GRID_SIDE / longest_side
        out = out.resize(
            (max(1, int(out.width * k)), max(1, int(out.height * k))), Image.Resampling.LANCZOS
        )
    return out
