"""Scenario tests: how modules interact at run time, many seeds each.

Each test builds a small realistic pack (wildcards, constraints, derivations,
combines, fixed values, bundles, nodes), runs it over 100+ seeds and checks
the rendered Assembler prompt + negative and the variables, the way a user
would see them. Unit tests cover each feature alone; these cover the seams.

Tests marked ``xfail(strict=True)`` document a real engine bug: the assertion
states the documented behaviour and fails today. Each reason names the cause.
"""
from __future__ import annotations

import copy
import json
from collections import Counter
from typing import Any

import pytest

from engine import negatives
from engine.pipeline import PipelineEngine
from engine.syntax.types import ListVar
from wp_nodes.assembler_node import WPPromptAssembler
from wp_nodes.context_loop import WPContextLoop
from wp_nodes.context_node import WPContext
from wp_nodes.model_info_node import WPModelInfo
from wp_nodes.types import ContextPayload, build_payload

SEEDS = range(150)
NODE_SEEDS = range(100)


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """WP_Context looks up nested refs in the live library; keep it off the
    developer's real DB."""
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "wp.db"))


# ── builders ────────────────────────────────────────────────────────────


def _opt(value: str, *tags: str, w: float = 1.0, oid: str | None = None, **extra: Any) -> dict:
    return {"id": oid or value.replace(" ", "_"), "value": value, "weight": w,
            "sub_categories": list(tags), **extra}


def _null(**extra: Any) -> dict:
    return {"id": "none", "value": "", "is_null": True, "weight": 1.0, **extra}


def _wc(uid: str, binding: str, options: list[dict], *, subs: list[str] | None = None,
        groups: dict | None = None, kinds: dict | None = None, row: str | None = None,
        origin: str | None = None, **instance: Any) -> dict:
    payload: dict[str, Any] = {"var_binding": binding, "options": options}
    tags = subs if subs is not None else sorted(
        {t for o in options for t in o.get("sub_categories") or []})
    if tags:
        payload["sub_categories"] = tags
    if groups:
        payload["tag_groups"] = groups
    if kinds:
        payload["tag_group_kinds"] = kinds
    m = {"type": "wildcard", "id": uid, "_uid": row or f"row-{uid}", "enabled": True,
         "name": binding, "payload": payload,
         "instance": {"variable_binding": binding, **instance}}
    if origin:
        m["bundle_origin"] = origin
    return m


def _con(uid: str, src: str, tgt: str, *, matrix: dict | None = None,
         exceptions: list[dict] | None = None, row: str | None = None,
         origin: str | None = None, **instance: Any) -> dict:
    m = {"type": "constraint", "id": uid, "_uid": row or f"row-{uid}", "enabled": True,
         "payload": {"source_wildcard_id": src, "target_wildcard_id": tgt,
                     "matrix": matrix or {}, "exceptions": exceptions or []},
         "instance": instance}
    if origin:
        m["bundle_origin"] = origin
    return m


def _exc(src: str, tgt: str, mode: str = "exclude", factor: float = 1.0) -> dict:
    return {"source_value": src, "target_value": tgt, "mode": mode, "factor": factor}


def _cell(mode: str = "exclude", factor: float = 1.0) -> dict:
    return {"mode": mode, "factor": factor}


def _combine(uid: str, out: str, template: str, *, negative: str | None = None,
             origin: str | None = None, **instance: Any) -> dict:
    payload: dict[str, Any] = {"output_var": out, "template": template}
    if negative is not None:
        payload["negative"] = negative
    m = {"type": "combine", "id": uid, "_uid": f"row-{uid}", "enabled": True,
         "payload": payload, "instance": instance}
    if origin:
        m["bundle_origin"] = origin
    return m


def _act(target: str, mode: str, value: str) -> dict:
    return {"target_var": target, "mode": mode, "value": value}


def _cond(var: str, op: str, value: str = "") -> dict:
    return {"var": var, "op": op, "value": value}


def _branch(cond: dict, *actions: dict) -> dict:
    b: dict[str, Any] = {"condition": cond, "action": actions[0]}
    if len(actions) > 1:
        b["extra_actions"] = list(actions[1:])
    return b


def _else(*actions: dict) -> dict:
    e: dict[str, Any] = {"action": actions[0]}
    if len(actions) > 1:
        e["extra_actions"] = list(actions[1:])
    return e


def _rule(rid: str, *branches: dict, otherwise: dict | None = None) -> dict:
    r: dict[str, Any] = {"id": rid, "branches": list(branches)}
    if otherwise is not None:
        r["else"] = otherwise
    return r


def _deriv(uid: str, *rules: dict, **instance: Any) -> dict:
    return {"type": "derivation", "id": uid, "_uid": f"row-{uid}", "enabled": True,
            "payload": {"rules": list(rules)}, "instance": instance}


def _fixed(uid: str, rows: list[dict], **instance: Any) -> dict:
    return {"type": "fixed_values", "id": uid, "_uid": f"row-{uid}", "enabled": True,
            "payload": {"values": rows}, "instance": instance}


def _catalog(*wildcards: dict) -> dict:
    return {w["id"]: {"id": w["id"], "type": "wildcard", "name": w["name"],
                      "payload": w["payload"]} for w in wildcards}


# ── runners ─────────────────────────────────────────────────────────────


def _run(modules: list[dict], seed: int, catalog: dict | None = None,
         **pins: Any) -> dict:
    """One Context's engine run. Modules are deep-copied per run so a
    handler that stamps a module dict can't leak into the next seed."""
    ctx: dict[str, Any] = {**pins, "__wp_catalog__": catalog or {}}
    return PipelineEngine().run(copy.deepcopy(modules), ctx=ctx, seed=seed)


def _payload(ctx: dict, seed: int = 0) -> ContextPayload:
    return build_payload(ctx, {}, seed)


def _assemble(source: dict | ContextPayload, template: str,
              negative_template: str = "") -> tuple[str, str]:
    """Render through the real WP_PromptAssembler, across the socket."""
    payload = source if isinstance(source, ContextPayload) else _payload(source)
    out = WPPromptAssembler.execute(
        context=payload, template=template, negative_template=negative_template,
    )
    prompt, negative = out.values
    return prompt, negative


def _node(modules: list[dict], seed: int, upstream: ContextPayload | None = None,
          bundles: list[dict] | None = None) -> ContextPayload:
    """One WP_Context node run (catalog built from its own wildcards)."""
    widget: dict[str, Any] = {"version": 1, "modules": modules}
    if bundles is not None:
        widget["bundles"] = bundles
    return WPContext.execute(
        seed=seed, wp_modules=json.dumps(widget), upstream=upstream,
    ).values[0]


def _warn_types(ctx: dict) -> list[str]:
    return [str(w.get("type")) for w in ctx.get("__wp_warnings__") or []]


def _neg_texts(ctx: dict, name: str) -> list[str]:
    return [str(e.get("text")) for e in negatives.get_entries(ctx, name)]


def _assert_tidy(prompt: str) -> None:
    assert "  " not in prompt, prompt
    assert ", ," not in prompt and ",," not in prompt, prompt
    assert not prompt.startswith((",", " ")), prompt
    assert not prompt.endswith((",", " ")), prompt


# ── 1. nested @{uuid} refs + tag filters + a constraint on the nested wildcard ─

COLOR = "c01a0001"
SEASON = "5ea50001"
OUTFIT = "0f170001"
COLOR_FB = "c01a0002"


def _color(uid: str = COLOR, fallback: bool = False) -> dict:
    opts = [_opt("red", "warm"), _opt("orange", "warm"),
            _opt("blue", "cool"), _opt("teal", "cool")]
    if fallback:
        # A warm-tagged fallback, so a `:warm` filter keeps it available.
        opts.append(_opt("beige", "warm", w=0.0, fallback=True))
    return _wc(uid, "color", opts)


_SEASON_TO_COLOR = {"hot": {"cool": _cell()}, "cold": {"warm": _cell()}}


def _season() -> dict:
    return _wc(SEASON, "season", [_opt("summer", "hot"), _opt("winter", "cold")])


def test_nested_filtered_ref_obeys_a_constraint_on_the_nested_wildcard():
    color = _color()
    outfit = _wc(OUTFIT, "outfit", [
        _opt(f"@{{{COLOR}:warm}} sundress", oid="dress"),
        _opt(f"@{{{COLOR}}} coat", oid="coat"),
    ])
    stack = [_season(), _con("c0a50001", SEASON, COLOR, matrix=_SEASON_TO_COLOR), outfit]
    seen: Counter[tuple[str, str]] = Counter()
    for seed in SEEDS:
        ctx = _run(stack, seed, _catalog(color))
        prompt, _ = _assemble(ctx, "a woman in a $outfit, $season")
        _assert_tidy(prompt)
        season, outfit_v = ctx["season"], ctx["outfit"]
        word, _, piece = outfit_v.rpartition(" ")
        seen[(season, piece)] += 1
        if season == "summer":
            assert word in {"red", "orange"}, (seed, outfit_v)
        elif piece == "coat":
            assert word in {"blue", "teal"}, (seed, outfit_v)
        else:
            # Winter + a warm-only filter: the constraint shuts out the whole
            # filtered pool, the ref comes out empty and the gap closes.
            assert outfit_v == "sundress", (seed, outfit_v)
            assert "constraint_excludes_all_options" in _warn_types(ctx), seed
            assert prompt == "a woman in a sundress, winter"
    assert set(seen) == {("summer", "sundress"), ("summer", "coat"),
                         ("winter", "sundress"), ("winter", "coat")}


def test_nested_fallback_stands_in_when_a_constraint_empties_the_filtered_pool():
    color = _color(COLOR_FB, fallback=True)
    outfit = _wc(OUTFIT, "outfit", [_opt(f"@{{{COLOR_FB}:warm}} sundress", oid="dress")])
    stack = [_season(), _con("c0a50002", SEASON, COLOR_FB, matrix=_SEASON_TO_COLOR), outfit]
    for seed in SEEDS:
        ctx = _run(stack, seed, _catalog(color))
        types = _warn_types(ctx)
        if ctx["season"] == "winter":
            assert ctx["outfit"] == "beige sundress", seed
            assert "fallback_used" in types
            assert "constraint_excludes_all_options" not in types
        else:
            # Weight 0: the fallback only ever stands in.
            assert ctx["outfit"] in {"red sundress", "orange sundress"}, seed
            assert "fallback_used" not in types


def test_nested_ref_reach_first_constrains_only_the_first_occurrence():
    # Two nested occurrences of the same color wildcard in one option; a
    # `first` reach re-weights the first only.
    color = _color()
    outfit = _wc(OUTFIT, "outfit", [_opt(f"@{{{COLOR}}} top, @{{{COLOR}}} skirt", oid="o")])
    con = _con("c0a50003", SEASON, COLOR, matrix=_SEASON_TO_COLOR,
               target_select={"mode": "first"})
    second_free: set[str] = set()
    for seed in SEEDS:
        ctx = _run([_wc(SEASON, "season", [_opt("summer", "hot")]), con, outfit],
                   seed, _catalog(color))
        top, skirt = ctx["outfit"].replace(" top", "").split(", ")
        assert top in {"red", "orange"}, (seed, ctx["outfit"])
        second_free.add(skirt.replace(" skirt", ""))
    assert {"blue", "teal"} & second_free


# ── 2. accepts axes + constraints + `$x.AXIS` in a combine ────────────────

SHOE_TAGS = ["sandals", "sneakers", "heels"]
OUTFIT_SRC = "a0a00001"
SHOES_TGT = "b0b00001"


def _accepts_wc(uid: str, binding: str, options: list[dict], **instance: Any) -> dict:
    return _wc(uid, binding, options, subs=SHOE_TAGS + ["formal", "casual"],
               groups={"SHOES": SHOE_TAGS, "STYLE": ["formal", "casual"]},
               kinds={"SHOES": "accepts", "STYLE": "classify"}, **instance)


def _diagonal() -> dict:
    return {s: {t: _cell() for t in SHOE_TAGS if t != s} for s in SHOE_TAGS}


def test_accepts_axes_agree_across_a_diagonal_and_read_back_in_a_combine():
    outfit = _accepts_wc(OUTFIT_SRC, "outfit", [
        _opt("summer dress", "sandals", "sneakers", "casual"),
        _opt("party dress", "heels", "sandals", "formal"),
        _opt("track suit", "sneakers", "casual"),
    ])
    shoes = _accepts_wc(SHOES_TGT, "shoes", [
        _opt("strappy sandals", "sandals"),
        _opt("white sneakers", "sneakers"),
        _opt("red heels", "heels"),
        _opt("ballet flats", "sandals", "heels"),
    ])
    look = _combine("c0b00001", "look", "$outfit with $outfit.SHOES ($shoes)")
    stack = [outfit, _con("c0c00001", OUTFIT_SRC, SHOES_TGT, matrix=_diagonal()), shoes, look]
    rolled: Counter[str] = Counter()
    for seed in SEEDS:
        ctx = _run(stack, seed)
        axes = ctx["__wp_axes__"]
        src_axis, tgt_axis = axes["outfit"]["SHOES"], axes["shoes"]["SHOES"]
        assert src_axis == tgt_axis, seed
        tgt_opt = next(o for o in shoes["payload"]["options"] if o["value"] == ctx["shoes"])
        assert tgt_axis in tgt_opt["sub_categories"], seed
        assert ctx["look"] == f"{ctx['outfit']} with {src_axis} ({ctx['shoes']})"
        # The accessor survives the socket into the Assembler.
        prompt, _ = _assemble(ctx, "$look, $shoes.SHOES shoes")
        assert prompt == f"{ctx['look']}, {tgt_axis} shoes"
        rolled[src_axis] += 1
    assert set(rolled) == set(SHOE_TAGS)


def test_accepts_axis_read_in_a_derivation_condition_matches_the_combine():
    outfit = _accepts_wc(OUTFIT_SRC, "outfit", [
        _opt("summer dress", "sandals", "sneakers", "casual"),
        _opt("gala gown", "heels", "formal"),
    ])
    d = _deriv("d0d00001", _rule(
        "r1", _branch(_cond("outfit.SHOES", "equals", "heels"),
                      _act("walk", "replace", "careful steps on $outfit.SHOES")),
        otherwise=_else(_act("walk", "replace", "a brisk walk in $outfit.SHOES")),
    ))
    for seed in SEEDS:
        ctx = _run([outfit, d], seed)
        axis = ctx["__wp_axes__"]["outfit"]["SHOES"]
        want = ("careful steps on heels" if axis == "heels"
                else f"a brisk walk in {axis}")
        assert ctx["walk"] == want, seed


# ── 3. derivation chain: constrained pick → derivation → derivation ──────

WEATHER = "3ea70001"
ACTIVITY = "ac710001"


def _weather_stack() -> list[dict]:
    weather = _wc(WEATHER, "weather", [_opt("rain", "wet"), _opt("sunshine", "dry")])
    activity = _wc(ACTIVITY, "activity", [
        _opt("reading indoors", "indoor", negative="outdoors"),
        _opt("a picnic", "outdoor", negative="indoors"),
        _opt("cycling", "outdoor"),
    ])
    con = _con("c0d00001", WEATHER, ACTIVITY,
               matrix={"wet": {"indoor": _cell("only")}, "dry": {"indoor": _cell()}})
    d1 = _deriv("d1d10001", _rule(
        "r1",
        _branch(_cond("activity", "equals", "reading indoors"),
                _act("setting", "replace", "a cozy library"),
                _act("setting", "negative", "sunlight, beach"),
                _act("mood", "replace", "calm, $setting")),
        otherwise=_else(_act("setting", "replace", "a sunny park"),
                        _act("mood", "replace", "cheerful")),
    ))
    d2 = _deriv("d2d20001", _rule(
        "r1",
        _branch(_cond("setting", "contains", "library"),
                _act("light", "replace", "warm lamp light"),
                _act("light", "negative", "harsh sun")),
        otherwise=_else(_act("light", "replace", "bright daylight")),
    ))
    return [weather, con, activity, d1, d2]


def test_derivations_follow_a_constrained_pick_and_feed_each_other():
    stack = _weather_stack()
    seen: set[str] = set()
    for seed in SEEDS:
        ctx = _run(stack, seed)
        weather, activity = ctx["weather"], ctx["activity"]
        if weather == "rain":
            assert activity == "reading indoors", seed
        else:
            assert activity in {"a picnic", "cycling"}, seed
        indoors = activity == "reading indoors"
        assert ctx["setting"] == ("a cozy library" if indoors else "a sunny park")
        # The later action read the earlier one's write.
        assert ctx["mood"] == ("calm, a cozy library" if indoors else "cheerful")
        assert ctx["light"] == ("warm lamp light" if indoors else "bright daylight")
        prompt, neg = _assemble(ctx, "$activity in $setting, $light, $mood",
                                "lowres, $negatives")
        _assert_tidy(prompt)
        assert prompt == f"{activity} in {ctx['setting']}, {ctx['light']}, {ctx['mood']}"
        if indoors:
            # activity's own + setting's "Add to negative" + light's; `$mood`
            # read `$setting`, so it carries setting's (deduped).
            assert neg == "lowres, outdoors, sunlight, beach, harsh sun", seed
        elif activity == "a picnic":
            assert neg == "lowres, indoors", seed
        else:
            assert neg == "lowres", seed
        # Follow usage: an Assembler that skips $setting drops its words.
        _, light_only = _assemble(ctx, "$light")
        assert light_only == ("harsh sun" if indoors else "")
        seen.add(activity)
    assert seen == {"reading indoors", "a picnic", "cycling"}


@pytest.mark.xfail(strict=True, reason=(
    "derivation_handler.py resolve(): action values resolve against "
    "`resolve_ctx`, a snapshot of the vars taken when the module starts "
    "(build_resolve_ctx copies `_vars`), while conditions read the live ctx. "
    "So a later rule in the SAME derivation sees an earlier rule's write in "
    "its condition but reads the stale value in its action: `$setting` "
    "renders empty (unknown_var)."
))
def test_a_later_rule_action_reads_an_earlier_rules_write_in_the_same_module():
    d = _deriv("d3d30001",
               _rule("r1", _branch(_cond("activity", "equals", "reading indoors"),
                                   _act("setting", "replace", "a cozy library"))),
               _rule("r2", _branch(_cond("setting", "contains", "library"),
                                   _act("light", "replace", "lamp light in $setting"))))
    activity = _wc(ACTIVITY, "activity", [_opt("reading indoors")])
    for seed in range(20):
        ctx = _run([activity, d], seed)
        assert ctx["setting"] == "a cozy library"
        assert ctx["light"] == "lamp light in a cozy library", ctx["light"]


# ── 4. internal variables drive logic but never print ────────────────────

LKEY = "1ee10001"
LIGHT = "1ee10002"


def test_internal_variable_drives_a_derivation_and_a_constraint_but_never_prints():
    key = _wc(LKEY, "lkey", [_opt("K1", "soft"), _opt("K2", "hard")], internal=True)
    light = _wc(LIGHT, "lamp", [_opt("paper lantern", "diffuse"),
                                _opt("bare bulb", "point")])
    con = _con("c0e00001", LKEY, LIGHT, matrix={"soft": {"point": _cell()},
                                               "hard": {"diffuse": _cell()}})
    d = _deriv("d4d40001", _rule(
        "r1", _branch(_cond("lkey", "equals", "K1"),
                      _act("lighting", "replace", "soft rim light")),
        otherwise=_else(_act("lighting", "replace", "hard noon sun")),
    ))
    seen: set[str] = set()
    for seed in SEEDS:
        ctx = _run([key, con, light, d], seed)
        soft = ctx["lkey"] == "K1"
        assert ctx["lamp"] == ("paper lantern" if soft else "bare bulb"), seed
        prompt, _ = _assemble(ctx, "portrait, $lkey, $lighting, $lamp")
        assert "K1" not in prompt and "K2" not in prompt
        assert prompt == f"portrait, {ctx['lighting']}, {ctx['lamp']}"
        seen.add(ctx["lkey"])
    assert seen == {"K1", "K2"}


def test_internal_variable_crosses_the_socket_and_drives_the_next_context():
    key = _wc(LKEY, "lkey", [_opt("K1"), _opt("K2")], internal=True)
    d = _deriv("d5d50001", _rule(
        "r1", _branch(_cond("lkey", "equals", "K1"), _act("tone", "replace", "pastel")),
        otherwise=_else(_act("tone", "replace", "noir")),
    ))
    for seed in NODE_SEEDS:
        first = _node([key], seed)
        assert first.context["lkey"] in {"K1", "K2"}
        second = _node([d], seed + 1, upstream=first)
        want = "pastel" if first.context["lkey"] == "K1" else "noir"
        assert second.context["tone"] == want
        prompt, _ = _assemble(second, "$lkey $tone palette")
        assert prompt == f"{want} palette"


def test_public_rewrite_of_an_internal_variable_makes_it_print():
    key = _wc(LKEY, "lkey", [_opt("K1")], internal=True)
    d = _deriv("d6d60001", _rule(
        "r1", _branch(_cond("lkey", "exists"), _act("lkey", "append", " (shown)"))))
    for seed in range(20):
        ctx = _run([key, d], seed)
        assert _assemble(ctx, "[$lkey]")[0] == "[K1 (shown)]"


# ── 5. hold across a Context Loop, $iteration driving the pose ───────────

FRAME = "f2a30001"
POSE = "9e5e0001"
HELD = "4e1d0001"
HELD_COLOR = "4e1d0002"


def _loop(seed: int, count: int) -> list[ContextPayload]:
    return WPContextLoop.execute(
        seed=seed, count=count, wp_context_loop_config=json.dumps({}),
    ).values[0]


def test_iteration_drives_the_pose_while_a_held_outfit_stays_put():
    color = _wc(HELD_COLOR, "tint", [_opt("green"), _opt("navy"), _opt("rust")])
    held = _wc(HELD, "outfit", [_opt(f"@{{{HELD_COLOR}}} jeans", oid="j"),
                                _opt(f"@{{{HELD_COLOR}}} skirt", oid="s")],
               seed_scope="hold")
    # Pose via a derivation on $iteration; camera via match_variable on it.
    d = _deriv("d7d70001", _rule(
        "r1",
        _branch(_cond("iteration", "equals", "1"), _act("pose", "replace", "standing")),
        _branch(_cond("iteration", "equals", "2"), _act("pose", "replace", "sitting")),
        otherwise=_else(_act("pose", "replace", "walking")),
    ))
    camera = _wc(FRAME, "camera", [_opt("1", oid="c1"), _opt("2", oid="c2"),
                                   _opt("wide", oid="c3", fallback=True)],
                 match_variable="iteration")
    # A free wildcard keeps varying, so "held" is not just "the seed is constant".
    free = _wc(POSE, "expression", [_opt(f"smile {i}") for i in range(12)])
    mods = [color, held, d, camera, free]
    varied = 0
    for seed in range(40):
        frames = _loop(seed, 4)
        outs = [_node(mods, seed, upstream=f) for f in frames]
        outfits = {o.context["outfit"] for o in outs}
        assert len(outfits) == 1, (seed, outfits)
        assert [o.context["pose"] for o in outs] == ["standing", "sitting", "walking", "walking"]
        assert [o.context["camera"] for o in outs] == ["1", "2", "wide", "wide"]
        prompts = [_assemble(o, "$iteration $pose, $outfit, $camera shot")[0] for o in outs]
        # $iteration is internal by default.
        assert prompts[0] == f"standing, {outs[0].context['outfit']}, 1 shot"
        varied += len({o.context["expression"] for o in outs}) > 1
    assert varied >= 35, varied


def test_iteration_matched_source_constrains_an_unheld_target_per_frame():
    frame = _wc(FRAME, "frame", [_opt("1", "close"), _opt("2", "far"), _opt("3", "far")],
                match_variable="iteration")
    pose = _wc(POSE, "pose", [_opt("headshot", "portrait"), _opt("full body", "body"),
                              _opt("over the shoulder", "portrait")])
    con = _con("c0f00001", FRAME, POSE, matrix={"close": {"body": _cell()},
                                               "far": {"portrait": _cell()}})
    for seed in range(40):
        outs = [_node([frame, con, pose], seed, upstream=f) for f in _loop(seed, 3)]
        assert outs[0].context["pose"] in {"headshot", "over the shoulder"}
        assert outs[1].context["pose"] == "full body"
        assert outs[2].context["pose"] == "full body"


@pytest.mark.xfail(strict=True, reason=(
    "pipeline.py PipelineEngine.run hold base pass: it re-runs the chain at "
    "loop_index=0 on a deepcopy of THIS frame's ctx, so upstream per-frame "
    "inputs ($iteration, and the pick a match_variable source makes from it) "
    "are frame k's, not frame 0's. A held wildcard targeted by a constraint "
    "whose source follows $iteration is re-resolved under frame k's "
    "constraint and changes every frame, contrary to the docs ('a "
    "constrained wildcard keeps its option even as the constraint reshapes "
    "the pool')."
))
def test_held_target_of_an_iteration_driven_constraint_stays_put():
    frame = _wc(FRAME, "pose", [_opt("1", "sit"), _opt("2", "stand"), _opt("3", "stand")],
                match_variable="iteration")
    held = _wc(HELD, "outfit", [_opt("long gown", "long"), _opt("mini skirt", "short"),
                                _opt("jeans", "long"), _opt("shorts", "short")],
               seed_scope="hold")
    con = _con("c0f00002", FRAME, HELD, matrix={"sit": {"short": _cell()},
                                               "stand": {"long": _cell()}})
    for seed in range(20):
        outs = [_node([frame, con, held], seed, upstream=f) for f in _loop(seed, 3)]
        assert len({o.context["outfit"] for o in outs}) == 1, (
            seed, [o.context["outfit"] for o in outs])


# ── 6. fallback + `only` rows ────────────────────────────────────────────

ROLE = "7a1e0001"
GEAR = "6ea70001"


def test_only_rows_with_a_fallback_never_come_out_empty():
    role = _wc(ROLE, "role", [_opt("maid", "domestic"), _opt("biker", "street"),
                              _opt("ghost")])
    gear = _wc(GEAR, "gear", [
        _opt("frilled apron", "home"), _opt("feather duster", "home"),
        _opt("leather jacket", "road"), _opt("plain clothes", w=0.5, fallback=True),
    ])
    con = _con("c1a00001", ROLE, GEAR,
               matrix={"street": {"road": _cell("only")}},
               exceptions=[_exc("maid", "frilled apron", "only"),
                           _exc("maid", "feather duster", "only"),
                           # "ghost" may only take an option that doesn't exist.
                           _exc("ghost", "chains", "only")])
    seen: Counter[tuple[str, str]] = Counter()
    for seed in SEEDS:
        ctx = _run([role, con, gear], seed)
        r, g = ctx["role"], ctx["gear"]
        types = _warn_types(ctx)
        assert "constraint_excludes_all_options" not in types
        if r == "maid":
            assert g in {"frilled apron", "feather duster"}, seed
        elif r == "biker":
            assert g == "leather jacket", seed
        else:
            assert g == "plain clothes", seed
            assert "fallback_used" in types
        prompt, _ = _assemble(ctx, "a $role wearing $gear")
        assert prompt == f"a {r} wearing {g}"
        seen[(r, g)] += 1
    assert {r for r, _ in seen} == {"maid", "biker", "ghost"}


def test_only_rows_without_a_fallback_leave_the_target_empty_and_say_so():
    role = _wc(ROLE, "role", [_opt("ghost")])
    gear = _wc(GEAR, "gear", [_opt("frilled apron"), _opt("leather jacket")])
    con = _con("c1a00002", ROLE, GEAR, exceptions=[_exc("ghost", "chains", "only")])
    for seed in SEEDS:
        ctx = _run([role, con, gear], seed)
        assert ctx["gear"] == ""
        assert "constraint_excludes_all_options" in _warn_types(ctx)
        # The tidy drops only joining words (with/and/in/...) an empty
        # variable leaves behind, never a verb like "wearing".
        assert _assemble(ctx, "a $role wearing $gear, at night")[0] == "a ghost wearing, at night"
        assert _assemble(ctx, "a $role with $gear, at night")[0] == "a ghost, at night"


# ── 7. multi-pick with a tag filter ──────────────────────────────────────

PROPS = "9a090001"


def test_multi_pick_with_a_tag_filter_draws_distinct_tagged_options():
    props = _wc(PROPS, "props", [
        _opt("sword", "weapon", negative="broken sword"), _opt("bow", "weapon"),
        _opt("dagger", "weapon"), _opt("axe", "weapon"),
        _opt("teacup", "home"), _opt("broom", "home"), _null(),
    ], category_filter="weapon", pick_min=2, pick_max=3, pick_separator=" and ")
    counts: Counter[int] = Counter()
    for seed in SEEDS:
        ctx = _run([props], seed)
        v = ctx["props"]
        assert isinstance(v, ListVar)
        assert 2 <= len(v.items) <= 3
        assert len(set(v.items)) == len(v.items)
        assert set(v.items) <= {"sword", "bow", "dagger", "axe"}, v.items
        counts[len(v.items)] += 1
        prompt, neg = _assemble(ctx, "holding $props; first $props.0")
        assert prompt == f"holding {' and '.join(v.items)}; first {v.items[0]}"
        # $props.0 carries only pick 0's negative; bare $props carries all.
        assert neg == ("broken sword" if "sword" in v.items else "")
        _, neg0 = _assemble(ctx, "$props.0")
        assert neg0 == ("broken sword" if v.items[0] == "sword" else "")
    assert set(counts) == {2, 3}


@pytest.mark.xfail(strict=True, reason=(
    "wildcard_handler.py multi-pick path: `count` is clamped to the pool size "
    "but not to the number of options with weight > 0, and "
    "syntax/resolve.py _weighted_pick_index returns index 0 when the "
    "remaining weights sum to 0. So once the live options are used up, "
    "pick_k_unique keeps drawing EXCLUDED / weight-0 options: an `only` "
    "constraint leaving one live option still yields two picks, and a "
    "weight-0 ('disabled') option is picked."
))
def test_multi_pick_never_draws_an_option_a_constraint_excluded():
    role = _wc(ROLE, "role", [_opt("maid")])
    props = _wc(PROPS, "props", [_opt("broom"), _opt("gun"), _opt("knife")],
                pick_min=2, pick_max=2)
    con = _con("c1a00003", ROLE, PROPS, exceptions=[_exc("maid", "broom", "only")])
    for seed in range(40):
        ctx = _run([role, con, props], seed)
        assert ctx["props"].items == ["broom"], (seed, ctx["props"].items)


@pytest.mark.xfail(strict=True, reason=(
    "same root cause as the constrained multi-pick: weight-0 options are "
    "drawn once the weighted ones run out (wildcard_handler.py multi-pick "
    "count + resolve.py _weighted_pick_index returning 0 on a dead pool)."
))
def test_multi_pick_never_draws_a_weight_zero_option():
    props = _wc(PROPS, "props", [_opt("broom"), _opt("gun", w=0), _opt("knife", w=0)],
                pick_min=2, pick_max=2)
    for seed in range(40):
        assert _run([props], seed)["props"].items == ["broom"]


# ── 8. fixed values overridden per instance (values + negatives) ─────────


def test_fixed_value_overrides_replace_clear_or_keep_the_library_negative():
    lib = [
        {"id": "f0", "name": "style", "value": "oil painting", "negative": "photo"},
        {"id": "f1", "name": "medium", "value": "canvas", "negative": "paper texture"},
        {"id": "f2", "name": "era", "value": "baroque", "negative": "modern"},
    ]
    fv = _fixed("f1f10001", lib, values_overrides=[
        {"id": "f0", "name": "style", "value": "watercolor", "negative": "oil, impasto"},
        {"id": "f1", "name": "medium", "value": "cold press paper", "negative": ""},
        {"id": "f2", "name": "era", "value": "{rococo|baroque}"},
        {"id": "x9", "name": "light", "value": "north light", "negative": "flash"},
    ])
    combine = _combine("cb000001", "art", "$style on $medium", negative="frame",
                       negative_override="{gilded frame|wooden frame}")
    eras: set[str] = set()
    for seed in SEEDS:
        ctx = _run([fv, combine], seed)
        assert ctx["style"] == "watercolor" and ctx["medium"] == "cold press paper"
        assert _neg_texts(ctx, "style") == ["oil, impasto"]
        assert _neg_texts(ctx, "medium") == []
        assert _neg_texts(ctx, "era") == ["modern"]
        assert _neg_texts(ctx, "light") == ["flash"]
        prompt, neg = _assemble(ctx, "$art, $era, $light", "$negatives, lowres")
        assert prompt == f"watercolor on cold press paper, {ctx['era']}, north light"
        frame = _neg_texts(ctx, "art")[-1]
        assert frame in {"gilded frame", "wooden frame"}
        assert neg == f"oil, impasto, {frame}, modern, flash, lowres"
        eras.add(ctx["era"])
    assert eras == {"rococo", "baroque"}


def test_values_overrides_is_a_full_replacement_list():
    lib = [{"id": "f0", "name": "style", "value": "oil"},
           {"id": "f1", "name": "medium", "value": "canvas", "negative": "paper"}]
    fv = _fixed("f1f10002", lib, values_overrides=[{"id": "f0", "name": "style",
                                                    "value": "ink"}])
    for seed in range(20):
        ctx = _run([fv], seed)
        assert ctx["style"] == "ink"
        # A row missing from the override list is dropped, not inherited.
        assert "medium" not in ctx
        assert _assemble(ctx, "$style on $medium")[0] == "ink"


# ── 9. combines reading accessors ────────────────────────────────────────

PALETTE = "9a1e0001"


def test_combine_reads_list_axis_and_negative_accessors():
    palette = _accepts_wc(PALETTE, "colors", [
        _opt("crimson", "heels", negative="pink"), _opt("ivory", "sandals"),
        _opt("jet", "sneakers", negative="grey"), _opt("gold", "heels"),
    ], pick_min=2, pick_max=2)
    combine = _combine("cb000002", "scheme",
                       "$colors.0 base, $colors.1 accent ($colors.1.SHOES) [$colors.neg]")
    for seed in SEEDS:
        ctx = _run([palette, combine], seed)
        a, b = ctx["colors"].items
        tags = {o["value"]: o["sub_categories"][0] for o in palette["payload"]["options"]}
        negs = {"crimson": "pink", "jet": "grey"}
        want_neg = ", ".join(negs[c] for c in (a, b) if c in negs)
        assert ctx["scheme"] == f"{a} base, {b} accent ({tags[b]}) [{want_neg}]"
        # Reading `.neg` is not a use: the combine inherits only the negatives
        # of `$colors.0` and `$colors.1` (both picks), once each.
        assert sorted(_neg_texts(ctx, "scheme")) == sorted(negs[c] for c in (a, b) if c in negs)
        prompt, _ = _assemble(ctx, "$scheme")
        _assert_tidy(prompt.replace("[]", "x"))


# ── 10. empty variables through the Assembler tidy ───────────────────────


def test_empty_variables_leave_a_tidy_prompt():
    hat = _wc("4a700001", "hat", [_opt("straw"), _null()])
    acc = _wc("4a700002", "accessory", [_opt("a red scarf"), _null()])
    bg = _wc("4a700003", "background", [_opt("a meadow"), _null()])
    combos: set[tuple[bool, bool, bool]] = set()
    for seed in SEEDS:
        ctx = _run([hat, acc, bg], seed)
        prompt, _ = _assemble(ctx, "$hat hat girl with $accessory, standing in $background, "
                              "$missing, masterpiece")
        _assert_tidy(prompt)
        assert " with," not in prompt and not prompt.endswith(" in")
        assert " in," not in prompt, prompt
        assert prompt.endswith("masterpiece")
        combos.add((bool(ctx["hat"]), bool(ctx["accessory"]), bool(ctx["background"])))
        if not ctx["accessory"] and not ctx["background"] and ctx["hat"]:
            assert prompt == "straw hat girl, standing, masterpiece"
    assert len(combos) == 8


@pytest.mark.xfail(strict=True, reason=(
    "engine/template.py _mark_empty only flags a `$var` as empty when its "
    "value is None or a blank str. A multi-pick that drew nothing binds an "
    "empty ListVar, which is not flagged, so the dangling-joiner tidy skips "
    "it: 'a knight with $props' renders 'a knight with' (an empty string "
    "value renders 'a knight')."
))
def test_empty_multi_pick_tidies_like_an_empty_string():
    props = _wc(PROPS, "props", [_opt("sword"), _opt("shield")], pick_min=0, pick_max=0)
    for seed in range(10):
        ctx = _run([props], seed)
        assert ctx["props"].items == []
        assert _assemble(ctx, "a knight with $props")[0] == "a knight"


# ── 11. bundles with sub-bundles, in order ───────────────────────────────


def test_sub_bundles_run_in_order_and_gate_with_their_parent():
    mods = [
        _wc("b1b10001", "scene", [_opt("a forest"), _opt("a harbor")], origin="P"),
        _wc("b1b10002", "char", [_opt("an elf"), _opt("a sailor")], origin="S1"),
        _combine("b1b10003", "line", "$char in $scene", origin="S1"),
        _wc("b1b10004", "extra", [_opt("fog"), _opt("rain")], origin="S2"),
        _combine("b1b10005", "full", "$line, $extra", origin="S2"),
    ]

    def bundles(p=True, s1=True, s2=True):
        return [{"_uid": "P", "enabled": p},
                {"_uid": "S1", "enabled": s1, "parent_uid": "P"},
                {"_uid": "S2", "enabled": s2, "parent_uid": "P"}]

    for seed in NODE_SEEDS:
        out = _node(mods, seed, bundles=bundles())
        c = out.context
        assert c["line"] == f"{c['char']} in {c['scene']}"
        assert c["full"] == f"{c['line']}, {c['extra']}"
        assert _assemble(out, "$full")[0] == c["full"]
        # A disabled sub-bundle drops only its own children; the later
        # sibling's combine then reads an unbound $line.
        off1 = _node(mods, seed, bundles=bundles(s1=False)).context
        assert "char" not in off1 and "line" not in off1
        assert off1["scene"] == c["scene"] and off1["full"] == f", {c['extra']}"
        # A disabled parent gates every grandchild.
        assert _node(mods, seed, bundles=bundles(p=False)).context == {}


def test_double_inserted_bundle_constraints_read_their_own_copy_when_targets_differ():
    def copy_of(n: int, origin: str, role: str) -> list[dict]:
        return [
            _wc(ROLE, "role", [_opt(role)], row=f"r{n}", origin=origin),
            _con("c2a00001", ROLE, f"6ea7000{n}", row=f"c{n}", origin=origin,
                 exceptions=[_exc("maid", "apron", "only"),
                             _exc("biker", "leather", "only")]),
            _wc(f"6ea7000{n}", f"gear{n}", [_opt("apron"), _opt("leather")],
                row=f"g{n}", origin=origin),
        ]
    stack = copy_of(1, "B1", "maid") + copy_of(2, "B2", "biker")
    for seed in SEEDS:
        ctx = _run(stack, seed)
        assert (ctx["gear1"], ctx["gear2"]) == ("apron", "leather"), seed


@pytest.mark.xfail(strict=True, reason=(
    "_constraints.py apply_constraints_for_target: reach is not scoped to the "
    "constraint's bundle copy. With a bundle [role → constraint → gear] "
    "inserted twice (same library uuids), copy 1's constraint (bound to copy "
    "1's source via by_origin) also re-weights copy 2's gear, so copy 2's "
    "target gets both copies' rules; with `only` rows that excludes "
    "everything and copy 2's gear renders empty on every seed."
))
def test_double_inserted_bundle_keeps_each_copy_to_its_own_target():
    def copy_of(n: int, origin: str, role: str) -> list[dict]:
        return [
            _wc(ROLE, "role", [_opt(role)], row=f"r{n}", origin=origin),
            _con("c2a00002", ROLE, GEAR, row=f"c{n}", origin=origin,
                 exceptions=[_exc("maid", "apron", "only"),
                             _exc("biker", "leather", "only")]),
            _wc(GEAR, f"gear{n}", [_opt("apron"), _opt("leather")],
                row=f"g{n}", origin=origin),
        ]
    stack = copy_of(1, "B1", "maid") + copy_of(2, "B2", "biker")
    for seed in range(20):
        ctx = _run(stack, seed)
        assert (ctx["gear1"], ctx["gear2"]) == ("apron", "leather"), seed


# ── 12. Model Info as a constraint source via match_variable ─────────────

MODEL = "0de10001"
STYLE = "0de10002"


def _model_stack() -> list[dict]:
    model = _wc(MODEL, "model", [
        _opt("pony", "pony"), _opt("illustrious", "illustrious"),
        _opt("generic", "other", fallback=True),
    ], match_variable="model_variant", internal=True)
    style = _wc(STYLE, "style", [
        _opt("score_9, source_anime", "pony_tags", negative="score_4"),
        _opt("masterpiece, best quality", "booru_tags", negative="worst quality"),
        _opt("photo, 35mm", "plain", negative="cartoon"),
    ])
    con = _con("c3a00001", MODEL, STYLE, matrix={
        "pony": {"pony_tags": _cell("only")},
        "illustrious": {"booru_tags": _cell("only")},
        "other": {"pony_tags": _cell(), "booru_tags": _cell()},
    })
    return [model, con, style]


@pytest.mark.parametrize("ckpt,want_style,want_neg", [
    ("ponyDiffusionV6XL.safetensors", "score_9, source_anime", "score_4"),
    ("illustriousXL_v01.safetensors", "masterpiece, best quality", "worst quality"),
    ("juggernautXL_v9.safetensors", "photo, 35mm", "cartoon"),
])
def test_model_info_variant_drives_the_style_through_match_variable(ckpt, want_style, want_neg):
    info = WPModelInfo.execute(wp_model_info=json.dumps({"name": ckpt})).values[0]
    for seed in NODE_SEEDS:
        out = _node(_model_stack(), seed, upstream=info)
        assert out.context["style"] == want_style, seed
        prompt, neg = _assemble(out, "$model $style, 1girl", "$negatives")
        # $model is internal: it drives the constraint but never prints.
        assert prompt == f"{want_style}, 1girl"
        assert neg == want_neg


# ── 13. send-to-negative follow-usage with an internal variable ──────────


def test_negatives_of_an_internal_variable_follow_a_public_reader():
    hair = _wc("4a1e0001", "hair", [_opt("strawberry blonde", negative="strawberry, fruit"),
                                    _opt("jet black", negative="blue hair")], internal=True)
    face = _wc("4a1e0002", "face", [_opt("freckles", negative="acne"), _opt("smile")])
    look = _combine("4a1e0003", "look", "$hair hair")
    for seed in SEEDS:
        ctx = _run([hair, face, look], seed)
        hair_neg = "strawberry, fruit" if ctx["hair"] == "strawberry blonde" else "blue hair"
        face_neg = "acne" if ctx["face"] == "freckles" else ""
        # The internal variable itself adds nothing, even when written in.
        prompt, neg = _assemble(ctx, "$hair, $face")
        assert prompt == ctx["face"] and neg == face_neg
        # A public combine that read it carries its words along.
        prompt, neg = _assemble(ctx, "$look, $face")
        assert prompt == f"{ctx['hair']} hair, {ctx['face']}"
        assert neg == ", ".join(t for t in (hair_neg, face_neg) if t)
        # A detailer Assembler that renders only $face gets only face words.
        assert _assemble(ctx, "$face")[1] == face_neg
        # Asking for the internal variable's negatives by name still works.
        # (A negative template without $negatives gets the collected words
        # appended.)
        want = ", ".join(t for t in (hair_neg, face_neg) if t)
        assert _assemble(ctx, "$face", "$hair.neg")[1] == want
        assert _assemble(ctx, "$face", "$hair.neg, $negatives")[1] == want
        assert _assemble(ctx, "$hair", "$hair.neg")[1] == hair_neg


# ── 14. module rng streams ───────────────────────────────────────────────


@pytest.mark.xfail(strict=True, reason=(
    "fixed_values_handler.py:185 keys its rng on ctx['__wp_module_id__'], "
    "which nothing sets (pipeline.py sets __wp_current_module_id__), so every "
    "fixed-values module falls back to the literal 'fixed_values' stream: two "
    "modules with the same {a|b|...} alternation always land on the same "
    "value, despite the comment promising independent streams."
))
def test_two_fixed_values_modules_roll_independently():
    alt = "{" + "|".join(str(i) for i in range(8)) + "}"
    fa = _fixed("fa000001", [{"id": "a", "name": "a", "value": alt}])
    fb = _fixed("fb000001", [{"id": "b", "name": "b", "value": alt}])
    same = sum(1 for seed in SEEDS if (c := _run([fa, fb], seed))["a"] == c["b"])
    assert same < len(SEEDS) // 2, same


@pytest.mark.xfail(strict=True, reason=(
    "derivation_handler.py resolve() keys its rng on ctx['__wp_module_id__'] "
    "(never set), so every derivation shares the 'derivation' stream and two "
    "derivations with the same {a|b|...} action always pick alike."
))
def test_two_derivations_roll_independently():
    alt = "{" + "|".join(str(i) for i in range(8)) + "}"

    def d(uid: str, target: str) -> dict:
        return _deriv(uid, _rule("r1", _branch(_cond("go", "exists"),
                                               _act(target, "replace", alt))))
    same = sum(1 for seed in SEEDS
               if (c := _run([d("da000001", "p"), d("db000001", "q")], seed, go="1"))["p"]
               == c["q"])
    assert same < len(SEEDS) // 2, same


# ── 15. match_variable and the node's toggles ────────────────────────────


@pytest.mark.xfail(strict=True, reason=(
    "wildcard_handler.py resolve(): match_variable runs before category_filter "
    "/ enabled_options are applied (`_match_variable_option(ctx, options, ...)` "
    "gets the unfiltered list), so a toggled-off fallback is still used on a "
    "no-match and a toggled-off option still matches. The docs say turning "
    "the fallback off for one use keeps it out ('the node's filters + toggles "
    "decide whether the fallback is available at all')."
))
def test_match_variable_respects_the_nodes_option_toggles():
    model = _wc(MODEL, "model", [_opt("pony"), _opt("sdxl"), _opt("other", fallback=True)],
                match_variable="model_variant", enabled_options=["pony", "sdxl"])
    for seed in range(20):
        ctx = _run([model], seed, model_variant="flux")
        assert ctx["model"] in {"pony", "sdxl"}, ctx["model"]


# ── 16. documented-by-test surprises ─────────────────────────────────────


def test_a_wildcard_reached_only_through_a_ref_cannot_be_a_constraint_source():
    # Nested @{} picks are logged, not recorded in __wp_picks__, so a
    # constraint whose source only ever rolls inside another option has no
    # source pick: it warns and skips instead of applying.
    season = _season()
    carrier = _wc("ca770001", "scene", [_opt(f"a @{{{SEASON}}} day", oid="s")])
    color = _color()
    stack = [carrier, _con("c4a00001", SEASON, COLOR, matrix=_SEASON_TO_COLOR), color]
    colors: set[str] = set()
    for seed in SEEDS:
        ctx = _run(stack, seed, _catalog(season))
        assert "unknown_constraint_source" in _warn_types(ctx)
        colors.add(ctx["color"])
    assert colors == {"red", "orange", "blue", "teal"}


def test_two_wildcards_bound_to_the_same_variable_share_one_rng_stream():
    # The pick rng is keyed on (seed, binding), not on the module, so two
    # wildcards with the same binding and option list roll the same option on
    # every seed: a "re-roll $hair" further down the chain repeats the first.
    first = _wc("4a190001", "hair", [_opt(f"h{i}") for i in range(10)])
    echo = _combine("4a190002", "before", "$hair")
    second = _wc("4a190003", "hair", [_opt(f"h{i}") for i in range(10)])
    for seed in SEEDS:
        ctx = _run([first, echo, second], seed)
        assert ctx["before"] == ctx["hair"]
