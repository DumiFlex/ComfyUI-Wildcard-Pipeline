"""Wildcard pack import: tables and grids (folders whose subfolders
repeat the same list names) become one tagged wildcard per list name."""
from __future__ import annotations

import random

from engine.modules import build_resolve_ctx
from engine.syntax.resolve import resolve_text
from engine.wildcard_files import SourceFile, convert_files


def _convert(files: dict[str, str], **kw) -> dict:
    return convert_files([SourceFile(p, t.encode()) for p, t in files.items()], **kw)


def _rows(result: dict) -> dict[str, dict]:
    return {r["name"]: r for r in result["payload"]["wildcards"]}


def _roll(result: dict, text: str, seeds: int = 80) -> set[str]:
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


BEINGS = {
    "w/beings/elf/name.txt": "Elf\n",
    "w/beings/elf/prompt.txt": "__beings/elf/name__ with pointed ears\n",
    "w/beings/orc/name.txt": "Orc\n",
    "w/beings/orc/prompt.txt": "__beings/orc/name__ with tusks\n",
    "w/beings/imp/name.txt": "Imp\n",
    "w/beings/imp/prompt.txt": "__beings/imp/name__ with horns\n",
    "w/scene.txt": "a __beings/orc/prompt__ in a cave\n",
}


def test_a_table_becomes_one_wildcard_per_field():
    res = _convert(BEINGS)
    rows = _rows(res)
    assert "beings/name" in rows and "beings/prompt" in rows
    name = rows["beings/name"]
    assert name["payload"]["tag_groups"] == {"being": ["elf", "imp", "orc"]}
    assert sorted(o["value"] for o in name["payload"]["options"]) == ["Elf", "Imp", "Orc"]
    assert name["payload"]["var_binding"] == "being_name"
    # Each prompt points at its own record's name.
    prompt = rows["beings/prompt"]
    orc = next(o for o in prompt["payload"]["options"] if "tusks" in o["value"])
    assert orc["value"] == f"@{{{name['id']}#beings/name:orc}} with tusks"
    # A reference to one record's list is the table filtered by its folder.
    scene = rows["scene"]["payload"]["options"][0]["value"]
    assert scene == f"a @{{{prompt['id']}#beings/prompt:orc}} in a cave"
    assert _roll(res, scene) == {"a Orc with tusks in a cave"}
    plan = {p["name"]: p for p in res["report"]["plan"] if p.get("structure")}
    assert plan["beings/prompt"]["structure"] == "table"
    assert plan["beings/prompt"]["separate_key"] == "beings/*/prompt"


def test_keeping_a_table_column_apart():
    res = _convert(BEINGS, keep_separate={"beings/*/prompt"})
    rows = _rows(res)
    assert "beings/prompt" not in rows
    assert "beings/name" in rows
    assert "beings/orc/prompt" in rows


def test_two_few_records_is_not_a_table():
    files = {k: v for k, v in BEINGS.items() if "/imp/" not in k}
    rows = _rows(_convert(files))
    assert "beings/name" not in rows


def test_a_grid_tags_every_level_and_names_gender():
    files = {}
    for era in ("victorian", "modern", "future"):
        for g in ("female", "male"):
            for slot in ("top", "shoes"):
                files[f"w/clothes/{era}/{g}/{slot}.txt"] = f"{era} {g} {slot}\n"
    files["w/scene.txt"] = "x\n"  # keeps clothes/ from being the pack root
    res = _convert(files)
    rows = _rows(res)
    top = rows["clothes/top"]["payload"]
    assert top["tag_groups"]["clothes"] == ["future", "modern", "victorian"]
    assert top["tag_groups"]["gender"] == ["female", "male"]
    assert len(top["options"]) == 6
    assert _roll(res, f"@{{{rows['clothes/top']['id']}:modern and male}}") == {"modern male top"}


def test_axis_renames_apply():
    res = _convert(BEINGS, axis_names={"beings/name": {"being": "creature"}})
    assert _rows(res)["beings/name"]["payload"]["tag_groups"] == {
        "creature": ["elf", "imp", "orc"],
    }
    assert "being" in _rows(res)["beings/prompt"]["payload"]["tag_groups"]


def test_lists_that_folders_cannot_tell_apart_stay_folder_merges():
    files = {
        "w/x/a/top.txt": "1\n", "w/x/b/top.txt": "2\n", "w/x/c/top.txt": "3\n",
        "w/x/a/d/top.txt": "4\n",
        "w/x/a/hat.txt": "5\n", "w/x/b/hat.txt": "6\n", "w/x/c/hat.txt": "7\n",
    }
    rows = _rows(_convert(files))
    assert "x/top" not in rows
    assert "x/hat" not in rows
