import json
import pathlib

from engine.seed_derive import MAX_SAFE_SEED, apply_seed_locks, derive_loop_seeds


def test_apply_seed_locks_overrides_only_locked_indices():
    derived = [10, 20, 30, 40]
    assert apply_seed_locks(derived, {1: 999, 3: 888}) == [10, 999, 30, 888]


def test_apply_seed_locks_empty_is_identity():
    assert apply_seed_locks([10, 20, 30], {}) == [10, 20, 30]


def test_apply_seed_locks_masks_locked_values_to_50_bits():
    over = MAX_SAFE_SEED + 5
    assert apply_seed_locks([0, 0], {0: over}) == [over & MAX_SAFE_SEED, 0]


def test_apply_seed_locks_ignores_out_of_range_indices():
    assert apply_seed_locks([10, 20], {5: 999}) == [10, 20]


def test_apply_seed_locks_over_real_derivation():
    derived = derive_loop_seeds(42, 4, "sequential")  # [42, 43, 44, 45]
    assert apply_seed_locks(derived, {2: 7}) == [42, 43, 7, 45]


def test_corpus_matches_engine():
    corpus = json.loads(pathlib.Path("tests/fixtures/seed-derive-corpus.json").read_text())
    for c in corpus["derive"]:
        assert derive_loop_seeds(c["base"], c["count"], c["strategy"]) == c["derived"]
