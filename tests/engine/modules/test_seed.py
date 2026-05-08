"""Tests for the shared module-RNG helper.

Covers determinism + key/seed independence — the two contracts callers
(wildcard_handler, combine_handler, fixed_values_handler) rely on for
reproducible per-module randomness.
"""
import random

from engine.modules._seed import derive_module_rng


def test_derive_module_rng_returns_random_instance():
    rng = derive_module_rng(42, "my_var")
    assert isinstance(rng, random.Random)


def test_derive_module_rng_deterministic():
    """Same (seed, key) always yields the same RNG state."""
    rng1 = derive_module_rng(42, "my_var")
    rng2 = derive_module_rng(42, "my_var")
    seq1 = [rng1.random() for _ in range(5)]
    seq2 = [rng2.random() for _ in range(5)]
    assert seq1 == seq2


def test_derive_module_rng_different_keys_independent():
    """Same seed but different keys produces independent streams.

    This is the property that lets two co-resident wildcards binding
    different vars roll independently — adding/removing modules
    upstream doesn't shift the picks of the survivors.
    """
    rng_a = derive_module_rng(42, "var_a")
    rng_b = derive_module_rng(42, "var_b")
    seq_a = [rng_a.random() for _ in range(5)]
    seq_b = [rng_b.random() for _ in range(5)]
    assert seq_a != seq_b


def test_derive_module_rng_different_seeds_independent():
    """Different seeds produce different streams."""
    rng_1 = derive_module_rng(1, "key")
    rng_2 = derive_module_rng(2, "key")
    seq_1 = [rng_1.random() for _ in range(5)]
    seq_2 = [rng_2.random() for _ in range(5)]
    assert seq_1 != seq_2
