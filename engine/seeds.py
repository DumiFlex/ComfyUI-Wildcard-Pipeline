"""Seed rows for WP_Seeds — pure logic, no ComfyUI imports.

The node's widget stores one JSON value (``SeedsConfig``)::

    {"version": 1, "rows": [...], "base_from_loop": true}

Each row is a label (``{"id", "kind": "label", "name", "color"}``) or a seed::

    {"id": "1a2b3c4d", "kind": "seed", "name": "Direction",
     "mode": "follow" | "random" | "fixed", "value": 42,
     "per_frame": "new" | "same", "pin": true, "out": 1,
     "color": "", "locks": {"2": 903551207}}

* ``follow``: the row's base seed is made from the node's base seed and the
  row's NAME (:func:`named_seed`), so rerolling the base seed moves every
  follow row, and adding or reordering rows never moves another row.
* ``base_from_loop``: the node's base seed is the upstream Context Loop's
  ``seed`` (``__wp_loop_seed__["base"]``) instead of its own widget, like
  WP Seed List's "base seed from Loop". Without a Loop the widget is used.
* ``random`` / ``fixed``: the base is the row's own ``value``. The canvas
  rerolls a random row's value after each queue (like ComfyUI's
  control_after_generate); the run itself just reads the value.
* ``per_frame``: inside a Context Loop the node runs once per frame. ``new``
  gives every frame its own seed (:func:`frame_seed`; frame 0 is the base),
  ``same`` uses the base on every frame.
* ``locks``: frame index (0-based, the Loop's original index) → a pinned seed.

A pinned row (``pin``) has an INT output; ``out`` is its slot (1-based, slot 0
is the context). Every row files its seed per frame in the context internals
under :data:`ROWS_KEY` (``{name_key: {"seed", "frame0"}}``), which a WP Context
set to "Seed from: <row>" reads.

Mirrored in TS at ``src/extension/seeds.ts`` via the shared
``tests/fixtures/seeds-corpus.json``. Keep the two in step.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from engine import seed_derive
from engine.seed_derive import MAX_SAFE_SEED

#: INT outputs the node declares. Never lower it: a saved workflow may link
#: any slot up to it.
MAX_OUTPUTS = 16
#: Cross-node internal: {row name key: {"seed": this frame, "frame0": frame 0}}.
ROWS_KEY = seed_derive.ROWS_KEY
MODES = ("follow", "random", "fixed")
PER_FRAME = ("new", "same")


def name_key(name: str) -> str:
    """How a row name is matched: trimmed, case-folded."""
    return " ".join(str(name).split()).casefold()


def _hash(text: str) -> int:
    digest = hashlib.sha256(text.encode()).digest()
    return int.from_bytes(digest[:8], "big") & MAX_SAFE_SEED


def named_seed(base: int, name: str) -> int:
    """A follow row's base: stable per (node base seed, row name)."""
    return _hash(f"seeds:{int(base) & MAX_SAFE_SEED}:{name_key(name)}")


def frame_seed(base: int, index: int) -> int:
    """Frame ``index``'s seed for a row whose frame-0 seed is ``base``."""
    if index <= 0:
        return int(base) & MAX_SAFE_SEED
    return _hash(f"{int(base) & MAX_SAFE_SEED}:{int(index)}")


@dataclass
class SeedRow:
    id: str
    name: str
    mode: str = "follow"
    value: int = 0
    per_frame: str = "new"
    pin: bool = False
    out: int | None = None
    locks: dict[int, int] = field(default_factory=dict)


@dataclass
class SeedsConfig:
    rows: list[SeedRow] = field(default_factory=list)
    base_from_loop: bool = False


def _int(v: Any, default: int = 0) -> int:
    if isinstance(v, bool):
        return default
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str):
        try:
            return int(v.strip())
        except ValueError:
            return default
    return default


def parse_config(raw: Any) -> SeedsConfig:
    """Decode the widget value. Never raises: anything malformed is dropped."""
    data: Any = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw) if raw.strip() else {}
        except (TypeError, ValueError):
            data = {}
    if not isinstance(data, dict):
        return SeedsConfig()
    rows: list[SeedRow] = []
    raw_rows = data.get("rows")
    for r in raw_rows if isinstance(raw_rows, list) else []:
        if not isinstance(r, dict) or r.get("kind", "seed") != "seed":
            continue
        name = r.get("name")
        if not isinstance(name, str) or not name_key(name):
            continue
        mode = str(r["mode"]) if r.get("mode") in MODES else "follow"
        per_frame = str(r["per_frame"]) if r.get("per_frame") in PER_FRAME else "new"
        out = r.get("out")
        locks: dict[int, int] = {}
        raw_locks = r.get("locks")
        if isinstance(raw_locks, dict):
            for k, v in raw_locks.items():
                idx, seed = _int(k, -1), _int(v, -1)
                if idx >= 0 and seed >= 0:
                    locks[idx] = seed & MAX_SAFE_SEED
        rows.append(SeedRow(
            id=str(r.get("id") or ""),
            name=name.strip(),
            mode=mode,
            value=max(0, _int(r.get("value"))) & MAX_SAFE_SEED,
            per_frame=per_frame,
            pin=r.get("pin") is True,
            out=out if isinstance(out, int) and not isinstance(out, bool) and out >= 1 else None,
            locks=locks,
        ))
    return SeedsConfig(rows=rows, base_from_loop=data.get("base_from_loop") is True)


def node_base(cfg: SeedsConfig, widget: int, internals: dict[str, Any]) -> int:
    """The base seed the rows use: the Loop's seed when ``base_from_loop`` is
    on and a Loop is upstream, else the node's own ``base_seed`` widget."""
    if cfg.base_from_loop:
        loop = internals.get(seed_derive.LOOP_SEED_KEY)
        if isinstance(loop, dict):
            b = loop.get("base")
            if isinstance(b, int) and not isinstance(b, bool) and b >= 0:
                return b & MAX_SAFE_SEED
    return int(widget) & MAX_SAFE_SEED


def row_base(row: SeedRow, base: int) -> int:
    """The row's seed before frames and locks."""
    if row.mode == "follow":
        return named_seed(base, row.name)
    return row.value & MAX_SAFE_SEED


def row_seed(row: SeedRow, base: int, index: int) -> int:
    """The row's seed on frame ``index`` (a lock wins)."""
    if index in row.locks:
        return row.locks[index]
    start = row_base(row, base)
    if row.per_frame == "same":
        return start
    return frame_seed(start, index)


def resolve(cfg: SeedsConfig, base: int, index: int) -> dict[str, dict[str, int]]:
    """``{name_key: {"seed", "frame0"}}`` for every row. A name two rows share
    keeps the first."""
    out: dict[str, dict[str, int]] = {}
    for row in cfg.rows:
        key = name_key(row.name)
        if key in out:
            continue
        out[key] = {"seed": row_seed(row, base, index), "frame0": row_seed(row, base, 0)}
    return out


def output_values(cfg: SeedsConfig, base: int, index: int) -> list[int]:
    """The INT outputs, slot 1 first, padded to :data:`MAX_OUTPUTS`.

    A pinned row goes to its ``out`` slot; one without a free ``out`` takes the
    next free slot in row order (the frontend keeps ``out`` unique)."""
    vals: list[int] = [0] * MAX_OUTPUTS
    taken: set[int] = set()
    pinned = [r for r in cfg.rows if r.pin]
    later: list[SeedRow] = []
    for r in pinned:
        if r.out is not None and r.out <= MAX_OUTPUTS and r.out not in taken:
            taken.add(r.out)
            vals[r.out - 1] = row_seed(r, base, index)
        else:
            later.append(r)
    free = (s for s in range(1, MAX_OUTPUTS + 1) if s not in taken)
    for r in later:
        slot = next(free, None)
        if slot is None:
            break
        vals[slot - 1] = row_seed(r, base, index)
    return vals
