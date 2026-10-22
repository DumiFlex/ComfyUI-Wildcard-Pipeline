"""Wildcard pack import: the logic layer. Variables, template arguments,
PPP conditions, negatives and LoRA tags become stacks, specialised
copies, constraints and option fields; Umi AI tags become filtered refs."""
from __future__ import annotations

from engine.scenario import run_scenario
from engine.wildcard_files import SourceFile, convert_files


def _convert(files: dict[str, str], **kw) -> dict:
    kw.setdefault("merge", False)
    return convert_files([SourceFile(p, t.encode()) for p, t in files.items()], **kw)


def _rows(result: dict) -> dict[str, dict]:
    return {r["name"]: r for r in result["payload"]["wildcards"]}


def _values(row: dict) -> list[str]:
    return [o["value"] for o in row["payload"]["options"]]


def _notes(result: dict) -> dict[str, int]:
    return {n["kind"]: n["count"] for n in result["report"]["notes"]}


def _bundle(result: dict, name: str) -> dict:
    return next(b for b in result["payload"]["bundles"] if b["name"] == name)


def _run(result: dict, bundle: dict, var: str, seeds: int = 40) -> list[str]:
    catalog = {r["id"]: r["payload"] for r in result["payload"]["wildcards"]}
    modules = [{**c, "_uid": c["id"], "name": c["meta"]["name"]} for c in bundle["children"]]
    res = run_scenario(
        modules, seeds=list(range(seeds)), catalog=catalog, track=[var], track_limit=seeds,
    )
    return [v for v in res["tracked"]["values"][var] if v is not None]


# --- Negatives and extra networks -----------------------------------------


def test_send_to_negative_becomes_the_option_negative():
    res = _convert({
        "w/a.txt": "portrait <ppp:stn>blurry<ppp:/stn>, sharp\n{x <ppp:stn>y<ppp:/stn>|z}\n",
    })
    opts = _rows(res)["a"]["payload"]["options"]
    assert opts[0]["value"] == "portrait, sharp"
    assert opts[0]["negative"] == "blurry"
    assert opts[1]["negative"] == "y"
    assert _notes(res)["negative_moved_to_option"] == 1


def test_ppp_extra_networks_become_lora_tags():
    res = _convert({"w/a.txt": "girl <ppp:ext lora detail 0.7>\n"})
    assert _values(_rows(res)["a"]) == ["girl <lora:detail:0.7>"]


# --- Variables ---------------------------------------------------------------


def test_a_macro_variable_renders_its_text_at_every_read():
    res = _convert({"w/a.txt": "${c={red|blue}} a ${c} and ${c} hat\n"})
    assert _values(_rows(res)["a"]) == ["a {red|blue} and {red|blue} hat"]


def test_template_arguments_make_a_specialised_copy():
    res = _convert({
        "w/tpl.txt": "a portrait of ${who}, ${light:soft} light\n",
        "w/use.txt": "__tpl(who=a knight)__\n__tpl(who=a queen, light=hard)__\n",
    })
    rows = _rows(res)
    copies = {n: r for n, r in rows.items() if n.startswith("tpl (")}
    assert sorted(_values(r)[0] for r in copies.values()) == [
        "a portrait of a knight, soft light", "a portrait of a queen, hard light",
    ]
    use = _values(rows["use"])
    assert all(any(f"@{{{r['id']}#" in u for u in use) for r in copies.values())
    plan = {p["name"]: p for p in res["report"]["plan"]}
    assert {plan[n]["role"] for n in copies} == {"copy"}
    assert _notes(res)["specialised_copy"] == 2


def test_a_macro_reaches_a_list_the_line_references():
    res = _convert({
        "w/hat.txt": "${color} hat\n",
        "w/use.txt": "${color=green} __hat__\n",
    })
    rows = _rows(res)
    (copy,) = [r for n, r in rows.items() if n.startswith("hat (")]
    assert _values(copy) == ["green hat"]


SEASON_PACK = {
    "w/seasons.txt": "winter\nsummer\n",
    "w/clothes.yaml": (
        "clothes:\n"
        "  - {text: coat, if: \"season eq 'winter'\"}\n"
        "  - {text: shorts, if: \"season eq 'summer'\"}\n"
        "  - {text: hat}\n"
    ),
    "w/scene.txt": "${season=!__seasons__} a ${season} day, __clothes__\n",
}


def test_a_value_rolled_once_becomes_a_stack_with_its_constraints():
    res = _convert(SEASON_PACK)
    rows = _rows(res)
    stack = _bundle(res, "scene")
    kinds = [(c["type"], c["meta"]["name"]) for c in stack["children"]]
    seasons_id = rows["seasons"]["id"]
    # The referenced list itself rolls $season once.
    assert stack["children"][0]["id"] == seasons_id
    assert stack["children"][0]["instance"] == {"variable_binding": "season"}
    assert kinds[1][0] == "constraint"  # right after its source
    assert kinds[-1] == ("combine", "scene")
    combine = res["payload"]["combines"][0]["payload"]
    assert combine["template"].startswith("a $season day, $scene_part1")
    assert combine["output_var"] == "scene"
    (con,) = res["payload"]["constraints"]
    assert con["payload"]["source_wildcard_id"] == seasons_id
    assert {(e["source"], e["target"]) for e in con["payload"]["exceptions"]} == {
        ("winter", "shorts"), ("summer", "coat"),
    }
    for text in _run(res, stack, "scene"):
        assert text.startswith(("a winter day, ", "a summer day, "))
        if "winter" in text:
            assert "shorts" not in text
        else:
            assert "coat" not in text
    assert "scene" not in rows  # every line of it became the stack


def test_template_slots_get_defaults_and_wait_for_upstream_values():
    res = _convert({"w/p.txt": "${subject:a cat} in ${place}\n"})
    stack = _bundle(res, "p")
    assert [c["type"] for c in stack["children"]] == ["derivation", "combine"]
    assert res["payload"]["combines"][0]["payload"]["template"] == "$subject in $place"
    notes = _notes(res)
    assert notes["template_slot"] == 1


def test_an_if_block_splits_the_value_and_checks_the_model():
    res = _convert({"w/a.txt": "girl, <ppp:if _is_sdxl>score_9<ppp:else>masterpiece<ppp:/if>\n"})
    assert sorted(_values(_rows(res)["a"])) == ["girl, masterpiece", "girl, score_9"]
    model = _bundle(res, "Model checks (family)")
    assert model["children"][0]["instance"] == {"match_variable": "model_family"}
    (con,) = res["payload"]["constraints"]
    ex = {(e["source"], e["target"]) for e in con["payload"]["exceptions"]}
    assert ("sdxl", "girl, masterpiece") in ex and ("sdxl", "girl, score_9") not in ex
    assert ("other", "girl, score_9") in ex
    # With Model Info's value upstream, only the matching branch rolls.
    catalog = {r["id"]: r["payload"] for r in res["payload"]["wildcards"]}
    a = _rows(res)["a"]
    modules = [{**c, "_uid": c["id"], "name": c["meta"]["name"]} for c in model["children"]]
    modules.append({**a, "_uid": a["id"], "enabled": True, "instance": {}})
    for family, want in (("sdxl", "girl, score_9"), ("flux", "girl, masterpiece")):
        run = run_scenario(
            modules, seeds=list(range(20)), catalog=catalog, track=["a"], track_limit=20,
            pins={"model_family": family},
        )
        assert set(run["tracked"]["values"]["a"]) == {want}


def test_conditions_on_unknown_variables_are_dropped_with_a_note():
    res = _convert({"w/a.yaml": "a:\n  - {text: x, if: \"mood eq 'sad'\"}\n  - y\n"})
    assert _notes(res)["condition_dropped"] == 1
    assert sorted(_values(_rows(res)["a"])) == ["x", "y"]


# --- Umi AI -------------------------------------------------------------------

UMI = {
    "umi/Body.yaml": (
        "Long Hair:\n Tags:\n  - Hair Length\n  - Long\n"
        "Short Hair:\n Tags:\n  - Hair Length\n"
        "Red Hair:\n Tags:\n  - Hair Color\n"
        "Blue Hair:\n Tags:\n  - Hair Color\n"
        "'Two-tone Hair, <[Hair Color]>, <[Hair Color]>':\n Tags:\n  - Hair Color\n"
    ),
    "umi/Presets.yaml": (
        "'1girl, <[Hair Length][--Long]>, <[Hair Color]>, {20%smiling|neutral} **ugly**':\n"
        " Tags:\n  - Preset\n"
    ),
    "umi/Yaml Tags.txt": "Hair:\n - Hair Length\n - Hair Color\nOther:\n - Preset\n",
}


def test_umi_tags_become_tags_and_queries_become_filtered_refs():
    res = _convert(UMI)
    rows = _rows(res)
    assert res["report"]["dialect"] == "umi"
    body = rows["Body"]
    assert body["payload"]["tag_groups"] == {"Hair": ["hair_length", "hair_color"]}
    # The two-tone entry queries Hair Color, which it carries itself:
    # it moves up a layer so its query never reaches it. Long Hair, which
    # no query reaches, joins it there.
    layered = rows["Body (2)"]
    assert _values(layered) == [
        "Long Hair",
        f"Two-tone Hair, @{{{body['id']}#Body:hair_color}}, @{{{body['id']}#Body:hair_color}}",
    ]
    assert "long" in layered["payload"]["sub_categories"]
    (preset,) = _values(rows["Presets"])
    # `--Long` matches nothing in Body, so the filter drops it.
    assert f"@{{{body['id']}#Body:hair_length}}" in preset
    # Hair Color matches entries in both layers: weighted by their count.
    assert (
        f"{{2::@{{{body['id']}#Body:hair_color}}|1::@{{{layered['id']}#Body (2):hair_color}}}}"
        in preset
    )
    assert "{20::smiling|80::neutral}" in preset
    opt = rows["Presets"]["payload"]["options"][0]
    assert opt["negative"] == "ugly"
    assert "Yaml Tags.txt" not in {f["path"] for f in res["report"]["files"] if f["status"] == "ok"}


# --- Parameterised copies ------------------------------------------------------

HEROES = {
    "w/heroes/marvel.txt": "iron man\nthor\n",
    "w/heroes/dc.txt": "batman\nsuperman\n",
    "w/random/marvel-hero.txt": "superhero __heroes/marvel__\n",
    "w/random/dc-hero.txt": "superhero __heroes/dc__\n",
}


def test_copies_that_differ_by_one_tag_fold_into_a_steered_wildcard():
    res = _convert(HEROES, merge=True)
    rows = _rows(res)
    assert "random/marvel-hero" not in rows and "random/dc-hero" not in rows
    heroes = rows["heroes"]
    folded = rows["random/hero"]
    assert _values(folded) == [f"superhero @{{{heroes['id']}#heroes}}"]
    source = rows["random/hero · choice"]
    assert sorted(_values(source)) == ["dc", "marvel"]
    (con,) = res["payload"]["constraints"]
    assert con["payload"]["matrix"]["dc"] == {"dc": {"mode": "only", "factor": 1}}
    stack = _bundle(res, "random/hero (folded)")
    assert [c["id"] for c in stack["children"]] == [source["id"], con["id"], folded["id"]]
    catalog = {r["id"]: r["payload"] for r in res["payload"]["wildcards"]}
    modules = [{**c, "_uid": c["id"], "name": c["meta"]["name"]} for c in stack["children"]]
    run = run_scenario(
        modules, seeds=list(range(40)), catalog=catalog,
        track=["hero", "hero_choice"], track_limit=40,
    )
    pairs = set(zip(*(run["tracked"]["values"][k] for k in ("hero_choice", "hero")), strict=True))
    assert pairs == {
        ("marvel", "superhero iron man"), ("marvel", "superhero thor"),
        ("dc", "superhero batman"), ("dc", "superhero superman"),
    }
    assert _notes(res)["copies_folded"] == 2
    kept = _convert(HEROES, merge=True, fold_copies=False)
    assert "random/marvel-hero" in _rows(kept)


def test_a_list_a_condition_reads_stays_out_of_merges():
    res = _convert({
        "w/lists/season.txt": "winter\nsummer\n",
        "w/lists/outfit.txt": (
            '<ppp:if season eq "winter">wool coat<ppp:else>linen shirt<ppp:/if>\n'
        ),
        "w/lists/mood.txt": "calm\nbusy\n",
        "w/scenes/portrait.txt": (
            "${season=!__lists/season__}a woman in ${season}, wearing __lists/outfit__\n"
        ),
    }, merge=True)
    assert "condition_dropped" not in _notes(res)
    rows = _rows(res)
    assert "lists/season" in rows  # held back so it can drive the constraint
    for text in _run(res, _bundle(res, "scenes/portrait"), "portrait"):
        assert ("winter" in text) == ("wool coat" in text)
