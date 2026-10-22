"""Wildcard pack import: per-tool rules (PPP defaults, Impact pooling,
dialect detection, library ids, markup that has no home yet)."""
from __future__ import annotations

import random

from engine.modules import build_resolve_ctx
from engine.syntax.resolve import resolve_text
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


def _roll(result: dict, text: str, seeds: int = 60) -> set[str]:
    catalog = {r["id"]: r["payload"] for r in result["payload"]["wildcards"]}
    out = set()
    for seed in range(seeds):
        ctx = {
            "__wp_rng__": random.Random(seed),
            "__wp_warnings__": [],
            "__wp_catalog__": catalog,
            "__wp_max_ref_depth__": 8,
        }
        out.add(resolve_text(text, build_resolve_ctx(ctx, surface="wildcard")))
    return out


# --- PPP default parameters -------------------------------------------------


def test_default_count_and_separator_apply_to_plain_references():
    res = _convert({
        "w/adj.txt": "2$$ and $$\nbig\nsmall\nred\n",
        "w/use.txt": "a __adj__ dog\nthe __1$$adj__ cat\n",
    })
    rows = _rows(res)
    adj = rows["adj"]["id"]
    use = _values(rows["use"])
    assert use[0] == f"a {{2$$ and $$@{{{adj}#adj}}}} dog"
    # Parameters on the reference win over the defaults; the separator
    # still comes from the wildcard, as in PPP.
    assert use[1] == f"the @{{{adj}#adj}} cat"
    assert _values(rows["adj"]) == ["big", "small", "red"]
    for text in _roll(res, use[0]):
        picked = text[2:-4].split(" and ")
        assert len(picked) == 2 and len(set(picked)) == 2


def test_object_defaults_bake_prefix_and_suffix_into_single_picks():
    res = _convert({"p.yaml": (
        "hat:\n"
        "  - {prefix: 'wearing a ', suffix: ' hat', description: Hats}\n"
        "  - red\n  - blue\n"
        "socks:\n"
        "  - {count: 2, prefix: '(', suffix: ')', separator: ' and '}\n"
        "  - wool\n  - silk\n  - cotton\n"
        "use:\n  - __hat__, __socks__\n"
    )})
    rows = _rows(res)
    assert _values(rows["hat"]) == ["wearing a red hat", "wearing a blue hat"]
    assert "Hats" in rows["hat"]["description"]
    # Two picks: the affixes go around the joined values at the reference.
    assert _values(rows["socks"]) == ["wool", "silk", "cotton"]
    socks = rows["socks"]["id"]
    assert f"({{2$$ and $$@{{{socks}#socks}}}})" in _values(rows["use"])[0]
    assert "default_params_dropped" not in _notes(res)


def test_optional_flag_allows_an_empty_pick():
    res = _convert({
        "w/maybe.txt": "o$$\nscar\n",
        "w/use.txt": "face __maybe__\n{o2$$a|b|c}\n",
    })
    rows = _rows(res)
    maybe = rows["maybe"]["id"]
    use = _values(rows["use"])
    assert use[0] == f"face {{0-1$$, $$@{{{maybe}#maybe}}}}"
    assert use[1] == "{0-2$$, $$a|b|c}"
    assert _roll(res, use[0]) == {"face ", "face scar"}


def test_a_cyclical_sampler_is_the_only_default_left_behind():
    res = _convert({"w/x.txt": "@$$\na\nb\n"})
    assert _notes(res)["default_params_dropped"] == 1
    assert res["report"]["plan"][0]["fidelity"] == "close"


# --- Resolution rules -------------------------------------------------------


def test_a_bare_name_found_in_several_folders_pools_them_like_impact():
    res = _convert({
        "w/female/hair.txt": "long\nbraided\n",
        "w/male/hair.txt": "short\n",
        "w/use.txt": "__hair__\n",
    })
    rows = _rows(res)
    assert _notes(res)["suffix_pooled"] == 1
    assert "unresolved_reference" not in _notes(res)
    assert res["report"]["groups"] == 1
    assert _roll(res, _values(rows["use"])[0]) == {"long", "braided", "short"}


def test_a_reference_finds_a_wildcard_an_earlier_import_created():
    first = _convert({"w/colors.txt": "red\n"})
    colors_id = _rows(first)["colors"]["id"]
    later = _convert(
        {"w/use.txt": "__colors__ hat\n"},
        library_ids={colors_id},
    )
    assert _values(_rows(later)["use"]) == [f"@{{{colors_id}#colors}} hat"]
    assert _notes(later)["resolved_from_library"] == 1


# --- Dialects ---------------------------------------------------------------


def test_dialect_detection():
    def dialect(files: dict[str, str]) -> str:
        return _convert(files)["report"]["dialect"]

    assert dialect({"a.txt": "red\nblue\n"}) == "mixed"
    assert dialect({"a.txt": "'warm'::red\nblue\n"}) == "ppp"
    assert dialect({"a.txt": "x <ppp:stn>blur<ppp:/stn>\n"}) == "ppp"
    assert dialect({"a.txt": "3#__b__\n", "b.txt": "x\n"}) == "impact"
    assert dialect({"a.txt": "${x=!{a|b}} ${x}\n"}) == "dynamicprompts"
    assert dialect({"a.txt": "<[female][casual]>\n"}) == "umi"
    forced = _convert({"a.txt": "red\n"}, dialect="impact")["report"]
    assert forced["dialect"] == "impact" and forced["dialect_detected"] == "mixed"


def test_impact_joins_multi_picks_with_a_space():
    res = _convert({
        "w/adj.txt": "big\nsmall\n",
        "w/use.txt": "2#__adj__\n{2$$a|b}\n",
    })
    adj = _rows(res)["adj"]["id"]
    assert _values(_rows(res)["use"]) == [f"{{2$$ $$@{{{adj}#adj}}}}", "{2$$ $$a|b}"]


# --- Markup with no home yet ------------------------------------------------


def test_ppp_directives_and_umi_queries_are_flagged():
    res = _convert({"a.txt": "x <ppp:frobnicate v>\ny <[female]>\n"})
    notes = _notes(res)
    assert notes["ppp_directive_kept_as_text"] == 1
    assert notes["tag_query_kept_as_text"] == 1
    assert res["report"]["plan"][0]["fidelity"] == "lossy"
