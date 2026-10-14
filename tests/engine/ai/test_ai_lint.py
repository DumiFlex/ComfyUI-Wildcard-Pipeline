"""Coherence checks on chat proposals (engine/ai/lint.py)."""
from __future__ import annotations

from engine.ai import lint


def _wc(name, values, var="", **extra):
    return {"type": "wildcard", "name": name, "payload": {
        "var_binding": var, "options": [
            {"id": f"o{i}", "value": v, "weight": 1, **extra.get(v, {})}
            for i, v in enumerate(values)]}}


def _none(_id):
    return None


CREATE = {"op": "create"}


def test_concept_from_name():
    assert lint.concept_of("Pose") == "pose"
    assert lint.concept_of("Presenting poses") == "pose"
    assert lint.concept_of("Hair colour") == "hair"
    assert lint.concept_of("Scene") == ""
    # Two concepts in one name mix on purpose.
    assert lint.concept_of("Hair and outfit") == ""


def test_pose_with_camera_and_body_warns():
    item = _wc("Pose", ["standing", "close-up, sitting", "full body, kneeling",
                        "lying down, large breasts", "squatting, thick thighs", "arms up"])
    out = lint.check(CREATE, item, _none)
    assert any("camera" in w for w in out)
    assert any("body" in w for w in out)


def test_presenting_pose_stays_quiet():
    item = _wc("Presenting pose", ["looking back over shoulder", "hand on thigh",
                                   "bent over, ass view", "hand on hip", "smiling, waving"])
    assert lint.check(CREATE, item, _none) == []


def test_mixed_name_is_not_checked():
    item = _wc("Character", ["red hair, close-up", "blue dress, full body", "long hair"])
    assert lint.check(CREATE, item, _none) == []


def test_edit_only_checks_added_options():
    base = _wc("Pose", ["standing", "close-up, sitting", "full body, kneeling"])
    same_plus = _wc("Pose", ["standing", "close-up, sitting", "full body, kneeling",
                             "arms crossed"])
    assert lint.check({"op": "update"}, same_plus, _none, base) == []
    bad = _wc("Pose", ["standing", "close-up, sitting", "full body, kneeling",
                       "upper body, arms crossed", "wide shot, running"])
    assert any("camera" in w for w in lint.check({"op": "update"}, bad, _none, base))


def test_duplicates_and_weights():
    item = _wc("Weather", ["rain", "Rain", "sun"])
    assert any("more than once" in w for w in lint.check(CREATE, item, _none))
    heavy = _wc("Weather", ["rain", "sun"], **{"rain": {"weight": 100}, "sun": {"weight": 1}})
    assert any("weights run from" in w for w in lint.check(CREATE, heavy, _none))


def test_derivation_lookup_table():
    branches = [{"condition": {"var": "hair", "op": "equals", "value": v},
                 "action": {"target_var": "eyes", "mode": "replace", "value": v + " eyes"}}
                for v in ("red", "blue", "green", "gold", "black")]
    item = {"type": "derivation", "name": "Eyes from hair",
            "payload": {"rules": [{"id": "r1", "branches": branches}]}}
    out = lint.check(CREATE, item, _none)
    assert out and "$hair to $eyes" in out[0] and "constraint" in out[0]
    item["payload"]["rules"][0]["branches"] = branches[:3]
    assert lint.check(CREATE, item, _none) == []


def test_constraint_needs_fallback_on_target():
    target = _wc("Outfit", ["coat", "shirt"])
    target["id"] = "t1"
    rows = {"t1": target}
    item = {"type": "constraint", "name": "Season → Outfit", "payload": {
        "source_wildcard_id": "s1", "target_wildcard_id": "t1",
        "exceptions": [{"source": "summer", "target": "coat", "mode": "exclude"}]}}
    out = lint.check(CREATE, item, rows.get)
    assert out and "fallback" in out[0]
    target["payload"]["options"][1]["fallback"] = True
    assert lint.check(CREATE, item, rows.get) == []
    item["payload"]["exceptions"][0]["mode"] = "reduce"
    target["payload"]["options"][1].pop("fallback")
    assert lint.check(CREATE, item, rows.get) == []
