"""Shared seed-derivation helper for module handlers.

Every kind that needs reproducible randomness (wildcard pick, combine
{a|b|c} resolution, fixed_values value alternations) routes through
this same function so the same `(seed, key)` pair always yields the
same RNG state. Lifting it out of wildcard_handler.py prevents drift
when more kinds gain seed-lock support.
"""
from __future__ import annotations

import hashlib
import random


def derive_module_rng(seed: int, key: str) -> random.Random:
    """Per-module RNG derived from (seed, key).

    `key` is a stable per-module string — wildcard uses `binding`,
    combine uses `output_var`, fixed_values uses module id. Different
    keys under the same seed yield independent streams so two
    co-resident modules binding different vars roll independently.

    Used for BOTH locked and unlocked picks — applying the same
    derivation either way is what lets lock capture the visible
    roll: locking with `locked_seed = chain_seed` reproduces the
    unlocked pick exactly because both paths derive from
    `sha256(chain_seed:key)`.
    """
    digest = hashlib.sha256(f"{int(seed)}:{key}".encode()).hexdigest()
    return random.Random(int(digest[:16], 16))
