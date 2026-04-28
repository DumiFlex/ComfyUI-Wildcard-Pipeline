"""Engine syntax: tokenizer + resolver shared between runtime and Test Runner.

See `docs/superpowers/specs/2026-04-28-engine-syntax-design.md` for the
language contract and parity rules.
"""
from engine.syntax.types import (
    CycleDetectedError,
    MalformedSyntaxError,
    RecursionLimitExceeded,
    RefOutOfSurfaceError,
    ResolveContext,
    SurfaceKind,
    SyntaxError,
    Token,
    TokenKind,
    UnknownRefError,
)

__all__ = [
    "CycleDetectedError",
    "MalformedSyntaxError",
    "RecursionLimitExceeded",
    "RefOutOfSurfaceError",
    "ResolveContext",
    "SurfaceKind",
    "SyntaxError",
    "Token",
    "TokenKind",
    "UnknownRefError",
]
