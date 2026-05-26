"""Pure-Python tests for engine/seed_derive.py.

`derive_loop_seeds` and `effective_chain_seed` are the helpers WP_ContextLoop
+ WP_Context rely on for per-iteration seed shaping. Tests live here so the
rule stays testable without ComfyUI in scope.
"""

import pytest

from engine.seed_derive import derive_loop_seeds, effective_chain_seed


@pytest.mark.parametrize(
    "base,count,strategy,expected",
    [
        (10, 1, "sequential", [10]),
        (10, 1, "hash_index", [10]),
        (10, 3, "sequential", [10, 11, 12]),
        (10, 3, "prime_stride", [10, 1000013, 2000016]),
        (42, 1, "prime_stride", [42]),
    ],
)
def test_derive_loop_seeds(base, count, strategy, expected):
    assert derive_loop_seeds(base, count, strategy) == expected


def test_derive_loop_seeds_hash_index_deterministic():
    a = derive_loop_seeds(10, 3, "hash_index")
    b = derive_loop_seeds(10, 3, "hash_index")
    assert a == b
    assert len(a) == 3
    assert a[0] != a[1]
    assert a[1] != a[2]


def test_derive_loop_seeds_unknown_strategy_raises():
    with pytest.raises(ValueError, match="unknown loop seed strategy"):
        derive_loop_seeds(10, 3, "wat")


@pytest.mark.parametrize(
    "widget,override,idx,expected",
    [
        # Backwards-compat: no override + loop_index=0 → widget unchanged.
        (42, None, 0, 42),
        # Override beats widget when present.
        (42, 10, 0, 10),
        # 64-bit mask: base larger than 64 bits gets masked.
        (2**65, None, 0, 2**65 & 0xFFFFFFFFFFFFFFFF),
    ],
)
def test_effective_chain_seed_baseline(widget, override, idx, expected):
    got = effective_chain_seed(widget_seed=widget, seed_override=override, loop_index=idx)
    assert got == expected


def test_effective_chain_seed_loop_index_mixes_when_positive():
    base = 42
    a = effective_chain_seed(widget_seed=base, seed_override=None, loop_index=0)
    b = effective_chain_seed(widget_seed=base, seed_override=None, loop_index=1)
    c = effective_chain_seed(widget_seed=base, seed_override=None, loop_index=2)
    assert a == base
    assert b != base
    assert c != base
    assert b != c


def test_effective_chain_seed_override_path_mixes_loop_index():
    a = effective_chain_seed(widget_seed=42, seed_override=10, loop_index=0)
    b = effective_chain_seed(widget_seed=42, seed_override=10, loop_index=1)
    assert a == 10
    assert b != 10
    assert b != 42


def test_effective_chain_seed_deterministic():
    a = effective_chain_seed(widget_seed=42, seed_override=None, loop_index=5)
    b = effective_chain_seed(widget_seed=42, seed_override=None, loop_index=5)
    assert a == b
