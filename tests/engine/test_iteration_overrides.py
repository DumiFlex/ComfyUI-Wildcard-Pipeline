from engine.pipeline import PipelineEngine


def _run(modules, *, loop_index, seed=42):
    return PipelineEngine().run(modules, seed=seed, loop_index=loop_index)


def _wildcard(binding, values, *, overrides=None):
    m = {
        "type": "wildcard",
        "payload": {
            "var_binding": binding,
            "options": [{"id": str(i), "value": v, "weight": 1.0} for i, v in enumerate(values)],
        },
        "instance": {"variable_binding": binding},
    }
    if overrides is not None:
        m["iteration_overrides"] = overrides
    return m


def test_override_pins_option_only_on_its_frame():
    # Override frame 2: set mode=pinned + pinned_option_id="0" (value "a").
    m = _wildcard(
        "x",
        ["a", "b", "c", "d"],
        overrides={"2": {"mode": "pinned", "pinned_option_id": "0"}},
    )
    # Frame 2 must always return "a" (pinned), regardless of seed.
    for s in range(10):
        assert _run([m], loop_index=2, seed=s)["x"] == "a"
    # Non-override frames must NOT be pinned: check across many seeds to
    # confirm they produce values other than "a" (RNG-driven diversity).
    others = {
        _run([m], loop_index=k, seed=s)["x"]
        for k in (0, 1, 3, 5)
        for s in range(20)
    }
    assert others != {"a"}


def test_combine_template_override_on_frame():
    m = {
        "type": "combine",
        "payload": {"output_var": "y", "template": "base text"},
        "instance": {},
        "iteration_overrides": {"1": {"template_override": "frame one text"}},
    }
    assert _run([m], loop_index=1)["y"] == "frame one text"
    assert _run([m], loop_index=0)["y"] == "base text"


def test_constraint_cell_factor_override_applies_only_on_its_frame():
    """iteration_overrides on a constraint module patches the instance before
    the handler registers its metadata — the wildcard downstream picks up
    a different matrix on the override frame vs a non-override frame.

    Setup:
      - source wildcard "src" picks "s1" (pinned on all frames via locked_seed
        + mode=pinned so the source is predictable and the matrix row is stable)
      - constraint: matrix s1 -> t1 boost factor 1.0 (baseline — no real effect)
      - target wildcard "tgt" has two options "t1" (id="0") and "t2" (id="1"),
        each weight 1.0.  With a large boost factor (100.0) on frame 3, the
        target wildcard should pick "t1" virtually every time; on other frames
        the default factor 1.0 leaves both options equally weighted so variance
        is possible.

    The test asserts:
      - frame 3 result is "t1" (the boosted option wins under a large factor)
      - at least one other frame is not forced to "t1" (many_other_results is
        NOT {"t1"}) — this verifies the override is frame-local, not global.
    """
    src_module = {
        "type": "wildcard",
        "id": "src-uuid",
        "payload": {
            "var_binding": "src",
            "options": [{"id": "s0", "value": "s1", "weight": 1.0}],
        },
        "instance": {
            "variable_binding": "src",
            "mode": "pinned",
            "pinned_option_id": "s0",
        },
    }
    constraint_module = {
        "type": "constraint",
        "id": "con-uuid",
        "payload": {
            "source_wildcard_id": "src-uuid",
            "target_wildcard_id": "tgt-uuid",
            "matrix": {
                "s1": {
                    "t1": {"mode": "boost", "factor": 1.0},
                },
            },
            "exceptions": [],
        },
        "instance": {},
        # On frame 3: override cell factor to 100.0 (dominates random picks).
        "iteration_overrides": {
            "3": {"cell_factor_overrides": {'["s1","t1"]': 100.0}},
        },
    }
    tgt_module = {
        "type": "wildcard",
        "id": "tgt-uuid",
        "payload": {
            "var_binding": "tgt",
            "options": [
                {"id": "0", "value": "t1", "weight": 1.0},
                {"id": "1", "value": "t2", "weight": 1.0},
            ],
        },
        "instance": {"variable_binding": "tgt"},
    }
    chain = [src_module, constraint_module, tgt_module]

    # Frame 3: massive boost forces "t1".
    result_frame3 = _run(chain, loop_index=3, seed=42)["tgt"]
    assert result_frame3 == "t1", (
        f"expected 't1' on frame 3 (boosted), got {result_frame3!r}"
    )

    # Other frames: run many seeds to confirm "t2" appears at least once,
    # proving the override does NOT leak across frames.
    other_results = {
        _run(chain, loop_index=k, seed=s)["tgt"]
        for k in (0, 1, 2, 4)
        for s in range(10)
    }
    assert "t2" in other_results, (
        "expected 't2' to appear on non-override frames but only got: "
        f"{other_results!r}"
    )
