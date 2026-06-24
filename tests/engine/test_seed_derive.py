"""Pure-Python tests for engine/seed_derive.py.

`derive_loop_seeds` and `effective_chain_seed` are the helpers WP_ContextLoop
+ WP_Context rely on for per-iteration seed shaping. Tests live here so the
rule stays testable without ComfyUI in scope.
"""

import pytest

from engine.seed_derive import MAX_SAFE_SEED, derive_loop_seeds, effective_chain_seed


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
        # 50-bit mask: base larger than 50 bits gets masked.
        (2**65, None, 0, 2**65 & ((1 << 50) - 1)),
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


def test_effective_chain_seed_override_used_as_is_ignores_loop_index():
    # An override IS the loop's already-per-iteration derived seed, so the
    # loop_index XOR must NOT be re-applied on top — the override is used
    # verbatim at every index. (The XOR only exists to vary a CONSTANT widget
    # seed when there is no override; see the override-OFF mixing test.)
    assert effective_chain_seed(widget_seed=42, seed_override=10, loop_index=0) == 10
    assert effective_chain_seed(widget_seed=42, seed_override=10, loop_index=1) == 10
    assert effective_chain_seed(widget_seed=42, seed_override=10, loop_index=3) == 10


def test_effective_chain_seed_deterministic():
    a = effective_chain_seed(widget_seed=42, seed_override=None, loop_index=5)
    b = effective_chain_seed(widget_seed=42, seed_override=None, loop_index=5)
    assert a == b


def test_max_safe_seed_value():
    """Anchor the 50-bit cap — matches ComfyUI's frontend randomize range."""
    assert MAX_SAFE_SEED == (1 << 50) - 1 == 1_125_899_906_842_623


@pytest.mark.parametrize("base", [0, 42, 2**60])
@pytest.mark.parametrize("strategy", ["hash_index", "sequential", "prime_stride"])
def test_derive_loop_seeds_always_fits_50_bits(base, strategy):
    """Every seed every strategy emits sits inside the 50-bit cap so
    KSampler / canvas seed widgets render the same shape ComfyUI's own
    frontend randomize produces."""
    seeds = derive_loop_seeds(base, 4, strategy)
    assert len(seeds) == 4
    for s in seeds:
        assert 0 <= s <= MAX_SAFE_SEED


def test_effective_chain_seed_always_fits_50_bits():
    """Same cap applies to the chain-seed helper regardless of which
    branch it takes."""
    for idx in range(0, 5):
        s = effective_chain_seed(widget_seed=2**60, seed_override=None, loop_index=idx)
        assert 0 <= s <= MAX_SAFE_SEED
        s2 = effective_chain_seed(widget_seed=42, seed_override=2**60, loop_index=idx)
        assert 0 <= s2 <= MAX_SAFE_SEED
