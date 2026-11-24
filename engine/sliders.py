"""Slider resolution for WP_Slider — pure logic, no ComfyUI imports.

The node's widget stores one JSON value (``SlidersConfig``):

``{"version": 1, "rows": [...]}``

Each row is a label (``{"id", "kind": "label", "name", "color", "collapsed"}``)
or a slider::

    {"id": "1a2b3c4d", "kind": "slider", "name": "Camera distance",
     "var": "shot", "value": 0.45, "min": 0, "max": 1, "step": 0.05,
     "decimals": 2, "mode": "words", "text": "", "negative": "",
     "words": [{"upto": 0.3, "word": "close-up"},
               {"upto": 0.7, "word": "medium shot"},
               {"word": "wide shot", "negative": "cropped"}],
     "pin": true, "out": 1, "style": "row", "internal": true}

What the variable holds (``mode``):

* ``number`` (default): the number as text, with ``decimals`` places
  (``"0.45"``, ``"28"``).
* ``text``: ``text``, which the node resolves, so it may read ``$vars`` and
  its own ``$name.num`` (``"(intricate details:$detail.num)"``).
* ``words``: the word of the first range whose ``upto`` is at least the
  value (a range without ``upto`` catches the rest; past every ``upto`` the
  last word wins). A ``text`` holding ``{word}`` wraps it: ``"{word}
  clothes"`` writes ``"green clothes"`` (the node resolves it like ``text``).

``off`` (stored only when set): ``"mute"`` writes nothing (no variable, no
``$name.num``, no negative); ``"bypass"`` writes the plain number, as
``number`` mode does, with no negative. The row's output still sends its
number. ``lock`` (stored only as ``true``) stops the value moving on the
canvas; the engine reads nothing from it.

``$name.num`` reads the number whatever the variable holds, from the
cross-node table :data:`NUMS_KEY` (like ``$name.bool`` for WP Toggles).

A slider's negative: the matched word's ``negative`` in ``words`` mode
(else the slider's own ``negative``), the slider's ``negative`` otherwise.

``internal`` (stored only as ``true``) keeps the variable out of the
Assembler's "every variable" listing, as WP Toggles' default does.

A pinned slider (``pin``) also has a number output; ``out`` is its output
slot (1-based, slot 0 is the context). The output is an INT when
``decimals`` is 0, else a FLOAT.

Mirrored in TS at ``src/extension/sliders.ts`` via the shared
``tests/fixtures/sliders-corpus.json``. Keep the two in step.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

#: Number outputs the node declares. Never lower it: a saved workflow may
#: link any slot up to it, and validation indexes RETURN_TYPES by slot.
MAX_OUTPUTS = 16
MODES = ("number", "text", "words")
OFF = ("mute", "bypass")
#: In ``words`` mode, where the picked word goes in the row's ``text``.
WORD_SLOT = "{word}"
STYLES = ("row", "bar", "fader")
MAX_DECIMALS = 6

VAR_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*$")

#: Cross-node internal: every slider variable's number as text, what
#: `$name.num` reads (a slider in text / words mode writes text, not the
#: number).
NUMS_KEY = "__wp_slider_nums__"


@dataclass
class Word:
    word: str
    upto: float | None = None
    negative: str = ""


@dataclass
class Slider:
    id: str
    name: str
    var: str
    value: float = 0.0
    min: float = 0.0
    max: float = 1.0
    step: float = 0.01
    decimals: int = 2
    mode: str = "number"
    text: str = ""
    negative: str = ""
    words: list[Word] = field(default_factory=list)
    pin: bool = False
    out: int = 0
    internal: bool = False
    #: ``"int"`` / ``"float"`` picks the output's type; empty follows the
    #: decimals (INT at 0, else FLOAT).
    out_type: str = ""
    #: ``"mute"`` / ``"bypass"`` (see the module doc); empty runs as set.
    off: str = ""

    @property
    def is_int(self) -> bool:
        return self.decimals == 0

    @property
    def outputs_int(self) -> bool:
        return self.out_type == "int" or (self.out_type != "float" and self.is_int)


@dataclass
class Config:
    sliders: list[Slider] = field(default_factory=list)


def _str(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _num(v: Any, default: float) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return default
    f = float(v)
    return f if math.isfinite(f) else default


def _words(raw: Any) -> list[Word]:
    out: list[Word] = []
    for w in raw if isinstance(raw, list) else []:
        if not isinstance(w, dict):
            continue
        upto = w.get("upto")
        word = w.get("word")
        neg = w.get("negative")
        has_upto = isinstance(upto, (int, float)) and not isinstance(upto, bool)
        out.append(Word(
            word=word if isinstance(word, str) else "",
            upto=_num(upto, 0.0) if has_upto else None,
            negative=neg.strip() if isinstance(neg, str) else "",
        ))
    return out


def parse_config(raw: Any) -> Config:
    """Widget JSON (string or dict) → :class:`Config`. Anything broken is
    dropped quietly; an unreadable value is an empty node."""
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw) if raw.strip() else {}
        except ValueError:
            data = {}
    if not isinstance(data, dict):
        data = {}
    sliders: list[Slider] = []
    rows = data.get("rows")
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or row.get("kind", "slider") != "slider":
            continue
        sid = _str(row.get("id"))
        if not sid:
            continue
        lo = _num(row.get("min"), 0.0)
        hi = _num(row.get("max"), 1.0)
        dec = row.get("decimals")
        decimals = dec if isinstance(dec, int) and not isinstance(dec, bool) else 2
        decimals = max(0, min(MAX_DECIMALS, decimals))
        mode = row.get("mode")
        out = row.get("out")
        text = row.get("text")
        negative = row.get("negative")
        step = _num(row.get("step"), 0.01)
        out_type = row.get("out_type")
        off = row.get("off")
        sliders.append(Slider(
            id=sid,
            name=_str(row.get("name")) or sid,
            var=_str(row.get("var")),
            value=_num(row.get("value"), lo),
            min=lo,
            max=hi,
            step=step if step > 0 else 0.01,
            decimals=decimals,
            mode=mode if isinstance(mode, str) and mode in MODES else "number",
            text=text if isinstance(text, str) else "",
            negative=negative.strip() if isinstance(negative, str) else "",
            words=_words(row.get("words")),
            pin=row.get("pin") is True,
            out=out if isinstance(out, int) and not isinstance(out, bool) else 0,
            internal=row.get("internal") is True,
            out_type=out_type if out_type in ("int", "float") else "",
            off=off if off in OFF else "",
        ))
    return Config(sliders=sliders)


def fmt(s: Slider) -> str:
    """The number as the variable writes it: fixed ``decimals`` places,
    rounded half away from zero on the exact binary value, which is what JS
    ``Number.toFixed`` does (the canvas preview must match)."""
    q = Decimal(1).scaleb(-s.decimals)
    out = str(Decimal(s.value).quantize(q, rounding=ROUND_HALF_UP))
    # No "-0" / "-0.00": a value that rounds to zero is plain zero.
    return out[1:] if out.startswith("-") and Decimal(out) == 0 else out


def number(s: Slider) -> int | float:
    """The slider's value rounded to its decimals (an int at 0 decimals)."""
    text = fmt(s)
    return int(text) if s.is_int else float(text)


def output_number(s: Slider) -> int | float:
    """What the slider's output sends: a whole number (rounded half away from
    zero, like ``toFixed(0)``) when it outputs an INT, else the number at its
    decimals as a float."""
    if s.outputs_int:
        return int(Decimal(s.value).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return float(fmt(s))


def word_for(s: Slider) -> Word | None:
    """``words`` mode: the range the value falls in (see the module doc)."""
    if not s.words:
        return None
    v = number(s)
    for w in s.words:
        if w.upto is None or v <= w.upto:
            return w
    return s.words[-1]


def _usable(s: Slider) -> bool:
    return bool(s.var) and bool(VAR_RE.match(s.var))


def _writes(s: Slider) -> bool:
    """Whether the row writes its variable at all (a muted row doesn't)."""
    return _usable(s) and s.off != "mute"


def word_text(s: Slider) -> str:
    """``words`` mode: what the variable holds, the picked word set into
    ``text`` where it says ``{word}`` (the word alone otherwise)."""
    w = word_for(s)
    word = w.word if w else fmt(s)
    return s.text.replace(WORD_SLOT, word) if WORD_SLOT in s.text else word


def resolve(cfg: Config) -> dict[str, str]:
    """Variable → what it holds, in row order (``text`` unresolved; the node
    resolves it). A later row with the same variable wins."""
    values: dict[str, str] = {}
    for s in cfg.sliders:
        if not _writes(s):
            continue
        if s.off == "bypass":
            values[s.var] = fmt(s)
        elif s.mode == "text":
            values[s.var] = s.text
        elif s.mode == "words":
            values[s.var] = word_text(s)
        else:
            values[s.var] = fmt(s)
    return values


def axes_and_phrase(cfg: Config, axes: int) -> Config:
    """WP Slider 2D / 3D: the first ``axes`` rows, plus the first later row
    in ``text`` mode (the pad's template, ``padConfig`` in TS)."""
    head = cfg.sliders[:axes]
    phrase = next((s for s in cfg.sliders[axes:] if s.mode == "text"), None)
    return Config(sliders=[*head, *([phrase] if phrase else [])])


def nums(cfg: Config) -> dict[str, str]:
    """Each slider variable's number as text (`$name.num`); a later row wins."""
    return {s.var: fmt(s) for s in cfg.sliders if _writes(s)}


def own_negatives(cfg: Config) -> dict[str, str]:
    """Slider variable → its negative (see the module doc), left out when
    empty. A later row writing the same variable decides."""
    out: dict[str, str] = {}
    for s in cfg.sliders:
        if not _writes(s):
            continue
        if s.off == "bypass":
            out.pop(s.var, None)
            continue
        text = s.negative
        if s.mode == "words":
            w = word_for(s)
            if w is not None and w.negative:
                text = w.negative
        if text.strip():
            out[s.var] = text.strip()
        else:
            out.pop(s.var, None)
    return out


def internal_vars(cfg: Config) -> set[str]:
    """Variables marked ``internal`` (the last row writing one decides)."""
    flags: dict[str, bool] = {}
    for s in cfg.sliders:
        if _usable(s):
            flags[s.var] = s.internal
    return {k for k, v in flags.items() if v}


def problems(cfg: Config) -> list[str]:
    """What the node warns about: bad or repeated variable names, an empty
    range. The canvas shows the same in the widget."""
    out: list[str] = []
    seen: dict[str, str] = {}
    for s in cfg.sliders:
        if s.max <= s.min:
            out.append(f'"{s.name}" has a max that is not above its min')
        if not s.var:
            continue
        if not VAR_RE.match(s.var):
            out.append(f'"{s.name}" has a variable name that can\'t be used: {s.var}')
            continue
        if s.var in seen:
            out.append(f'"{s.name}" and "{seen[s.var]}" both write ${s.var}; the lower one wins')
        else:
            seen[s.var] = s.name
    return out


def output_slots(cfg: Config) -> list[Slider]:
    """Pinned sliders in output order (slot 1, 2, …). Uses each row's ``out``
    when those are 1..N with no gaps or repeats, else row order."""
    pinned = [s for s in cfg.sliders if s.pin][:MAX_OUTPUTS]
    outs = sorted(s.out for s in pinned)
    if outs == list(range(1, len(pinned) + 1)):
        return sorted(pinned, key=lambda s: s.out)
    return pinned


def output_values(cfg: Config) -> list[int | float]:
    """The 16 number outputs: pinned sliders first, then ``0`` padding."""
    vals: list[int | float] = [output_number(s) for s in output_slots(cfg)]
    return vals + [0] * (MAX_OUTPUTS - len(vals))


def lookup_num(table: Any, own: Any, name: str) -> str | None:
    """`$name.num`: the slider table's number, else the variable's own value
    when it already is a number, else None."""
    got = table.get(name) if isinstance(table, dict) else None
    if isinstance(got, str) and got:
        return got
    if isinstance(own, str):
        text = own.strip()
        try:
            float(text)
        except ValueError:
            return None
        return text if text and math.isfinite(float(text)) else None
    return None
