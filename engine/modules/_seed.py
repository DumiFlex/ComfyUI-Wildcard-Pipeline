"""Shared seed-derivation helper for module handlers.

Every kind that needs reproducible randomness (wildcard pick, combine
{a|b|c} resolution, fixed_values value alternations) routes through
this same function so the same `(seed, key)` pair always yields the
same RNG state. Lifting it out of wildcard_handler.py prevents drift
when more kinds gain seed-lock support.

Independence: every roll draws from its own stream. A handler keys its
module stream by the INSTANCE (`instance_key`), not by its variable or
library id, so two instances of one module, or two modules writing the
same variable, never roll in lockstep. Inside the module, each value,
rule action, option and `{…}` / `@{…}` site gets a child stream
(`stream_key` + `engine.syntax.streams`), so adding, editing or firing
one pick never moves another.
"""
from __future__ import annotations

import hashlib
import random
from typing import Any


def derive_module_rng(seed: int, key: str) -> random.Random:
    """Per-module RNG derived from (seed, key).

    `key` is a stable per-instance string (see `instance_key`). Different
    keys under the same seed yield independent streams.

    Used for BOTH locked and unlocked picks — applying the same
    derivation either way is what lets lock capture the visible
    roll: locking with `locked_seed = chain_seed` reproduces the
    unlocked pick exactly because both paths derive from
    `sha256(chain_seed:key)`.
    """
    digest = hashlib.sha256(f"{int(seed)}:{key}".encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


def instance_key(ctx: Any, fallback: str) -> str:
    """The stream key of the module instance running now.

    The pipeline sets `__wp_instance_key__` (bundle copy + per-instance
    uid) before each handler runs. Handlers called outside a pipeline run
    (unit tests, previews) have none and fall back to `fallback`, their
    old key, so those callers keep their seeds.
    """
    key = ctx.get("__wp_instance_key__") if isinstance(ctx, dict) else None
    return key if isinstance(key, str) and key else fallback


def stream_key(seed: int, key: str) -> str:
    """The resolver stream key for text resolved under `(seed, key)`."""
    return f"{int(seed)}:{key}"
