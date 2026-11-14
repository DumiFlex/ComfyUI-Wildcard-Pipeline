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
from dataclasses import dataclass, field, replace
from typing import Any

from PIL import Image, ImageColor, ImageDraw, ImageFont

PART_SEP = " · "

POSITIONS = (
    "top",
    "bottom",
    "left",
    "right",
    "over_top",
    "over_bottom",
    "over_left",
    "over_right",
    "none",
)
ALIGNS = ("center", "left", "right")
#: Text on a left / right label: across, or turned to run along the edge
#: (reading upwards on the left, downwards on the right, like book spines).
ORIENTATIONS = ("horizontal", "vertical")
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
    A single entry for several items is spread over their images in order
    (typed text, one line per image), and a single one-line entry labels every
    image of every item.
    """
    return _fit_labels(labels, batch_sizes)[0]


def label_fit(labels: list[Any] | None, batch_sizes: list[int]) -> tuple[int, int]:
    """``(missing, extra)``: images the label lines left without one, and
    lines no image took. Both 0 when nothing is wired, or a line covers a
    whole item."""
    _out, missing, extra = _fit_labels(labels, batch_sizes)
    return missing, extra


def _lines(raw: Any) -> list[str]:
    text = raw if isinstance(raw, str) else ("" if raw is None else str(raw))
    return [ln.strip() for ln in text.splitlines()] if text.strip() else []


def _fit_labels(
    labels: list[Any] | None, batch_sizes: list[int]
) -> tuple[list[list[str]], int, int]:
    if labels is None or not any(_lines(raw) for raw in labels):
        return [[""] * size for size in batch_sizes], 0, 0
    out: list[list[str]] = []
    if len(labels) == 1 and len(batch_sizes) > 1:
        # One text for several items (a typed list, one line per image):
        # spread its lines over every image in order.
        lines = _lines(labels[0])
        if len(lines) == 1:
            return [[lines[0]] * size for size in batch_sizes], 0, 0
        total = sum(batch_sizes)
        for size in batch_sizes:
            out.append([*lines[:size], *([""] * max(0, size - len(lines)))])
            lines = lines[size:]
        taken = sum(1 for item in out for lab in item if lab)
        return out, max(0, total - len(_lines(labels[0]))), len(lines) if taken else 0
    missing = extra = 0
    for i, size in enumerate(batch_sizes):
        lines = _lines(labels[i]) if i < len(labels) else []
        if len(lines) == 1:
            out.append([lines[0]] * size)
            continue
        out.append([lines[j] if j < len(lines) else "" for j in range(size)])
        missing += max(0, size - len(lines))
        extra += max(0, len(lines) - size)
    for raw in labels[len(batch_sizes) :]:
        extra += len(_lines(raw))
    return out, missing, extra


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
    "orientation": "horizontal",
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
    for key, allowed in (
        ("position", POSITIONS),
        ("align", ALIGNS),
        ("orientation", ORIENTATIONS),
        ("arrange", ARRANGE),
    ):
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
    #: Left / right labels only: ``horizontal`` or ``vertical`` (turned).
    orientation: str = "horizontal"
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

    @property
    def edge(self) -> str:
        """The side the label sits on, over the image or beside it."""
        return self.position[5:] if self.position.startswith("over_") else self.position

    @property
    def over(self) -> bool:
        return self.position.startswith("over_")

    @property
    def vertical(self) -> bool:
        return self.orientation == "vertical" and self.edge in ("left", "right")

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


def _panel(
    text: str,
    length: int,
    thickness: int,
    style: Style,
    font: Any,
    pad: int,
    fill: tuple[int, int, int, int],
    across: bool,
) -> Image.Image:
    """The label's text on a ``length`` × ``thickness`` RGBA panel. ``across``
    lays it out for a left / right strip (lines as wide as the strip, centred
    top to bottom); otherwise it runs along the panel like a top strip."""
    fg = parse_color(style.text_color, (255, 255, 255, 255))
    if across:
        size = (thickness, length)
        lines = wrap(text, font, thickness - 2 * pad, MAX_LABEL_LINES * 3)
        box = (pad, pad, thickness - pad, length - pad)
    else:
        size = (length, thickness)
        lines = wrap(text, font, length - 2 * pad, MAX_LABEL_LINES)
        box = (pad, 0, length - pad, thickness)
    panel = Image.new("RGBA", size, fill)
    if text:
        draw_lines(ImageDraw.Draw(panel), lines, font, box, fg, style.align)
    return panel


def label_image(img: Image.Image, text: str, style: Style, strip: int | None = None) -> Image.Image:
    """``img`` with ``text`` drawn on a strip beside it (top / bottom / left /
    right) or on a band over one of its edges. Left / right labels can run
    turned along the edge (``style.orientation = vertical``: upwards on the
    left, downwards on the right). ``strip`` forces the strip's size so a
    batch keeps one shape; ``None`` fits the text. No text and no forced strip
    → the image unchanged."""
    if style.position == "none" or (not text and not strip):
        return img
    if style.over and not text:
        return img
    w, h = img.size
    size = style.auto_size(w)
    font = load_font(style.font, size)
    pad = _padding(size)
    bg = parse_color(style.label_color, (0, 0, 0, 255))
    edge = style.edge
    side = edge in ("left", "right")
    band = strip or label_strip_size(text, w, h, style)
    fill = bg if style.over else (*_rgb(bg, style.background), 255)
    if side and style.vertical:
        panel = _panel(text, h, band, style, font, pad, fill, across=False)
        # Turned so the text reads upwards on the left, downwards on the right.
        panel = panel.rotate(90 if edge == "left" else -90, expand=True)
    else:
        panel = _panel(text, h if side else w, band, style, font, pad, fill, across=side)
    if style.over:
        out = img.convert("RGBA")
        x = w - panel.width if edge == "right" else 0
        y = h - panel.height if edge == "bottom" else 0
        overlay = Image.new("RGBA", out.size, (0, 0, 0, 0))
        overlay.paste(panel, (x, y))
        return Image.alpha_composite(out, overlay).convert("RGB")
    if side:
        out = Image.new("RGB", (w + panel.width, h))
        out.paste(img, (panel.width if edge == "left" else 0, 0))
        out.paste(panel.convert("RGB"), (0 if edge == "left" else w, 0))
        return out
    out = Image.new("RGB", (w, h + panel.height))
    out.paste(img, (0, panel.height if edge == "top" else 0))
    out.paste(panel.convert("RGB"), (0, 0 if edge == "top" else h))
    return out


def label_strip_size(text: str, w: int, h: int, style: Style) -> int:
    """The strip a label needs: its height (top / bottom), its width (left /
    right) or its thickness when turned."""
    if style.position == "none" or not text:
        return 0
    size = style.auto_size(w)
    font = load_font(style.font, size)
    pad = _padding(size)
    if style.vertical:
        lines = wrap(text, font, h - 2 * pad, MAX_LABEL_LINES)
        return text_block_height(lines, font) + 2 * pad
    if style.edge in ("left", "right"):
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


#: The header of the row / column that gathers images whose label lacks the
#: part an XY plot sorts by (fewer label lines than images, a typo).
NO_LABEL = "(no label)"


def arrange(cells: list[Cell], spec: GridSpec) -> tuple[Grid, list[str], list[str]]:
    """Place the cells: ``rows[r][c]``, plus the column and row headers.

    With a label part as a header, rows / columns are that part's distinct
    values in first-seen order (an XY plot); otherwise the arrange mode and the
    typed headers apply. An image whose label lacks the part goes to a last
    row / column headed ``NO_LABEL``; one lacking both parts of an XY plot goes
    to ``NO_LABEL`` rows at the bottom, filling the columns from the left.
    """

    def key(cell: Cell, index: int) -> str:
        return part(cell.label, index) if index else ""

    col_vals: list[str] = []
    row_vals: list[str] = []
    for cell in cells:
        if spec.column_part:
            v = key(cell, spec.column_part)
            if v and v not in col_vals:
                col_vals.append(v)
        if spec.row_part:
            v = key(cell, spec.row_part)
            if v and v not in row_vals:
                row_vals.append(v)
    if spec.column_part and spec.row_part and (row_vals or col_vals):
        loose = [c for c in cells if not key(c, spec.row_part) and not key(c, spec.column_part)]
        gone = {id(c) for c in loose}
        placed = [c for c in cells if id(c) not in gone]
        if any(not key(c, spec.column_part) for c in placed) or not col_vals:
            col_vals.append(NO_LABEL)
        if any(not key(c, spec.row_part) for c in placed):
            row_vals.append(NO_LABEL)
        spots: dict[tuple[int, int], list[Cell]] = {}
        for cell in placed:
            r = row_vals.index(key(cell, spec.row_part) or NO_LABEL)
            c = col_vals.index(key(cell, spec.column_part) or NO_LABEL)
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
        width = len(col_vals)
        for i in range(0, len(loose), width):
            row: list[Cell | None] = list(loose[i : i + width])
            grid.append([*row, *([None] * (width - len(row)))])
            heads.append(NO_LABEL)
        return grid, col_vals, heads
    if spec.column_part and col_vals and not spec.row_part:
        if any(not key(c, spec.column_part) for c in cells):
            col_vals.append(NO_LABEL)
        grid = _group(
            cells, col_vals, lambda c: key(c, spec.column_part) or NO_LABEL, by_column=True
        )
        return grid, col_vals, list(spec.row_headers)
    if spec.row_part and row_vals and not spec.column_part:
        if any(not key(c, spec.row_part) for c in cells):
            row_vals.append(NO_LABEL)
        grid = _group(cells, row_vals, lambda c: key(c, spec.row_part) or NO_LABEL, by_column=False)
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


def grid_fit(cells: list[Cell], spec: GridSpec) -> dict[str, Any]:
    """How the run fits the grid's headers, for the node's warning line:
    ``rows`` / ``columns`` = ``[headers typed, lanes]`` when typed headers are
    used and their count differs, ``no_label`` = images an XY plot could not
    sort by their label."""
    grid, col_heads, row_heads = arrange(cells, spec)
    out: dict[str, Any] = {}
    rows, cols = len(grid), max((len(r) for r in grid), default=0)
    if spec.row_headers and not spec.row_part and len(spec.row_headers) != rows:
        out["rows"] = [len(spec.row_headers), rows]
    if spec.column_headers and not spec.column_part and len(spec.column_headers) != cols:
        out["columns"] = [len(spec.column_headers), cols]
    if spec.row_part or spec.column_part:
        lost = 0
        for r, row in enumerate(grid):
            for c, cell in enumerate(row):
                if cell is None:
                    continue
                if (spec.row_part and r < len(row_heads) and row_heads[r] == NO_LABEL) or (
                    spec.column_part and c < len(col_heads) and col_heads[c] == NO_LABEL
                ):
                    lost += 1
        if lost:
            out["no_label"] = lost
    return out


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
            (x + hpad, m + title_h, x + cell_w - hpad, y_body - hpad),
            hc,
            # Sat on the cells, so a header that wraps to two lines still
            # lines up with its one-line neighbours.
            valign="bottom",
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
            text = labels[id(cell)]
            # A cell with no label keeps the strip (one cell shape) in the
            # grid's background, not as an empty label box.
            blank = replace(style, label_color=style.background) if not text else style
            tile = label_image(framed, text, blank, strip or None) if strip else framed
            out.paste(tile, (x_body + c * (cell_w + gap), y_body + r * (cell_h + gap)))
    longest_side = max(out.size)
    if longest_side > MAX_GRID_SIDE:
        k = MAX_GRID_SIDE / longest_side
        out = out.resize(
            (max(1, int(out.width * k)), max(1, int(out.height * k))), Image.Resampling.LANCZOS
        )
    return out
