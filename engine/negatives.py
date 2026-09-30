"""Per-variable negative prompts (schema v8, send-to-negative).

A wildcard option, a fixed value, a combine and a derivation "Add to
negative" action can carry negative text. The engine files it under the
variable it belongs to, in ``ctx["__wp_negatives__"]``:

    {binding: [{"text": str, "pick": int | None, "source": str}, ...]}

``pick`` is the multi-pick slot the entry belongs to (``None`` = the whole
value), so ``$props.1`` can carry only pick 1's negative while ``$props`` and
``$props.AXIS`` carry every pick's. Text is stored already resolved.

Negatives follow USAGE: an Assembler only emits the negatives of variables
its positive template actually rendered. A combine (and a derivation value)
inherits the negatives of the variables its text read.

Seeds never shift: negative text resolves on its own stream,
``derive_module_rng(seed, key + "::neg")``, and in QUIET mode (see
:func:`quiet_resolve`) so an ``@{ref}`` inside a negative binds nothing,
counts no constraint hits and writes nothing to the Test Runner ref log.

Pure engine module: no ComfyUI imports.
"""
from __future__ import annotations

import dataclasses
import random
import re
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from typing import Any

NEG_KEY = "__wp_negatives__"
#: Bindings whose negatives a handler set during the current module. The
#: pipeline clears the negatives of every OTHER binding the module wrote
#: (a write replaces the value, so it replaces what the value carried).
TOUCHED_KEY = "__wp_neg_touched__"

Entry = dict[str, Any]


def neg_rng(seed: int, key: str) -> random.Random:
    """The negative stream for a module keyed ``key`` under ``seed``."""
    from engine.modules._seed import derive_module_rng  # noqa: PLC0415 - cycle

    return derive_module_rng(int(seed), f"{key}::neg")


def clean_negative(raw: Any) -> str:
    """A payload ``negative`` field as a stripped string ('' when absent)."""
    return raw.strip() if isinstance(raw, str) else ""


def table(ctx: dict[str, Any]) -> dict[str, list[Entry]]:
    got = ctx.get(NEG_KEY)
    if not isinstance(got, dict):
        got = {}
        ctx[NEG_KEY] = got
    return got


def get_entries(ctx: Any, binding: str) -> list[Entry]:
    if not isinstance(ctx, dict):
        return []
    got = ctx.get(NEG_KEY)
    if not isinstance(got, dict):
        return []
    rows = got.get(binding)
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def set_entries(
    ctx: Any, binding: str, entries: Iterable[Entry], *, add: bool = False,
) -> None:
    """Replace (default) or extend ``binding``'s negatives and mark it touched
    so the pipeline's write step keeps them."""
    if not isinstance(ctx, dict) or not binding:
        return
    rows = [e for e in entries if isinstance(e, dict) and str(e.get("text", "")).strip()]
    tbl = table(ctx)
    if add:
        rows = get_entries(ctx, binding) + rows
    if rows:
        tbl[binding] = rows
    else:
        tbl.pop(binding, None)
    touched = ctx.get(TOUCHED_KEY)
    if not isinstance(touched, list):
        touched = []
        ctx[TOUCHED_KEY] = touched
    if binding not in touched:
        touched.append(binding)


def settle_writes(ctx: dict[str, Any], written: Iterable[str]) -> None:
    """After a module's bindings land: a written binding the module did not
    give negatives to loses its old ones (the value was replaced)."""
    touched = ctx.pop(TOUCHED_KEY, None)
    touched = set(touched) if isinstance(touched, list) else set()
    tbl = ctx.get(NEG_KEY)
    if not isinstance(tbl, dict):
        return
    for key in written:
        if key not in touched:
            tbl.pop(key, None)


def copy_from(ctx: Any, source: Any, bindings: Iterable[str]) -> None:
    """Held modules reuse their frame-0 value verbatim; reuse its negatives."""
    for b in bindings:
        set_entries(ctx, b, [dict(e) for e in get_entries(source, b)])


def entries_for_reads(ctx: Any, reads: Iterable[tuple[str, Any]]) -> list[Entry]:
    """The negatives a text inherits from the ``$var`` reads it made.

    ``(name, None)`` takes every entry; ``(name, K)`` takes the entries of
    pick K plus the whole-value ones. Order follows the reads; an entry is
    taken once even when read twice. Inherited entries lose their pick slot:
    they now belong to the reader as a whole.
    """
    out: list[Entry] = []
    seen: set[tuple[str, int]] = set()
    for name, index in reads:
        for i, e in enumerate(get_entries(ctx, name)):
            pick = e.get("pick")
            if index is not None and pick is not None and pick != index:
                continue
            if (name, i) in seen:
                continue
            seen.add((name, i))
            out.append({**e, "pick": None})
    return out


class Collector:
    """What one resolve touched: ``$var`` reads and nested-ref option picks."""

    def __init__(self) -> None:
        self.reads: list[tuple[str, Any]] = []
        self.ref_negatives: list[str] = []


@contextmanager
def collecting(resolve_ctx: Any) -> Iterator[Collector]:
    """Point a resolve context's read/ref hooks at a fresh collector for the
    duration of the block. Works on any ResolveContext; one without the hook
    fields simply collects nothing."""
    col = Collector()
    has = hasattr(resolve_ctx, "_reads") and hasattr(resolve_ctx, "_ref_negs")
    if not has:
        yield col
        return
    saved = (resolve_ctx._reads, resolve_ctx._ref_negs)
    resolve_ctx._reads = col.reads
    resolve_ctx._ref_negs = col.ref_negatives
    try:
        yield col
    finally:
        resolve_ctx._reads, resolve_ctx._ref_negs = saved


def quiet_resolve(text: str, resolve_ctx: Any, rng: random.Random) -> str:
    """Resolve negative text without side effects on the positive run.

    Draws from ``rng`` (the negative stream), applies no constraints and
    counts no hits, writes no ref log, collects no reads, and ignores the
    negatives of options its refs pick (no chaining). Warnings still land.
    """
    if not text:
        return ""
    from engine.syntax import resolve_text  # noqa: PLC0415 - import cycle

    if dataclasses.is_dataclass(resolve_ctx) and not isinstance(resolve_ctx, type):
        quiet = dataclasses.replace(
            resolve_ctx,
            rng=rng,
            _constraints=[],
            _hits={},
            _ref_log=None,
            _reads=None,
            _ref_negs=None,
        )
    else:
        quiet = resolve_ctx
    return resolve_text(text, quiet).strip()


def own_entries(
    texts: Iterable[str], resolve_ctx: Any, rng: random.Random,
    *, pick: int | None, source: str,
) -> list[Entry]:
    """Quietly resolve each raw negative text into an entry."""
    out: list[Entry] = []
    for raw in texts:
        text = quiet_resolve(raw, resolve_ctx, rng) if raw else ""
        if text:
            out.append({"text": text, "pick": pick, "source": source})
    return out


# ---------------------------------------------------------------------------
# Tag handling (Assembler join + Cleaner dedupe)
# ---------------------------------------------------------------------------

_WEIGHT_WRAP = re.compile(r"^\(+\s*(.*?)\s*(?::\s*[0-9.]+)?\s*\)+$")


def split_tags(text: str) -> list[str]:
    """Split on commas that are not inside (), [] or {}."""
    out: list[str] = []
    depth = 0
    cur: list[str] = []
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}" and depth > 0:
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur).strip())
    return [t for t in out if t]


def tag_key(tag: str) -> str:
    """Comparison key: case-folded, whitespace-collapsed, and a single
    ``(tag:1.2)`` / ``((tag))`` weight wrap removed so emphasis variants of
    one tag compare equal."""
    t = " ".join(tag.split()).casefold()
    m = _WEIGHT_WRAP.match(t)
    if m and "(" not in m.group(1) and ")" not in m.group(1):
        t = m.group(1).strip()
    return t


def join_unique(texts: Iterable[str], skip: Iterable[str] = ()) -> str:
    """Join negative texts tag by tag, dropping repeats (first one wins) and
    any tag whose key is in ``skip``."""
    seen = {tag_key(s) for s in skip}
    out: list[str] = []
    for text in texts:
        for tag in split_tags(text):
            k = tag_key(tag)
            if k in seen:
                continue
            seen.add(k)
            out.append(tag)
    return ", ".join(out)


NEGATIVES_SLOT = "$negatives"
_SLOT_RE = re.compile(r"\$negatives(?![A-Za-z0-9_])")


def has_slot(template: str) -> bool:
    return bool(_SLOT_RE.search(template or ""))


def render_negative(
    template: str, collected: str, resolve_raw: Callable[[str], str],
) -> str:
    """Fill the Assembler's negative template.

    ``$negatives`` marks where the collected words go. An empty template is
    just the collected words; a template without the slot gets them appended.
    ``resolve_raw`` renders the template's other text (its ``$vars``) without
    tidying. Tags the template already contains are dropped from the
    collected words so nothing is said twice.
    """
    tpl = template or ""
    if not tpl.strip():
        return collected
    pieces = _SLOT_RE.split(tpl)
    rendered = [resolve_raw(p) if p else "" for p in pieces]
    fixed_tags: list[str] = []
    for r in rendered:
        fixed_tags.extend(split_tags(r))
    words = join_unique([collected], skip=fixed_tags)
    if len(pieces) == 1:
        base = tidy(rendered[0])
        if not words:
            return base
        return f"{base}, {words}" if base else words
    return tidy(words.join(rendered))


_COMMA_RUN = re.compile(r"\s*,(?:\s*,)*\s*")
_WS_RUN = re.compile(r"[ \t]{2,}")


def tidy(text: str) -> str:
    """Collapse whitespace and empty comma slots; trim edge commas."""
    out = _WS_RUN.sub(" ", text)
    out = _COMMA_RUN.sub(", ", out)
    return out.strip().strip(",").strip()
