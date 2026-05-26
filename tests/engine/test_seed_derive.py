"""Pure-Python tests for engine/seed_derive.py.

`derive_loop_seeds` and `effective_chain_seed` are the helpers WP_ContextLoop
+ WP_Context rely on for per-iteration seed shaping. Tests live here so the
rule stays testable without ComfyUI in scope.
"""

import pytest

from engine.seed_derive import derive_loop_seeds


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
