"""Every roll draws from its own random stream.

Each test changes something UNRELATED to one roll and checks, over many
seeds, that the roll never moves (or, for two separate rolls, that they
agree only about as often as chance). Before per-instance and per-site
streams, a rule firing, a value added above, a ref added before or an
option added to an earlier pick shifted the later roll on most seeds, and
two fixed-values or derivation modules rolled in lockstep on every seed.
"""
from __future__ import annotations

import copy

from engine.pipeline import PipelineEngine

SEEDS = range(200)
PICK = "{a|b|c|d|e}"


def _run(modules, seed):
    return PipelineEngine().run(copy.deepcopy(modules), seed=seed)


def _values(modules, var):
    return [_run(modules, s).get(var) for s in SEEDS]


def _wildcard(mid, var, options):
    return {
        "id": mid, "_uid": mid, "type": "wildcard",
        "payload": {"var_binding": var, "options": options},
        "instance": {"variable_binding": var},
    }


def _fixed(mid, values):
    return {
        "id": mid, "_uid": mid, "type": "fixed_values",
        "payload": {"values": [
            {"id": f"v{i}", "name": k, "value": v} for i, (k, v) in enumerate(values.items())
        ]},
        "instance": {},
    }


def _derivation(mid, rules):
    return {"id": mid, "_uid": mid, "type": "derivation",
            "payload": {"rules": rules}, "instance": {}}


def _rule(rid, cond, target, value):
    return {"id": rid, "branches": [{"condition": cond, "action": {
        "target_var": target, "mode": "replace", "value": value}}]}


def _same_share(a, b):
    return sum(1 for x, y in zip(a, b, strict=True) if x == y) / len(a)


def test_derivation_rule_roll_ignores_whether_an_earlier_rule_fired():
    x = _fixed("f0000001", {"x": "yes"})

    def chain(fire):
        return [x, _derivation("d0000001", [
            _rule("r1", {"var": "x", "op": "equals", "value": "yes" if fire else "no"}, "t1", PICK),
            _rule("r2", {"var": "x", "op": "exists", "value": ""}, "t2", PICK),
        ])]

    assert _values(chain(False), "t2") == _values(chain(True), "t2")


def test_fixed_value_roll_ignores_a_value_added_above_it():
    assert _values([_fixed("f0000002", {"b": PICK})], "b") == \
        _values([_fixed("f0000002", {"a": PICK, "b": PICK})], "b")


def test_ref_roll_ignores_a_ref_added_before_it():
    colors = [{"id": str(i), "value": c, "weight": 1}
              for i, c in enumerate(["red", "blue", "green", "gold", "black"])]
    cat = _wildcard("aaaa0001", "c", colors)

    def jeans(text):
        mods = [cat, _wildcard("bbbb0002", "o", [{"id": "1", "value": text, "weight": 1}])]
        out = []
        for s in SEEDS:
            ctx = PipelineEngine().run(copy.deepcopy(mods), ctx={"__wp_catalog__": {
                "aaaa0001": {"type": "wildcard", **cat["payload"]}}}, seed=s)
            out.append(ctx["o"].split()[-2])
        return out

    assert jeans("@{aaaa0001} jeans") == jeans("@{aaaa0001} jacket and @{aaaa0001} jeans")


def test_combine_pick_ignores_an_option_added_to_an_earlier_pick():
    def last(template):
        mods = [{"id": "cccc0001", "_uid": "cccc0001", "type": "combine",
                 "payload": {"template": template, "output_var": "k", "input_vars": []},
                 "instance": {}}]
        return [v.split()[-1] for v in _values(mods, "k")]

    assert last("{x|y} " + PICK) == last("{x|y|z} " + PICK)


def test_two_fixed_values_modules_roll_independently():
    vals = [_run([_fixed("f0000003", {"p": PICK}), _fixed("f0000004", {"q": PICK})], s)
            for s in SEEDS]
    assert _same_share([c["p"] for c in vals], [c["q"] for c in vals]) < 0.35


def test_two_instances_of_one_derivation_roll_independently():
    cond = {"var": "z", "op": "not_exists", "value": ""}
    a = _derivation("dddd0001", [_rule("r", cond, "p", PICK)])
    b = _derivation("dddd0001", [_rule("r", cond, "q", PICK)])
    a["_uid"], b["_uid"] = "i1", "i2"
    vals = [_run([a, b], s) for s in SEEDS]
    assert _same_share([c["p"] for c in vals], [c["q"] for c in vals]) < 0.35


def test_two_wildcards_writing_one_variable_roll_independently():
    opts = [{"id": str(i), "value": f"v{i}", "weight": 1} for i in range(5)]
    a = _values([_wildcard("aaaa0003", "hair", opts)], "hair")
    b = _values([_wildcard("aaaa0004", "hair", opts)], "hair")
    assert _same_share(a, b) < 0.35


def test_locked_seed_still_reproduces_the_unlocked_roll():
    m = _fixed("f0000005", {"p": PICK})
    for s in (3, 17, 99):
        locked = copy.deepcopy(m)
        locked["instance"]["locked_seed"] = s
        assert _run([m], s)["p"] == _run([locked], 12345)["p"]
