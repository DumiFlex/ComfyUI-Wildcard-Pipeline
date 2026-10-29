"""Toggle resolution for WP_Toggles — pure logic, no ComfyUI imports.

The node's widget stores one JSON value (``TogglesConfig``):

``{"version": 1, "mode": "any" | "one", "group_var": str, "rows": [...]}``

Each row is a label (``{"id", "kind": "label", "name", "color", "collapsed"}``)
or a toggle::

    {"id": "1a2b3c4d", "kind": "toggle", "name": "LoRA character",
     "var": "use_lora_character", "on": true, "pin": true, "out": 1,
     "style": "switch", "on_label": "", "off_label": "", "needs": "",
     "upstream": true, "control": "bypass"}

* ``Any on``: a toggle is on when its own switch is on AND the toggle it
  ``needs`` is on (transitively). A loop in ``needs`` counts as off.
* ``Pick one``: one toggle is on; ``needs`` is ignored. Which one, first
  match wins: the toggle the upstream ``group_var`` names (by name or
  variable, any case; only with ``group_upstream``), then the first toggle
  upstream set to a yes word, then the first toggle whose switch is on.
  ``group_var`` (optional) gets the picked toggle's ``value`` (text that may
  read ``$vars``; the node resolves it) or else its name, ``""`` when none
  is on. It is internal unless ``group_visible``.

``upstream`` (optional, stored only as ``true``): when the upstream Context
holds the toggle's variable and its whole value is a yes/no word
(:data:`TRUTHY` / :data:`FALSY`, any case), that value replaces the switch
before ``needs`` / Pick one apply (:func:`with_upstream`). Anything else
leaves the switch alone.

``control`` / ``groups`` (mute or bypass other nodes) are frontend-only: the
canvas sets node modes when a toggle flips, and the run never sees them.

Every toggle writes ``"true"`` / ``"false"`` to its variable, always
internal. A pinned toggle (``pin``) also has a BOOLEAN output; ``out`` is its
output slot (1-based, slot 0 is the context). The frontend keeps ``out``
unique; :func:`output_values` falls back to row order when it isn't.

Mirrored in TS at ``src/extension/toggles.ts`` via the shared
``tests/fixtures/toggles-corpus.json``. Keep the two in step.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

#: BOOLEAN outputs the node declares. Never lower it: a saved workflow may
#: link any slot up to it, and validation indexes RETURN_TYPES by slot.
MAX_OUTPUTS = 16
MODES = ("any", "one")
STYLES = ("switch", "checkbox", "buttons", "chip")
TRUE = "true"
FALSE = "false"

VAR_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*$")
#: Words an upstream value may be to set an ``upstream`` toggle (the same
#: yes/no words as WP Var → Bool, but the whole value must be one).
TRUTHY = frozenset({"true", "yes", "on", "1"})
FALSY = frozenset({"false", "no", "off", "0"})


@dataclass
class Toggle:
    id: str
    name: str
    var: str
    on: bool
    pin: bool = False
    out: int = 0
    needs: str = ""
    upstream: bool = False
    value: str = ""


@dataclass
class Config:
    mode: str = "any"
    group_var: str = ""
    toggles: list[Toggle] = field(default_factory=list)
    group_visible: bool = False
    group_upstream: bool = False
    #: Set by :func:`with_upstream`: the toggle the upstream ``group_var``
    #: picked, and the toggles upstream set to a yes word (row order).
    forced: str = ""
    upstream_on: list[str] = field(default_factory=list)


def _str(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


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
    raw_mode = data.get("mode")
    mode = raw_mode if isinstance(raw_mode, str) and raw_mode in MODES else "any"
    toggles: list[Toggle] = []
    rows = data.get("rows")
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or row.get("kind", "toggle") != "toggle":
            continue
        tid = _str(row.get("id"))
        if not tid:
            continue
        out = row.get("out")
        value = row.get("value")
        toggles.append(Toggle(
            id=tid,
            name=_str(row.get("name")) or tid,
            var=_str(row.get("var")),
            on=row.get("on") is True,
            pin=row.get("pin") is True,
            out=out if isinstance(out, int) and not isinstance(out, bool) else 0,
            needs=_str(row.get("needs")),
            upstream=row.get("upstream") is True,
            value=value if isinstance(value, str) else "",
        ))
    return Config(
        mode=mode,
        group_var=_str(data.get("group_var")),
        toggles=toggles,
        group_visible=data.get("group_visible") is True,
        group_upstream=data.get("group_upstream") is True,
    )


def upstream_bool(value: Any) -> bool | None:
    """An upstream value as a switch position, or ``None`` when it isn't a
    lone yes/no word."""
    if isinstance(value, bool):
        return value
    if not isinstance(value, str):
        return None
    low = value.strip().lower()
    if low in TRUTHY:
        return True
    if low in FALSY:
        return False
    return None


def with_upstream(cfg: Config, upstream: dict[str, Any] | None) -> tuple[Config, list[str]]:
    """``cfg`` with each ``upstream`` toggle's switch set from ``upstream``
    where it holds a yes/no word for the toggle's variable. Returns the new
    config and the ids of the toggles it set."""
    if not upstream:
        return cfg, []
    set_ids: list[str] = []
    on_ids: list[str] = []
    toggles: list[Toggle] = []
    for t in cfg.toggles:
        val = upstream_bool(upstream.get(t.var)) if t.upstream and t.var else None
        if val is None:
            toggles.append(t)
            continue
        set_ids.append(t.id)
        if val:
            on_ids.append(t.id)
        toggles.append(Toggle(**{**t.__dict__, "on": val}))
    forced = ""
    named = upstream.get(cfg.group_var) if cfg.group_var else None
    if cfg.mode == "one" and cfg.group_upstream and isinstance(named, str) and named.strip():
        key = named.strip().lower()
        hit = next((t for t in toggles if key in (t.name.lower(), t.var.lower())), None)
        if hit is not None:
            forced = hit.id
            set_ids.append(hit.id)
    out = Config(**{**cfg.__dict__, "toggles": toggles, "forced": forced, "upstream_on": on_ids})
    return out, set_ids


def picked_id(cfg: Config) -> str | None:
    """Pick one: the toggle that is on (see the module docstring)."""
    ids = {t.id for t in cfg.toggles}
    if cfg.forced in ids:
        return cfg.forced
    first_up = next((i for i in cfg.upstream_on if i in ids), None)
    if first_up is not None:
        return first_up
    return next((t.id for t in cfg.toggles if t.on), None)


def effective(cfg: Config) -> dict[str, bool]:
    """Toggle id → whether it is on after ``needs`` / Pick one."""
    if cfg.mode == "one":
        return {t.id: t.id == picked_id(cfg) for t in cfg.toggles}
    by_id = {t.id: t for t in cfg.toggles}
    memo: dict[str, bool] = {}

    def eff(tid: str, seen: frozenset[str]) -> bool:
        if tid in memo:
            return memo[tid]
        t = by_id.get(tid)
        if t is None or tid in seen:
            return False  # missing parent or a loop: off
        val = t.on and (not t.needs or eff(t.needs, seen | {tid}))
        memo[tid] = val
        return val

    return {t.id: eff(t.id, frozenset()) for t in cfg.toggles}


def problems(cfg: Config) -> list[str]:
    """What the node warns about: bad or repeated variable names, a needs
    loop. The canvas shows the same in the widget."""
    out: list[str] = []
    seen: dict[str, str] = {}
    for t in cfg.toggles:
        if not t.var:
            continue
        if not VAR_RE.match(t.var):
            out.append(f'"{t.name}" has a variable name that can\'t be used: {t.var}')
            continue
        if t.var in seen:
            out.append(f'"{t.name}" and "{seen[t.var]}" both write ${t.var}; the lower one wins')
        else:
            seen[t.var] = t.name
    if cfg.group_var and not VAR_RE.match(cfg.group_var):
        out.append(f"The Pick one variable can't be used: {cfg.group_var}")
    if cfg.mode == "any":
        by_id = {t.id: t for t in cfg.toggles}
        for t in cfg.toggles:
            cur, seen_ids = t, {t.id}
            while cur.needs and cur.needs in by_id:
                if cur.needs in seen_ids:
                    out.append(f'"{t.name}" needs itself through a loop, so it stays off')
                    break
                seen_ids.add(cur.needs)
                cur = by_id[cur.needs]
    return out


def resolve(cfg: Config) -> dict[str, str]:
    """Variable → ``"true"`` / ``"false"`` (plus the Pick one variable), in
    row order. A later row with the same variable wins."""
    eff = effective(cfg)
    values: dict[str, str] = {}
    for t in cfg.toggles:
        if t.var and VAR_RE.match(t.var):
            values[t.var] = TRUE if eff[t.id] else FALSE
    if cfg.mode == "one" and cfg.group_var and VAR_RE.match(cfg.group_var):
        picked = next((t for t in cfg.toggles if eff[t.id]), None)
        values[cfg.group_var] = (picked.value or picked.name) if picked else ""
    return values


def output_slots(cfg: Config) -> list[Toggle]:
    """Pinned toggles in output order (slot 1, 2, …). Uses each row's ``out``
    when those are 1..N with no gaps or repeats, else row order."""
    pinned = [t for t in cfg.toggles if t.pin][:MAX_OUTPUTS]
    outs = sorted(t.out for t in pinned)
    if outs == list(range(1, len(pinned) + 1)):
        return sorted(pinned, key=lambda t: t.out)
    return pinned


def output_values(cfg: Config) -> list[bool]:
    """The 16 BOOLEAN outputs: pinned toggles first, then ``False`` padding."""
    eff = effective(cfg)
    vals = [eff[t.id] for t in output_slots(cfg)]
    return vals + [False] * (MAX_OUTPUTS - len(vals))
