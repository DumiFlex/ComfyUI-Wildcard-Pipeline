"""Backward rules — a narrowed target keeps its constraint's source compatible.

Pose → Place: "sitting" only goes with places tagged `seat`, "lying" only with
`bed`. When Place is locked, filtered or toggled down, the pose must stay
something the remaining places accept (engine/modules/_backward.py).
"""
from __future__ import annotations

from engine.pipeline import PipelineEngine


def _opt(value: str, tags: list[str] | None = None, **extra) -> dict:
    return {"id": value.replace(" ", "_"), "value": value, "weight": 1,
            "sub_categories": tags or [], **extra}


def _wildcard(uid: str, binding: str, options: list[dict], instance: dict | None = None,
              **payload) -> dict:
    return {
        "type": "wildcard", "id": uid, "_uid": uid,
        "payload": {"var_binding": binding, "options": options, **payload},
        "instance": {"variable_binding": binding, **(instance or {})},
    }


def _poses(instance: dict | None = None, extra: list[dict] | None = None) -> dict:
    return _wildcard("pose0001", "pose", [
        _opt("sitting", ["sit"]), _opt("lying", ["lie"]), _opt("standing", ["stand"]),
        *(extra or []),
    ], instance)


def _places(instance: dict | None = None) -> dict:
    return _wildcard("plac0001", "place", [
        _opt("armchair", ["seat", "home"]), _opt("park bench", ["seat", "outdoor"]),
        _opt("bed", ["bed", "home"]), _opt("hammock", ["bed", "outdoor"]),
        _opt("street", ["street", "outdoor"]),
    ], instance)


def _rule(cid: str = "con00001", **extra) -> dict:
    # sitting → only seats, lying → only beds, standing → only the street.
    return {
        "type": "constraint", "id": cid, "_uid": cid,
        "payload": {
            "source_wildcard_id": "pose0001", "target_wildcard_id": "plac0001",
            "matrix": {
                "sit": {"seat": {"mode": "only", "factor": 1}},
                "lie": {"bed": {"mode": "only", "factor": 1}},
                "stand": {"street": {"mode": "only", "factor": 1}},
            },
            "exceptions": [],
            **extra,
        },
        "instance": {},
    }


def _run(modules, seed, ctx=None):
    return PipelineEngine().run(modules, ctx=ctx, seed=seed)


def _fits(pose: str, place: str) -> bool:
    return {
        "sitting": {"armchair", "park bench"},
        "lying": {"bed", "hammock"},
        "standing": {"street"},
    }[pose] >= {place} if pose in ("sitting", "lying", "standing") else True


def test_locked_place_keeps_the_pose_compatible():
    locked = _places({"mode": "pinned", "pinned_option_id": "bed"})
    poses = set()
    for seed in range(60):
        ctx = _run([_poses(), _rule(), locked], seed)
        assert ctx["place"] == "bed"
        assert ctx["pose"] == "lying", seed
        poses.add(ctx["pose"])
    assert poses == {"lying"}


def test_constraint_after_the_source_still_counts():
    # The constraint module sits between pose and place (the usual layout);
    # it has not registered yet when the pose rolls.
    locked = _places({"mode": "pinned", "pinned_option_id": "street"})
    for seed in range(30):
        ctx = _run([_poses(), _rule(), locked], seed)
        assert ctx["pose"] == "standing"


def test_constraint_before_the_source_counts_too():
    locked = _places({"mode": "pinned", "pinned_option_id": "street"})
    for seed in range(30):
        ctx = _run([_rule(), _poses(), locked], seed)
        assert ctx["pose"] == "standing"


def test_no_narrowing_rolls_exactly_as_before():
    # Nothing narrows Place: backward rules never touch the pose.
    seen = set()
    for seed in range(40):
        ctx = _run([_poses(), _rule(), _places()], seed)
        seen.add(ctx["pose"])
        assert _fits(ctx["pose"], ctx["place"]), seed
    assert seen == {"sitting", "lying", "standing"}


def test_pool_filter_with_chip_variables_narrows_the_pose():
    # Place chips: `$pick_home, $pick_outdoor` → union; only "home" is on.
    places = _places({"category_filter": "$pick_home, $pick_outdoor"})
    for seed in range(60):
        ctx = _run([_poses(), _rule(), places], seed, ctx={"pick_home": "home", "pick_outdoor": ""})
        assert ctx["place"] in {"armchair", "bed"}, seed
        assert ctx["pose"] in {"sitting", "lying"}, seed
        assert _fits(ctx["pose"], ctx["place"]), seed


def test_unset_chip_notes_are_quiet_when_another_chip_narrowed():
    places = _places({"category_filter": "$pick_home, $pick_outdoor"})
    ctx = _run([_poses(), _rule(), places], 3, ctx={"pick_home": "home", "pick_outdoor": ""})
    assert not [w for w in ctx["__wp_warnings__"] if w["type"] == "filter_variable_no_tag"]


def test_option_toggles_narrow_the_pose():
    places = _places({"enabled_options": ["park_bench", "hammock"]})
    seen = set()
    for seed in range(60):
        ctx = _run([_poses(), _rule(), places], seed)
        assert ctx["pose"] in {"sitting", "lying"}, seed
        assert _fits(ctx["pose"], ctx["place"]), seed
        seen.add(ctx["pose"])
    assert seen == {"sitting", "lying"}


def test_match_variable_narrows_the_pose():
    places = _places({"match_variable": "wanted_place"})
    for seed in range(30):
        ctx = _run([_poses(), _rule(), places], seed, ctx={"wanted_place": "Hammock"})
        assert ctx["place"] == "hammock"
        assert ctx["pose"] == "lying"


def test_seed_locked_pose_rolls_inside_what_fits():
    pose = _poses({"locked_seed": 12345})
    locked = _places({"mode": "pinned", "pinned_option_id": "armchair"})
    for seed in range(10):
        ctx = _run([pose, _rule(), locked], seed)
        assert ctx["pose"] == "sitting"


def test_value_locked_pose_is_never_changed_and_the_clash_is_reported():
    pose = _poses({"mode": "pinned", "pinned_option_id": "standing"})
    locked = _places({"mode": "pinned", "pinned_option_id": "bed"})
    ctx = _run([pose, _rule(), locked], 1)
    assert ctx["pose"] == "standing" and ctx["place"] == "bed"
    assert any(w["type"] == "locked_value_conflict" for w in ctx["__wp_warnings__"])


def test_no_fit_without_fallback_rolls_normally_and_warns():
    # Every pose is ruled out (nothing allows "beach"): roll as before.
    locked = _wildcard("plac0001", "place", [_opt("beach", ["sand"])],
                       {"mode": "pinned", "pinned_option_id": "beach"})
    ctx = _run([_poses(), _rule(), locked], 2)
    assert ctx["pose"] in {"sitting", "lying", "standing"}
    assert any(w["type"] == "backward_no_fit" for w in ctx["__wp_warnings__"])


def test_no_fit_takes_the_fallback():
    pose = _poses(extra=[_opt("posing", [], fallback=True, weight=0)])
    locked = _wildcard("plac0001", "place", [_opt("beach", ["sand"])],
                       {"mode": "pinned", "pinned_option_id": "beach"})
    ctx = _run([pose, _rule(), locked], 2)
    assert ctx["pose"] == "posing"


def test_chain_mood_pose_place():
    # mood → pose: "tired" only lies; pose → place locked to the street.
    # Standing is the only pose the street takes, so a tired mood drops out.
    mood = _wildcard("mood0001", "mood", [_opt("tired", ["tired"]), _opt("lively", ["lively"])])
    mood_rule = {
        "type": "constraint", "id": "con00002", "_uid": "con00002",
        "payload": {
            "source_wildcard_id": "mood0001", "target_wildcard_id": "pose0001",
            "matrix": {"tired": {"lie": {"mode": "only", "factor": 1}}},
            "exceptions": [],
        },
        "instance": {},
    }
    locked = _places({"mode": "pinned", "pinned_option_id": "street"})
    for seed in range(40):
        ctx = _run([mood, mood_rule, _poses(), _rule(), locked], seed)
        assert ctx["mood"] == "lively", seed
        assert ctx["pose"] == "standing", seed


def test_reach_first_only_counts_the_covered_instance():
    # Two Place uses; the rule reaches only the first, which is free. The
    # locked second one is not under the rule, so the pose stays free.
    second = _wildcard("plac0001", "place2", _places()["payload"]["options"],
                       {"mode": "pinned", "pinned_option_id": "street"})
    second["_uid"] = "plac0002"
    seen = set()
    for seed in range(40):
        ctx = _run([_poses(), _rule(target_select={"mode": "first"}), _places(), second], seed)
        seen.add(ctx["pose"])
    assert seen == {"sitting", "lying", "standing"}


def test_debug_detail_names_what_was_dropped():
    from engine.modules._detail import EXPLAIN_KEY

    locked = _places({"mode": "pinned", "pinned_option_id": "bed"})
    ctx = _run([_poses(), _rule(), locked], 5, ctx={EXPLAIN_KEY: True})
    pose_row = next(r for r in ctx["__wp_trace__"] if r.get("id") == "pose0001")
    back = (pose_row.get("detail") or {}).get("backward")
    assert back and set(back["removed"]) == {"sitting", "standing"}
    assert back["targets"] == ["place"]
    cuts = {o["id"]: o.get("cut") for o in pose_row["detail"]["options"]}
    assert cuts == {"sitting": "backward", "lying": None, "standing": "backward"}
    assert not any(k in ctx for k in ("__wp_chain__", "__wp_chain_pos__"))


def _writer(var: str, value: str, reads: str | None = None) -> dict:
    """A derivation that sets ``var`` (from ``reads``' value when given)."""
    def act(v: str) -> dict:
        return {"mode": "replace", "target_var": var, "value": v}

    if reads:
        rules = [{"id": "r1", "branches": [
            {"condition": {"var": reads, "op": "equals", "value": "lying"}, "action": act(value)},
        ], "else": {"action": act("seat")}}]
    else:
        rules = [{"id": "r1", "branches": [
            {"condition": {"var": "never_set", "op": "equals", "value": "x"},
             "action": act("seat")},
        ], "else": {"action": act(value)}}]
    return {"type": "derivation", "id": "der00001", "_uid": "der00001",
            "payload": {"rules": rules}, "instance": {}}


def test_filter_variable_set_between_source_and_target_is_looked_ahead():
    places = _places({"category_filter": "$want"})
    for seed in range(40):
        ctx = _run([_poses(), _writer("want", "bed"), _rule(), places], seed)
        assert ctx["place"] in {"bed", "hammock"}, seed
        assert ctx["pose"] == "lying", seed
        assert not [w for w in ctx["__wp_warnings__"] if w["type"] == "backward_late_variable"]


def test_filter_variable_that_depends_on_the_source_is_tried_per_option():
    # want = bed for lying, else seat: lying → beds, sitting → seats, both fit;
    # standing → seats, which only accept sitting, so standing is dropped.
    places = _places({"category_filter": "$want"})
    seen = set()
    for seed in range(60):
        ctx = _run([_poses(), _writer("want", "bed", reads="pose"), _rule(), places], seed)
        assert ctx["pose"] != "standing", seed
        assert _fits(ctx["pose"], ctx["place"]), seed
        assert not [w for w in ctx["__wp_warnings__"] if w["type"] == "backward_late_variable"]
        seen.add(ctx["pose"])
    assert seen == {"sitting", "lying"}


def test_too_many_source_values_to_try_warns(monkeypatch):
    from engine.modules import _backward

    monkeypatch.setattr(_backward, "MAX_ENUM", 1)
    places = _places({"category_filter": "$want"})
    ctx = _run([_poses(), _writer("want", "bed", reads="pose"), _rule(), places], 4)
    assert any(w["type"] == "backward_late_variable" for w in ctx["__wp_warnings__"])


def _need_rule() -> dict:
    """pose → $pose_need: sitting → seat, lying → bed, else street."""
    def act(v: str) -> dict:
        return {"mode": "replace", "target_var": "pose_need", "value": v}

    rules = [{"id": "r1", "branches": [
        {"condition": {"var": "pose", "op": "equals", "value": "sitting"}, "action": act("seat")},
        {"condition": {"var": "pose", "op": "equals", "value": "lying"}, "action": act("bed")},
    ], "else": {"action": act("street")}}]
    return {"type": "derivation", "id": "der00002", "_uid": "der00002",
            "payload": {"rules": rules}, "instance": {}}


def _mirror() -> dict:
    """Takes the option named by $pose_need (Match variable)."""
    return _wildcard("mirr0001", "need_kind", [
        _opt("seat", ["seat"]), _opt("bed", ["bed"]), _opt("street", ["street"]),
    ], {"match_variable": "pose_need"})


def _mirror_rule() -> dict:
    return {
        "type": "constraint", "id": "con00009", "_uid": "con00009",
        "payload": {
            "source_wildcard_id": "mirr0001", "target_wildcard_id": "plac0001",
            "matrix": {k: {k: {"mode": "only", "factor": 1}} for k in ("seat", "bed", "street")},
            "exceptions": [],
        },
        "instance": {},
    }


def test_rule_and_mirror_between_pose_and_place():
    # The WP Parts chain: no constraint from the pose itself. The pose sets
    # $pose_need through a rule, a mirror matches it, the mirror rules the
    # place. Only beds are left, so the pose must be the one that needs a bed.
    beds = _places({"category_filter": "bed"})
    for seed in range(40):
        ctx = _run([_poses(), _need_rule(), _mirror(), _mirror_rule(), beds], seed)
        assert ctx["pose"] == "lying", seed
        assert ctx["need_kind"] == "bed", seed
        assert ctx["place"] in {"bed", "hammock"}, seed


def test_rule_and_mirror_with_nothing_narrowed_rolls_as_before():
    plain = [_poses(), _need_rule(), _mirror(), _mirror_rule(), _places()]
    seen = {_run(plain, seed)["pose"] for seed in range(40)}
    assert seen == {"sitting", "lying", "standing"}
