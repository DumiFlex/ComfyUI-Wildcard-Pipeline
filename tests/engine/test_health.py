"""engine/health.py — library-wide health checks."""
from engine.health import CHECKS, counts, scan_library


def wc(id_, name, var, options, **kw):
    return {"id": id_, "type": "wildcard", "name": name, "tags": kw.pop("tags", []),
            "category_id": kw.pop("category_id", None),
            "payload": {"var_binding": var, "options": options, **kw}}


def opt(id_, value, weight=1, **kw):
    return {"id": id_, "value": value, "weight": weight, "sub_categories": [], **kw}


def mod(id_, type_, name, payload, **kw):
    return {"id": id_, "type": type_, "name": name, "tags": kw.pop("tags", []),
            "category_id": kw.pop("category_id", None), "payload": payload}


def checks(findings, check):
    return [f for f in findings if f["check"] == check]


def scan(modules=(), bundles=(), templates=(), categories=(), **kw):
    return scan_library(list(modules), list(bundles), list(templates), list(categories), **kw)


HAIR = wc("aaaa0001", "Hair", "hair", [opt("o1", "red"), opt("o2", "blue")])


def test_clean_library_has_no_problems():
    tpl = {"id": "t1", "name": "Portrait", "tags": [], "template_string": "$hair"}
    out = scan([HAIR], templates=[tpl])
    assert [f for f in out if f["severity"] != "tidy"] == []


def test_missing_ref_names_the_cached_name():
    w = wc("aaaa0002", "Look", "look",
           [opt("o1", "@{deadbeef#Eyes} and @{aaaa0001}"), opt("o2", "x")])
    tpl = {"id": "t1", "name": "T", "tags": [], "template_string": "@{cafebabe} $look"}
    out = checks(scan([HAIR, w], templates=[tpl]), "missing_ref")
    assert {f["item"]["id"] for f in out} == {"aaaa0002", "t1"}
    look = next(f for f in out if f["item"]["id"] == "aaaa0002")
    assert look["values"] == ["deadbeef"]
    assert '"Eyes"' in look["detail"]


def test_constraint_missing_wildcard_and_stale_rules():
    src = wc("aaaa0003", "Class", "class",
             [opt("c1", "mage", sub_categories=["magic"]), opt("c2", "rogue")],
             sub_categories=["magic"])
    tgt = wc("aaaa0004", "Weapon", "weapon",
             [opt("w1", "staff", sub_categories=["arcane"]), opt("w2", "dagger")],
             sub_categories=["arcane"])
    lost = mod("cccc0001", "constraint", "Lost", {"source_wildcard_id": "aaaa0003",
                                                   "target_wildcard_id": "ffff0000",
                                                   "matrix": {}, "exceptions": []})
    stale = mod("cccc0002", "constraint", "Stale", {
        "source_wildcard_id": "aaaa0003", "target_wildcard_id": "aaaa0004",
        "matrix": {"magic": {"arcane": {"mode": "boost", "factor": 2},
                             "heavy": {"mode": "exclude"}}},
        "exceptions": [{"source_value": "warrior", "target_value": "dagger", "mode": "exclude"},
                       {"source_value": "", "target_value": "staff", "mode": "exclude"}],
    })
    out = scan([src, tgt, lost, stale])
    assert [f["item"]["id"] for f in checks(out, "constraint_missing_wildcard")] == ["cccc0001"]
    assert "target" in checks(out, "constraint_missing_wildcard")[0]["detail"]
    st = checks(out, "constraint_stale_rule")
    assert [f["item"]["id"] for f in st] == ["cccc0002"]
    assert st[0]["values"] == ["heavy", "warrior"]


def test_dead_wildcards():
    empty = wc("aaaa0005", "Empty", "e", [])
    zeros = wc("aaaa0006", "Zeros", "z", [opt("o1", "a", 0), opt("o2", "b", 0)])
    nulls = wc("aaaa0007", "Nulls", "n", [{"id": "o1", "value": "", "weight": 1, "is_null": True}])
    saved = wc("aaaa0008", "Saved", "s", [opt("o1", "a", 0), opt("o2", "b", 0, fallback=True)])
    out = checks(scan([empty, zeros, nulls, saved]), "wildcard_dead")
    assert {f["item"]["id"] for f in out} == {"aaaa0005", "aaaa0006", "aaaa0007"}


def test_duplicates_and_zero_weight():
    w = wc("aaaa0009", "Mood", "mood", [opt("o1", "Calm"), opt("o2", "calm "), opt("o3", "dark", 0),
                                        opt("o4", "fb", 0, fallback=True)])
    twin = wc("aaaa0010", "Mood copy", "mood2",
              [opt("o1", "calm"), opt("o2", "dark"), opt("o3", "FB")])
    same_name = wc("aaaa0011", "hair", "hair2", [opt("o1", "x")])
    out = scan([HAIR, w, twin, same_name])
    assert checks(out, "duplicate_options")[0]["values"] == ["calm"]
    assert checks(out, "zero_weight")[0]["values"] == ["dark"]
    dup = checks(out, "duplicate_name")
    assert len(dup) == 1 and dup[0]["others"][0]["id"] in {"aaaa0001", "aaaa0011"}
    same = checks(out, "same_options")
    assert len(same) == 1
    assert {same[0]["item"]["id"], same[0]["others"][0]["id"]} == {"aaaa0009", "aaaa0010"}


def test_shared_variable():
    a = wc("aaaa0012", "Hair A", "hair", [opt("o1", "x")])
    out = checks(scan([HAIR, a]), "shared_variable")
    assert len(out) == 1 and out[0]["key"].endswith(":hair")


def test_unset_reads_skip_runtime_and_canvas_vars():
    combine = mod("bbbb0001", "combine", "Scene", {
        "template": "$hair $pose $iteration $model_family",
        "output_var": "scene", "input_vars": ["hair", "pose"]})
    tpl = {"id": "t1", "name": "T", "tags": [], "template_string": "$scene $light.neg"}
    out = checks(scan([HAIR, combine], templates=[tpl]), "unset_read")
    assert {f["item"]["id"]: f["values"] for f in out} == {"bbbb0001": ["pose"], "t1": ["light"]}
    out = checks(scan([HAIR, combine], templates=[tpl], canvas_ids=[],
                      canvas_vars=["pose", "light"]), "unset_read")
    assert out == []


def test_derivation_condition_reads_count():
    der = mod("dddd0001", "derivation", "D", {"rules": [{"id": "r", "branches": [{
        "condition": {"var": "weather", "op": "equals", "value": "rain"},
        "action": {"target_var": "mood", "mode": "replace", "value": "gloomy"}}]}]})
    out = scan([HAIR, der])
    assert checks(out, "unset_read")[0]["values"] == ["weather"]
    assert checks(out, "unread_variable")[0]["values"] == ["mood"]


def test_unread_variable_respects_canvas_reads():
    fv = mod("eeee0001", "fixed_values", "Style",
             {"values": [{"id": "v", "name": "style", "value": "oil"}]})
    assert checks(scan([fv]), "unread_variable")
    assert not checks(scan([fv], canvas_ids=[], canvas_reads=["style"]), "unread_variable")


def test_unused_counts_bundles_refs_constraints_templates_and_canvas():
    a = wc("aaaa0020", "A", "a", [opt("o", "x")])
    b = wc("aaaa0021", "B", "b", [opt("o", "@{aaaa0020}")])
    c = wc("aaaa0022", "C", "c", [opt("o", "y")])
    d = wc("aaaa0023", "D", "d", [opt("o", "z")])
    e = wc("aaaa0024", "E", "e", [opt("o", "w")])
    lone = wc("aaaa0025", "Lone", "lone", [opt("o", "q")])
    con = mod("cccc0009", "constraint", "Con", {"source_wildcard_id": "aaaa0022",
                                                 "target_wildcard_id": "aaaa0023"})
    bundle = {"id": "bund0001", "name": "Bun", "tags": [],
              "children": [{"id": "aaaa0021", "type": "wildcard", "payload": b["payload"]},
                           {"id": "cccc0009", "type": "constraint", "payload": con["payload"]}]}
    tpl = {"id": "t1", "name": "T", "tags": [], "template_string": "$e"}
    out = scan([a, b, c, d, e, lone, con], bundles=[bundle], templates=[tpl])
    assert [f["item"]["id"] for f in checks(out, "unused")] == ["aaaa0025"]
    assert "open one to check" in checks(out, "unused")[0]["detail"]
    out = scan([a, b, c, d, e, lone, con], bundles=[bundle], templates=[tpl],
               canvas_ids=["aaaa0025"])
    assert checks(out, "unused") == []


def test_bundle_children():
    stale_copy = {**HAIR["payload"], "options": [opt("o1", "red")]}
    bundle = {"id": "bund0002", "name": "Bun", "tags": [], "children": [
        {"id": "aaaa0001", "type": "wildcard", "payload": stale_copy, "payload_hash": "old"},
        {"id": "gone0001", "type": "wildcard", "meta": {"name": "Old hat"}, "payload": {}},
        {"id": "bund9999", "type": "bundle", "name": "Inner"},
    ]}
    out = scan([HAIR], bundles=[bundle])
    assert checks(out, "bundle_outdated")[0]["values"] == ["Hair"]
    assert checks(out, "bundle_detached")[0]["values"] == ["Old hat"]
    assert checks(out, "bundle_missing_bundle")[0]["values"] == ["Inner"]


def test_tags_categories_and_newer_format():
    a = wc("aaaa0030", "A", "a", [opt("o", "x")], tags=["outfits", "shared"], category_id="cat1")
    b = wc("aaaa0031", "B", "b", [opt("o", "y")], tags=["outfit", "shared"])
    cats = [{"id": "cat1", "name": "Used"}, {"id": "cat2", "name": "Empty"}]
    out = scan([a, b], categories=cats, newer_format_ids=["aaaa0031", "nope"])
    once = {f["item"]["id"]: f for f in checks(out, "tag_once")}
    assert set(once) == {"outfits", "outfit"}
    assert once["outfit"]["values"] == ["outfits"]
    assert [f["item"]["id"] for f in checks(out, "empty_category")] == ["cat2"]
    assert [f["item"]["id"] for f in checks(out, "newer_format")] == ["aaaa0031"]


def test_order_keys_and_counts():
    empty = wc("aaaa0040", "Empty", "e", [])
    out = scan([empty])
    order = list(CHECKS)
    assert [order.index(f["check"]) for f in out] == sorted(order.index(f["check"]) for f in out)
    assert out[0]["key"] == "wildcard_dead:module:aaaa0040"
    c = counts(out)
    assert c["problem"] == 1
    assert counts(out, [out[0]["key"]])["problem"] == 0


def test_empty_bundle_and_unnamed():
    nameless = wc("aaaa0050", "  ", "v", [opt("o", "x")])
    hollow = {"id": "bund0050", "name": "Hollow", "tags": [], "children": []}
    out = scan([nameless], bundles=[hollow])
    assert [f["item"]["id"] for f in checks(out, "empty_bundle")] == ["bund0050"]
    assert [f["item"]["id"] for f in checks(out, "unnamed")] == ["aaaa0050"]


def test_negatives_slot_and_escapes_are_not_reads():
    tpl = {"id": "t1", "name": "T", "tags": [], "template_string": "$hair costs $$5",
           "negative_template": "$negatives, lowres"}
    assert checks(scan([HAIR], templates=[tpl]), "unset_read") == []


def test_blank_options_say_so():
    blank = wc("aaaa0013", "Blank", "b", [opt("o1", "  ")])
    out = checks(scan([blank]), "wildcard_dead")
    assert out[0]["detail"] == "Its options have no text, so it prints nothing."


def test_keys_stay_put_and_follow_the_cause():
    a = wc("aaaa0020", "Hair", "h1", [opt("o1", "x")])
    b = wc("aaaa0021", "Hair", "h2", [opt("o1", "y")])
    key = checks(scan([a, b]), "duplicate_name")[0]["key"]
    assert checks(scan([b, a]), "duplicate_name")[0]["key"] == key
    t1 = {"id": "t1", "name": "T", "tags": [], "template_string": "$pose"}
    t2 = {"id": "t1", "name": "T", "tags": [], "template_string": "$pose $mood"}
    k1 = checks(scan(templates=[t1]), "unset_read")[0]["key"]
    k2 = checks(scan(templates=[t2]), "unset_read")[0]["key"]
    assert k1.startswith("unset_read:template:t1:") and k1 != k2
