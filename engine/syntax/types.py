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
from dataclasses import dataclass, field
from typing import (
    Any,
    Literal,
    Protocol,
    runtime_checkable,
)

SurfaceKind = Literal["wildcard", "combine", "derivation", "assembler"]


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

    def get_var(self, name: str) -> str | None:
        """Return the bound value of `name`, or None if unbound."""
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
