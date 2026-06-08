"""Foundational types for the engine syntax module.

Defines:
  - Token + TokenKind (the tokenizer's output shape)
  - TokenMeta (per-token metadata payload)
  - ResolveContext Protocol (the interface resolvers depend on)
  - SyntaxError hierarchy (UnknownRefError, RefOutOfSurfaceError,
    RecursionLimitExceeded, CycleDetectedError, MalformedSyntaxError)
"""
from __future__ import annotations

import enum
import random
import re
from dataclasses import dataclass, field
from typing import (
    Any,
    Literal,
    Protocol,
    runtime_checkable,
)

SurfaceKind = Literal["wildcard", "combine", "derivation", "assembler", "fixed_values"]


class TokenKind(enum.Enum):
    """All token kinds emitted by tokenize_text. Single grammar, no surface variants."""

    TEXT = "text"
    VAR = "var"
    REF = "ref"
    DP_BRACE = "dp_brace"
    DP_PIPE = "dp_pipe"
    DP_MULTI = "dp_multi"
    ESCAPE = "escape"


@dataclass
class Token:
    """A single tokenizer output. `meta` is kind-specific:

    - VAR:      {"name": str}
    - REF:      {"uuid": str}
    - DP_MULTI: {"count": int, "sep": str, "branches": list[str]}
    - DP_BRACE: {"branches": list[str]}
    - ESCAPE:   {"literal": str}  (one of "$" or "@")
    - TEXT, DP_PIPE: {} (empty)
    """

    kind: TokenKind
    raw: str
    start: int
    end: int
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class ListVar:
    """A list-valued variable plus the separator used to join it for a bare
    ``$name`` reference (SP2a multi-select). Produced only by a multi-select
    wildcard; exists only inside one resolution pass — never persisted or
    published. ``$name`` renders ``sep.join(items)``; ``$name.K`` indexes
    (0-based; out-of-range -> "").
    """

    items: list[str]
    sep: str

    def __str__(self) -> str:
        """A bare ``$name`` reference renders the list joined by ``sep``.
        Defining ``__str__`` (the @dataclass ``__repr__`` stays, for debug)
        keeps a list value that leaks into a plain ``str()`` context rendering
        as the user-facing joined string instead of ``ListVar(items=[...])``."""
        return self.sep.join(self.items)


_VAR_ACCESSOR_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\.(\d+)$")


def split_var_accessor(name: str) -> tuple[str, int | None]:
    """Split a bare var reference into ``(base_name, index)`` (SP2a `.K`).

    ``"mood.0"`` -> ``("mood", 0)``; ``"mood"`` -> ``("mood", None)``. A name
    that is not an ``ident.digits`` shape is returned whole with
    ``index=None`` so unusual keys pass through unchanged. Callers strip any
    leading ``$`` before calling.
    """
    if not isinstance(name, str):
        return ("", None)
    m = _VAR_ACCESSOR_RE.match(name)
    if m:
        return (m.group(1), int(m.group(2)))
    return (name, None)


def deref_var_value(value: str | ListVar | None, index: int | None) -> str:
    """Render a resolved var value to a string, honoring an optional ``.K``
    list accessor (SP2a). ListVar: bare -> ``sep.join(items)``; ``.K`` ->
    ``items[K]`` or ``""`` when out of range. A plain string behaves as a
    1-element list (``.0`` == itself, ``.K`` > 0 == ``""``). ``None`` -> ``""``.

    Single source of the accessor contract: resolve.py, derivation_handler.py
    and converters.py all defer here so the read sites never drift.
    """
    if value is None:
        return ""
    if isinstance(value, ListVar):
        if index is not None:
            return value.items[index] if 0 <= index < len(value.items) else ""
        return value.sep.join(value.items)
    s = value if isinstance(value, str) else str(value)
    if index is not None:
        return s if index == 0 else ""
    return s


@runtime_checkable
class ResolveContext(Protocol):
    """Interface the resolver depends on. Construct via build_resolve_ctx in
    engine/modules/__init__.py at pipeline start; in tests use a duck-typed
    fake (any class with these attrs and methods).
    """

    rng: random.Random
    max_ref_depth: int
    strict: bool
    surface: SurfaceKind
    developer_mode: bool
    warnings: list[dict[str, Any]]

    def get_var(self, name: str) -> str | ListVar | None:
        """Return the bound value of `name`, or None if unbound. A
        multi-select wildcard binds a ``ListVar`` (SP2a); everything else
        binds a ``str``."""
        ...

    def get_module(self, uuid: str) -> dict[str, Any] | None:
        """Return the module catalog row for `uuid`, or None if missing.

        Row shape (only fields the resolver uses): `{"type": str,
        "var_binding": str, "options": list[{"value": str, "weight": float}]}`.
        """
        ...


# ---------- Error hierarchy ---------------------------------------------------


class SyntaxError(Exception):
    """Base for all engine syntax errors. Distinct from Python's built-in
    SyntaxError (which is for source-code parse errors); this one is for
    wildcard syntax."""


class UnknownRefError(SyntaxError):
    """@{uuid} points to a module not in the catalog."""

    def __init__(self, uuid: str) -> None:
        self.uuid = uuid
        super().__init__(f"unknown wildcard ref: @{{{uuid}}}")


class RefOutOfSurfaceError(SyntaxError):
    """@{uuid} appears in a non-wildcard surface (combine/derivation/assembler)."""

    def __init__(self, uuid: str, surface: str) -> None:
        self.uuid = uuid
        self.surface = surface
        super().__init__(
            f"ref @{{{uuid}}} not allowed in {surface!r} surface; "
            f"only wildcard option values"
        )


class VarOutOfSurfaceError(SyntaxError):
    """$var read attempted in a surface that doesn't allow it.

    Combine, derivation, and assembler surfaces support $var reads.
    Wildcard and fixed_values surfaces are binding PRODUCERS, not
    consumers — $var reads in those surfaces warn (lenient) or raise
    (strict) per ResolveContext.strict.
    """

    def __init__(self, name: str, surface: str) -> None:
        self.name = name
        self.surface = surface
        super().__init__(
            f"$var ${name} not allowed in {surface!r} surface; "
            f"only combine / derivation / assembler surfaces support $var reads"
        )


class RecursionLimitExceeded(SyntaxError):
    """@{uuid} chain reached configured max_ref_depth."""


class CycleDetectedError(SyntaxError):
    """@{uuid} chain returned to an already-visiting UUID."""

    def __init__(self, chain: list[str]) -> None:
        self.chain = chain
        super().__init__(
            "cycle: " + " → ".join(f"@{{{u}}}" for u in chain)
        )


class MalformedSyntaxError(SyntaxError):
    """Tokenizer / resolver received structurally invalid token meta."""
