"""Dynamic Prompts / PPP / Impact Pack wildcard file conversion."""
from __future__ import annotations

import io
import random
import zipfile
from pathlib import Path

import pytest

from engine.modules import build_resolve_ctx
from engine.modules.wildcard_handler import WildcardHandler
from engine.syntax.resolve import resolve_text
from engine.wildcard_files import SourceFile, convert_files, read_zip

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "wildcard_files"


def _pack(prefix: str = "wildcards/") -> list[SourceFile]:
    root = FIXTURES / "pack"
    return [
        SourceFile(prefix + p.relative_to(root).as_posix(), p.read_bytes())
        for p in sorted(root.rglob("*")) if p.is_file()
    ]


def _by_name(result: dict) -> dict[str, dict]:
    return {r["name"]: r for r in result["payload"]["wildcards"]}


def _values(row: dict) -> list[str]:
    return [o["value"] for o in row["payload"]["options"]]


def _notes(result: dict) -> dict[str, int]:
    return {n["kind"]: n["count"] for n in result["report"]["notes"]}


@pytest.fixture(scope="module")
def pack() -> dict:
    return convert_files(_pack())


def test_every_row_is_engine_valid(pack):
    rows = pack["payload"]["wildcards"]
    assert rows
    for row in rows:
        WildcardHandler.validate_payload(row["payload"])
        assert row["type"] == "wildcard"
        assert len(row["id"]) == 8


def test_names_are_paths_from_the_common_root(pack):
    # The shared `wildcards/` folder is dropped, YAML dicts drop the file
    # name, nested keys join with `/`.
    assert set(_by_name(pack)) >= {
        "animals/cats", "animals/dogs", "ppp/outfit", "ppp/look",
        "styles/art/painters", "styles/art/moods", "styles/art/single",
    }


def test_txt_lines_comments_weights_and_duplicates(pack):
    cats = _by_name(pack)["animals/cats"]
    # BOM + CRLF handled, `#` lines and blank lines skipped, inline comment
    # cut, `2::` read as a weight, the repeated `tabby` folded into its
    # weight (two lines, two tickets) and the `#` lines kept as the description.
    assert _values(cats) == ["tabby", "siamese", "maine coon"]
    assert [o["weight"] for o in cats["payload"]["options"]] == [2, 1, 2]
    assert cats["description"] == "Imported from animals/cats.txt\n\ncats"
    assert cats["payload"]["var_binding"] == "cats"
    notes = _notes(pack)
    assert notes["inline_comment"] == 1
    assert notes["duplicate_value"] >= 1


def test_windows_1252_fallback_and_hash_inside_words(pack):
    dogs = _by_name(pack)["animals/dogs"]
    assert _values(dogs)[:2] == ["café dog", "C# hound"]


def test_yaml_words_stay_strings(pack):
    # A default YAML loader would turn these into booleans and 1.1.
    assert _values(_by_name(pack)["styles/art/moods"]) == ["yes", "no", "on", "1.10"]


def test_dynamic_prompts_weights_in_yaml(pack):
    painters = _by_name(pack)["styles/art/painters"]
    weights = {o["value"]: o["weight"] for o in painters["payload"]["options"]}
    assert weights == {"Rembrandt": 1, "Vermeer": 3, "Monet": 2}


def test_ppp_labels_else_conditions_and_anonymous_lists(pack):
    outfit = _by_name(pack)["ppp/outfit"]
    opts = {o["value"]: o for o in outfit["payload"]["options"]}
    assert opts["t-shirt"]["sub_categories"] == ["casual", "summer"]
    assert opts["t-shirt"]["weight"] == 4
    assert opts["coat"]["sub_categories"] == ["formal", "winter"]
    assert opts["hoodie"]["weight"] == 5  # condition dropped, choice kept
    assert opts["plain clothes"].get("fallback") is True
    assert "{scarf|gloves}" in opts
    assert outfit["payload"]["sub_categories"] == ["casual", "summer", "formal", "winter"]
    notes = _notes(pack)
    assert notes["condition_dropped"] == 1
    assert notes["default_params_dropped"] == 1


def test_ppp_include_becomes_a_reference(pack):
    rows = _by_name(pack)
    cats_id = rows["animals/cats"]["id"]
    assert f"@{{{cats_id}#animals/cats}}" in _values(rows["ppp/outfit"])


def test_references_variants_and_variables(pack):
    rows = _by_name(pack)
    outfit, cats = rows["ppp/outfit"]["id"], rows["animals/cats"]["id"]
    look = _values(rows["ppp/look"])
    assert f"@{{{outfit}#ppp/outfit:formal}}" in look
    # Multi-pick over one ref draws different values, like the source.
    assert f"{{2$$ and $$@{{{outfit}#ppp/outfit}}}}" in look
    assert "{red|@blue|green}" in look           # `~` sampler mark dropped
    assert "{2$$, $$a|b|c}" in look              # default separator added
    assert "{1-2$$, $$x|y|z}" in look            # open lower bound
    assert "{1-2~$$ / $$p|q}" in look            # `r` → `~`, open upper bound
    assert "solo" in look                        # single-branch braces
    assert "${color:red} hat" in look            # DP variables stay as text
    assert "costs $5 or $$total" in look         # literal `$name` escaped
    assert "__missing/thing__" in look           # unresolved stays as text
    # Impact `3#__cats__` resolves by unique suffix.
    assert f"{{3$$, $$@{{{cats}#animals/cats}}}}" in look
    notes = _notes(pack)
    assert notes["unresolved_reference"] == 1
    assert notes["variable_kept_as_text"] == 2


def test_globs_and_parent_keys_become_one_weighted_group(pack):
    rows = _by_name(pack)
    group = rows["animals/*"]
    assert group["description"].startswith("Picks from every wildcard")
    weights = {o["value"]: o["weight"] for o in group["payload"]["options"]}
    cats, dogs = rows["animals/cats"], rows["animals/dogs"]
    assert weights == {
        f"@{{{cats['id']}#animals/cats}}": 3,
        f"@{{{dogs['id']}#animals/dogs}}": 3,
    }
    # `__animals/*__` and the Impact parent key `__animals__` share the group.
    look = _values(rows["ppp/look"])
    assert look.count(f"@{{{group['id']}#animals/*}}") == 1
    assert pack["report"]["groups"] == 1


def test_converted_text_resolves_in_the_engine(pack):
    rows = pack["payload"]["wildcards"]
    catalog = {r["id"]: r["payload"] for r in rows}
    ctx = {
        "__wp_rng__": random.Random(1),
        "__wp_warnings__": [],
        "__wp_catalog__": catalog,
        "__wp_max_ref_depth__": 8,
    }
    rctx = build_resolve_ctx(ctx, surface="wildcard")
    assert resolve_text("costs $5 or $$total", rctx) == "costs $5 or $total"
    look = _by_name(pack)["ppp/look"]
    for opt in look["payload"]["options"]:
        resolve_text(opt["value"], rctx)  # never raises
    dogs = _by_name(pack)["animals/dogs"]
    friend = resolve_text(_values(dogs)[2], rctx)
    assert friend.endswith(" friend")
    assert friend[: -len(" friend")] in {"tabby", "siamese", "maine coon"}


def test_categories_follow_the_first_folder(pack):
    cats = {c["id"]: c["name"] for c in pack["payload"]["categories"]}
    rows = _by_name(pack)
    assert cats[rows["animals/cats"]["category_id"]] == "animals"
    assert cats[rows["styles/art/painters"]["category_id"]] == "styles"


def test_ids_are_stable_across_imports():
    a = convert_files(_pack())
    b = convert_files(_pack("other-root/"))
    assert [r["id"] for r in a["payload"]["wildcards"]] == [
        r["id"] for r in b["payload"]["wildcards"]
    ]
    assert a["payload"]["wildcards"][0]["payload"]["options"] == (
        b["payload"]["wildcards"][0]["payload"]["options"]
    )


def test_schema_stamp_follows_content(pack):
    # The fallback option needs v9.
    assert pack["payload"]["schema_version"] == 9
    plain = convert_files([SourceFile("a.txt", b"one\ntwo\n")])
    assert plain["payload"]["schema_version"] == 2


def test_top_level_json_list_is_named_after_the_file():
    data = (FIXTURES / "list.json").read_bytes()
    result = convert_files([SourceFile("list.json", data)])
    row = _by_name(result)["list"]
    assert [(o["value"], o["weight"]) for o in row["payload"]["options"]] == [
        ("alpha", 1), ("beta", 1), ("gamma", 0.5),
    ]


def test_pack_tag_and_category_override():
    result = convert_files(
        [SourceFile("x/a.txt", b"one\n"), SourceFile("y/b.txt", b"two\n")],
        pack_tag="my-pack", category_name="Imported",
    )
    assert [c["name"] for c in result["payload"]["categories"]] == ["Imported"]
    for row in result["payload"]["wildcards"]:
        assert row["tags"] == ["my-pack"]


def test_duplicates_bad_files_and_exclusions():
    files = [
        SourceFile("a/colors.txt", b"red\n"),
        SourceFile("b.yaml", b"a:\n  colors:\n    - blue\n"),
        SourceFile("broken.yaml", b"a: [unclosed\n"),
        SourceFile("skip.txt", b"x\n"),
        SourceFile("notes.md", b"# readme\n"),
    ]
    result = convert_files(files, exclude={"skip.txt"})
    status = {f["path"]: f["status"] for f in result["report"]["files"]}
    assert status == {
        "a/colors.txt": "ok", "b.yaml": "ok", "broken.yaml": "error", "skip.txt": "excluded",
    }
    rows = _by_name(result)
    assert _values(rows["a/colors"]) == ["red"]  # first definition wins
    assert _notes(result)["duplicate_wildcard"] == 1


def test_library_names_resolve_references():
    result = convert_files(
        [SourceFile("look.txt", b"__hair/colour__ hair\n")],
        library_wildcards={"hair/colour": "abcd1234"},
    )
    assert _values(_by_name(result)["look"]) == ["@{abcd1234#hair/colour} hair"]


def test_names_are_made_safe_for_the_ref_grammar():
    result = convert_files([SourceFile("odd, name: #1!.txt", b"v\n")])
    (row,) = result["payload"]["wildcards"]
    assert row["name"] == "odd_ name_ _1_"
    assert row["payload"]["var_binding"] == "odd_name_1"


def test_read_zip_skips_junk_and_unsafe_paths():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("pack/colors.txt", "red\n")
        zf.writestr("pack/readme.md", "hi")
        zf.writestr("__MACOSX/pack/._colors.txt", "junk")
        zf.writestr("../evil.txt", "x")
        zf.writestr("pack/.hidden.txt", "x")
    files = read_zip(buf.getvalue())
    assert [f.path for f in files] == ["pack/colors.txt"]


def _plan(result: dict) -> dict[str, dict]:
    return {p["name"]: p for p in result["report"]["plan"]}


def test_plan_roles_follow_the_reference_graph(pack):
    plan = _plan(pack)
    assert plan["animals/cats"]["role"] == "vocabulary"
    assert plan["animals/dogs"]["role"] == "composition"  # in the animals/* group
    assert plan["ppp/outfit"]["role"] == "composition"    # ppp/look uses it
    assert plan["ppp/look"]["role"] == "entry"            # nothing uses it
    assert plan["animals/*"]["role"] == "group"
    assert plan["animals/cats"]["referenced_by"] == 4
    assert plan["ppp/look"]["domain"] == "ppp"


def test_plan_fidelity_comes_from_the_notes(pack):
    plan = _plan(pack)
    assert plan["animals/cats"]["fidelity"] == "exact"
    assert plan["ppp/outfit"]["fidelity"] == "lossy"  # if-condition dropped
    assert plan["ppp/look"]["fidelity"] == "lossy"    # ${…} kept as text
    kinds = {n["kind"] for n in plan["ppp/look"]["notes"]}
    assert {"variable_kept_as_text", "unresolved_reference"} <= kinds
    close = convert_files([SourceFile("a.yaml", b"a:\n  - \"'Picker'$$\"\n  - x\n")])
    assert _plan(close)["a"]["fidelity"] == "close"


def test_bundles_hold_entry_points_only():
    files = [
        SourceFile("clothes/top.txt", b"shirt\ncoat\n"),
        SourceFile("clothes/outfit.txt", b"a __clothes/top__\n"),
        SourceFile("places/city.txt", b"paris\n"),
        SourceFile("places/scene.txt", b"in __places/city__\n"),
        SourceFile("intro.txt", b"__clothes/outfit__ __places/scene__\n"),
        SourceFile("loose.txt", b"x __clothes/top__\n"),
    ]
    result = convert_files(files, pack_name="My pack")
    bundles = {b["name"]: b for b in result["payload"]["bundles"]}
    # clothes/outfit and places/scene are used by intro, so only the two
    # loose files are entry points: no folder bundles, one pack bundle.
    assert set(bundles) == {"My pack"}
    names = [c["meta"]["name"] for c in bundles["My pack"]["children"]]
    assert names == ["intro", "loose"]
    leaf = bundles["My pack"]["children"][0]
    # Leaf children are frozen widget snapshots, like the bundle editor's.
    assert leaf["type"] == "wildcard" and leaf["enabled"] is True
    assert leaf["payload"] == _by_name(result)["intro"]["payload"]

    split = convert_files(files[:4] + [SourceFile("places/trip.txt", b"__places/scene__\n")])
    bundles = {b["name"]: b for b in split["payload"]["bundles"]}
    assert set(bundles) == {"Imported wildcards", "clothes", "places"}
    assert [c["type"] for c in bundles["Imported wildcards"]["children"]] == ["bundle"] * 2
    assert [c["meta"]["name"] for c in bundles["places"]["children"]] == ["places/trip"]


def test_bundles_can_be_skipped_and_flat_packs_need_none(pack):
    # Only ppp/look is an entry point, so its folder bundle stands alone.
    assert [b["name"] for b in pack["payload"]["bundles"]] == ["ppp"]
    assert pack["report"]["bundles"] == 1
    flat = convert_files([SourceFile("a.txt", b"x\n"), SourceFile("sub/b.txt", b"y\n")])
    assert flat["payload"]["bundles"] == []
    assert convert_files(_pack(), make_bundles=False)["payload"]["bundles"] == []


def test_multi_line_yaml_values_drop_comments_into_the_description():
    text = (
        b"tpl:\n"
        b"  portrait:\n"
        b"    - |\n"
        b"      # Usage: __tpl/portrait(figure=a knight)__\n"
        b"      a portrait of a person,\n"
        b"      soft light\n"
    )
    result = convert_files([SourceFile("t.yaml", text)])
    row = _by_name(result)["tpl/portrait"]
    assert _values(row) == ["a portrait of a person, soft light"]
    assert row["description"].endswith("Usage: __tpl/portrait(figure=a knight)__")
    assert "template_args_dropped" not in _notes(result)


def test_rows_carry_the_fingerprint_the_library_will_store(pack):
    from engine._fingerprint import module_fingerprint
    from engine.modules.snapshot import payload_hash

    for row in pack["payload"]["wildcards"]:
        assert row["payload_hash"] == payload_hash(row["payload"])
        assert row["snapshot_fingerprint"] == module_fingerprint(row)
