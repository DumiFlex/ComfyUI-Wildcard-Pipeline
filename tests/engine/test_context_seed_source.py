"""resolve_context_seed: a Context's "Seed from" choice (auto / loop / own / row)."""
from engine.seed_derive import (
    LOOP_SEED_KEY,
    ROWS_KEY,
    effective_chain_seed,
    resolve_context_seed,
)

LOOP_ON = {
    "__wp_loop_index__": 2,
    "__wp_seed_override__": 500,
    "__wp_loop_seeds__": [300, 400, 500],
    LOOP_SEED_KEY: {"seed": 500, "frame0": 300},
}
LOOP_OFF = {
    "__wp_loop_index__": 2,
    "__wp_seed_override__": None,
    LOOP_SEED_KEY: {"seed": 500, "frame0": 300},
}


def _resolve(widget_seed, seed_from, internals):
    return resolve_context_seed(widget_seed=widget_seed, seed_from=seed_from, internals=internals)


def test_auto_keeps_todays_rule():
    assert _resolve(7, seed_from=None, internals=LOOP_ON) == (500, 300, "auto")
    chain, hold, src = _resolve(7, seed_from="auto", internals=LOOP_OFF)
    assert chain == effective_chain_seed(widget_seed=7, seed_override=None, loop_index=2)
    assert hold == 7 and src == "auto"
    assert _resolve(7, seed_from="", internals={}) == (7, 7, "auto")


def test_own_beats_the_loop_override():
    chain, hold, src = _resolve(7, seed_from="own", internals=LOOP_ON)
    assert src == "own" and hold == 7
    assert chain == effective_chain_seed(widget_seed=7, seed_override=None, loop_index=2)


def test_loop_without_override():
    assert _resolve(7, seed_from="loop", internals=LOOP_OFF) == (500, 300, "loop")


def test_row_and_missing_row_fallback():
    internals = {**LOOP_ON, ROWS_KEY: {"direction": {"seed": 11, "frame0": 10}}}
    assert _resolve(7, seed_from="row: Direction ", internals=internals) == (
        11, 10, "row: Direction")
    assert _resolve(7, seed_from="row:Gone", internals=internals) == (500, 300, "auto")
    assert _resolve(7, seed_from="loop", internals={}) == (7, 7, "auto")


def test_bad_entries_fall_back():
    internals = {ROWS_KEY: {"a": {"seed": True, "frame0": 1}}, LOOP_SEED_KEY: "x"}
    assert resolve_context_seed(widget_seed=3, seed_from="row:a", internals=internals)[2] == "auto"
    assert resolve_context_seed(widget_seed=3, seed_from="loop", internals=internals)[2] == "auto"


def test_seed_root_names_what_the_seed_was_made_from():
    from engine.seed_derive import seed_root

    assert seed_root("row:Face", LOOP_ON) == "row:Face"
    assert seed_root("loop", LOOP_OFF) == "loop"
    assert seed_root("auto", LOOP_ON) == "loop"
    assert seed_root("auto", LOOP_OFF) == "own"
    assert seed_root("own", LOOP_ON) == "own"
    assert seed_root("auto", {}) == "own"
