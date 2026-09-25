"""`only` constraint rule — linked picks, end to end.

`only` turns its row into an allow-list: when the source fires, a target with
no rule of its own in that row drops out. On an exception it links literal
values ("maid" forces "frilled apron"); in a matrix row it links tags. The
pure fold is covered by the shared corpus; these pin what a run produces.
"""
from __future__ import annotations

import pytest

from engine.modules._keys import encode_key
from engine.modules.constraint_handler import ConstraintHandler
from engine.pipeline import PipelineEngine


def _wildcard(uid: str, binding: str, options: list[dict], **extra) -> dict:
    return {
        "type": "wildcard", "id": uid, "_uid": uid,
        "payload": {"var_binding": binding, "options": options, **extra},
        "instance": {"variable_binding": binding},
    }


def _opt(value: str, tags: list[str] | None = None) -> dict:
    return {"id": value.replace(" ", "_"), "value": value, "weight": 1,
            "sub_categories": tags or []}


def _constraint(matrix: dict, exceptions: list[dict], instance: dict | None = None) -> dict:
    return {
        "type": "constraint", "id": "con00001", "_uid": "con00001",
        "payload": {"source_wildcard_id": "src00001",
                    "target_wildcard_id": "tgt00001",
                    "matrix": matrix, "exceptions": exceptions},
        "instance": instance or {},
    }


def _link(src: str, tgt: str, mode: str = "only", factor: float = 1.0) -> dict:
    return {"source_value": src, "target_value": tgt, "mode": mode, "factor": factor}


_ROLES = ["maid", "biker"]
_OUTFITS = ["frilled apron", "leather jacket", "sundress", "tracksuit", "kimono"]


def _roles(values=_ROLES):
    return _wildcard("src00001", "role", [_opt(v) for v in values])


def _outfits(values=_OUTFITS, **extra):
    return _wildcard("tgt00001", "outfit", [_opt(v) for v in values], **extra)


def _run(modules, seed):
    return PipelineEngine().run(modules, seed=seed)


def test_value_link_forces_the_linked_target():
    # One `only` exception is the whole link: no exclude row per other outfit.
    con = _constraint({}, [_link("maid", "frilled apron")])
    seen = set()
    for seed in range(40):
        ctx = _run([_roles(), con, _outfits()], seed)
        seen.add(ctx["role"])
        if ctx["role"] == "maid":
            assert ctx["outfit"] == "frilled apron", seed
    assert seen == {"maid", "biker"}


def test_value_link_leaves_an_unlinked_source_value_free():
    con = _constraint({}, [_link("maid", "frilled apron")])
    outfits = set()
    for seed in range(60):
        ctx = _run([_roles(["biker"]), con, _outfits()], seed)
        outfits.add(ctx["outfit"])
    assert len(outfits) > 1


def test_value_link_covers_target_options_added_later():
    # The reason `only` exists: an exclude-per-option link silently lets a
    # newly added outfit through. `only` shuts out anything unmentioned.
    con = _constraint({}, [_link("maid", "frilled apron")])
    grown = _outfits(_OUTFITS + ["space suit", "wetsuit"])
    for seed in range(40):
        ctx = _run([_roles(["maid"]), con, grown], seed)
        assert ctx["outfit"] == "frilled apron", seed


def test_value_link_to_several_targets_picks_among_them():
    con = _constraint({}, [_link("maid", "frilled apron"), _link("maid", "kimono")])
    outfits = set()
    for seed in range(60):
        ctx = _run([_roles(["maid"]), con, _outfits()], seed)
        outfits.add(ctx["outfit"])
    assert outfits == {"frilled apron", "kimono"}


_SEASONS = ["summer", "winter"]
_SHOE_TAGS = ["open", "closed"]


def _tag_link_matrix():
    return {"summer": {"open": {"mode": "only", "factor": 1.0}},
            "winter": {"closed": {"mode": "only", "factor": 1.0}}}


def test_tag_link_forces_options_carrying_the_linked_tag():
    src = _wildcard("src00001", "season",
                    [_opt("beach day", ["summer"]), _opt("ski trip", ["winter"])],
                    sub_categories=_SEASONS)
    tgt = _wildcard("tgt00001", "shoes",
                    [_opt("sandals", ["open"]), _opt("flip flops", ["open"]),
                     _opt("boots", ["closed"]), _opt("socks")],
                    sub_categories=_SHOE_TAGS)
    con = _constraint(_tag_link_matrix(), [])
    for seed in range(40):
        ctx = _run([src, con, tgt], seed)
        if ctx["season"] == "beach day":
            assert ctx["shoes"] in {"sandals", "flip flops"}, seed
        else:
            assert ctx["shoes"] == "boots", seed


def test_tag_link_pins_a_target_accepts_roll():
    # A target option offering both tags survives the link and its own roll is
    # restricted to the linked tag, so $shoes.STYLE agrees with the season.
    src = _wildcard("src00001", "season", [_opt("beach day", ["summer"])],
                    sub_categories=_SEASONS)
    tgt = _wildcard("tgt00001", "shoes", [_opt("any shoe", ["open", "closed"])],
                    sub_categories=_SHOE_TAGS,
                    tag_groups={"STYLE": _SHOE_TAGS},
                    tag_group_kinds={"STYLE": "accepts"})
    con = _constraint(_tag_link_matrix(), [])
    for seed in range(24):
        ctx = _run([src, con, tgt], seed)
        assert ctx["__wp_axes__"]["shoes"]["STYLE"] == "open", seed


def test_value_link_does_not_unpin_a_tag_link_in_the_same_constraint():
    # The axis-menu probe carries no real value. A value-level `only` must not
    # shut the probe out (which would leave the menu unrestricted).
    src = _wildcard("src00001", "season", [_opt("beach day", ["summer"])],
                    sub_categories=_SEASONS)
    tgt = _wildcard("tgt00001", "shoes", [_opt("any shoe", ["open", "closed"])],
                    sub_categories=_SHOE_TAGS,
                    tag_groups={"STYLE": _SHOE_TAGS},
                    tag_group_kinds={"STYLE": "accepts"})
    con = _constraint(_tag_link_matrix(), [_link("beach day", "any shoe")])
    for seed in range(24):
        ctx = _run([src, con, tgt], seed)
        assert ctx["shoes"] == "any shoe"
        assert ctx["__wp_axes__"]["shoes"]["STYLE"] == "open", seed


def test_instance_can_override_a_cell_to_only():
    # An instance-only cell: no library rule, the canvas editor sets `only`.
    con = _constraint({}, [], instance={
        "cell_mode_overrides": {encode_key(["summer", "open"]): "only"},
    })
    src = _wildcard("src00001", "season", [_opt("beach day", ["summer"])],
                    sub_categories=_SEASONS)
    tgt = _wildcard("tgt00001", "shoes",
                    [_opt("sandals", ["open"]), _opt("boots", ["closed"])],
                    sub_categories=_SHOE_TAGS)
    for seed in range(20):
        assert _run([src, con, tgt], seed)["shoes"] == "sandals", seed


@pytest.mark.parametrize("where", ["matrix", "exception"])
def test_only_is_a_valid_mode(where):
    payload = {"source_wildcard_id": "a", "target_wildcard_id": "b",
               "matrix": {}, "exceptions": []}
    if where == "matrix":
        payload["matrix"] = {"x": {"y": {"mode": "only", "factor": 1.0}}}
    else:
        payload["exceptions"] = [_link("x", "y")]
    ConstraintHandler.validate_payload(payload)


def test_legacy_neutral_cell_override_reads_as_allow():
    # Canvas builds before this change stored a neutral override as "neutral",
    # which the engine rejected, failing the whole constraint. It now reads as
    # `allow`, so the library exclude it overrode is lifted.
    src = _wildcard("src00001", "season", [_opt("beach day", ["summer"])],
                    sub_categories=_SEASONS)
    tgt = _wildcard("tgt00001", "shoes", [_opt("boots", ["closed"])],
                    sub_categories=_SHOE_TAGS)
    key = encode_key(["summer", "closed"])
    con = _constraint({"summer": {"closed": {"mode": "exclude", "factor": 0.0}}}, [],
                      instance={"cell_mode_overrides": {key: "neutral"}})
    ctx = _run([src, con, tgt], 3)
    assert not [w for w in ctx.get("__wp_warnings__", []) if w.get("type") == "handler_error"]
    assert ctx["shoes"] == "boots"
