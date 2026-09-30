"""Content-driven schema_version stamping. Mirrors the TS cases in
`src/manager/__tests__/import-export/publish-stamping.test.ts`."""
import pytest

from engine.migrations import (
    CONSTRAINT_ONLY_SCHEMA_VERSION,
    CURRENT_SCHEMA_VERSION,
    DERIVATION_CONDITIONS_SCHEMA_VERSION,
    NEGATIVES_SCHEMA_VERSION,
    SP2B_SCHEMA_VERSION,
    SP3_REACH_SCHEMA_VERSION,
    TAG_AXES_SCHEMA_VERSION,
)
from engine.migrations.stamping import schema_version_for_payload


def _constraint_row(target_select=None):
    payload = {"source_wildcard_id": "aaaaaaaa", "target_wildcard_id": "bbbbbbbb", "rules": []}
    if target_select is not None:
        payload["target_select"] = target_select
    return {"id": "cccccccc", "type": "constraint", "name": "c", "payload": payload}


@pytest.mark.parametrize("template, expected", [
    ("{2$$, $$a|b}", CURRENT_SCHEMA_VERSION),  # plain fixed count predates SP2b
    ("{2-4$$, $$a|b}", SP2B_SCHEMA_VERSION),
    ("{2-4~$$, $$a|b}", SP2B_SCHEMA_VERSION),
    ("{3~$$, $$a|b}", SP2B_SCHEMA_VERSION),
    ("a {red|blue} c", CURRENT_SCHEMA_VERSION),
])
def test_sp2b_text_grammar(template, expected):
    assert schema_version_for_payload({"template": template}) == expected


def test_sp2b_marker_found_deep_in_a_row():
    row = {"payload": {"options": [{"id": "o", "value": "x {1-2$$ and $$p|q}"}]}}
    assert schema_version_for_payload(row) == SP2B_SCHEMA_VERSION


def test_sp2b_marker_found_next_to_non_ascii_text():
    row = {"payload": {"options": [{"value": "café {1-3$$, $$é|ü}"}]}}
    assert schema_version_for_payload(row) == SP2B_SCHEMA_VERSION


@pytest.mark.parametrize("target_select, expected", [
    ({"mode": "next", "count": 2}, SP3_REACH_SCHEMA_VERSION),
    ({"mode": "first"}, SP3_REACH_SCHEMA_VERSION),
    ({"mode": "pick", "picks": [{"uid": "x"}]}, SP3_REACH_SCHEMA_VERSION),
    ({"mode": "pick", "picks": []}, SP3_REACH_SCHEMA_VERSION),
    ({"mode": "all", "count": 1}, SP3_REACH_SCHEMA_VERSION),
    ({"mode": "all"}, CURRENT_SCHEMA_VERSION),
    ({"mode": "all", "count": True}, CURRENT_SCHEMA_VERSION),  # bool is not a count
    (None, CURRENT_SCHEMA_VERSION),
])
def test_constraint_reach(target_select, expected):
    assert schema_version_for_payload(_constraint_row(target_select)) == expected


def test_reach_found_in_instance_override_inside_bundle_child():
    bundle = {"id": "dddddddd", "name": "b", "children": [
        {"type": "constraint", "payload": {},
         "instance": {"target_select": {"mode": "next", "count": 1}}},
    ]}
    assert schema_version_for_payload(bundle) == SP3_REACH_SCHEMA_VERSION


@pytest.mark.parametrize("kinds, expected", [
    ({"color": "classify", "shoes": "accepts"}, TAG_AXES_SCHEMA_VERSION),
    ({"color": "classify"}, CURRENT_SCHEMA_VERSION),
    ({}, CURRENT_SCHEMA_VERSION),
])
def test_accepts_tag_axis(kinds, expected):
    row = {"type": "wildcard", "payload": {"options": [], "tag_group_kinds": kinds}}
    assert schema_version_for_payload(row) == expected


def test_highest_feature_wins():
    payload = {
        "wildcards": [{"payload": {"options": [{"value": "{1-2$$ $$a|b}"}],
                                   "tag_group_kinds": {"g": "accepts"}}}],
        "constraints": [_constraint_row({"mode": "first"})],
    }
    assert schema_version_for_payload(payload) == TAG_AXES_SCHEMA_VERSION
    del payload["wildcards"][0]["payload"]["tag_group_kinds"]
    assert schema_version_for_payload(payload) == SP3_REACH_SCHEMA_VERSION
    payload["constraints"] = []
    assert schema_version_for_payload(payload) == SP2B_SCHEMA_VERSION


_ONLY = {"mode": "only", "factor": 1.0}


@pytest.mark.parametrize("payload_extra, instance, expected", [
    ({"exceptions": [{"source_value": "a", "target_value": "b", **_ONLY}]}, None,
     CONSTRAINT_ONLY_SCHEMA_VERSION),
    ({"matrix": {"summer": {"open": _ONLY}}}, None, CONSTRAINT_ONLY_SCHEMA_VERSION),
    ({}, {"cell_mode_overrides": {"k": "only"}}, CONSTRAINT_ONLY_SCHEMA_VERSION),
    ({}, {"exception_mode_overrides": {"k": "only"}}, CONSTRAINT_ONLY_SCHEMA_VERSION),
    ({}, {"extra_exceptions": [{"source": "a", "target": "b", **_ONLY}]},
     CONSTRAINT_ONLY_SCHEMA_VERSION),
    ({"matrix": {"summer": {"open": {"mode": "boost", "factor": 2.0}}}},
     {"cell_mode_overrides": {"k": "exclude"}}, CURRENT_SCHEMA_VERSION),
])
def test_constraint_only_rule(payload_extra, instance, expected):
    row = _constraint_row()
    row["payload"].update(payload_extra)
    if instance is not None:
        row["instance"] = instance
    assert schema_version_for_payload(row) == expected


def test_only_rule_outranks_accepts_axis():
    row = _constraint_row()
    row["payload"]["exceptions"] = [{"source_value": "a", "target_value": "b", **_ONLY}]
    bundle = {"children": [
        row,
        {"type": "wildcard", "payload": {"options": [], "tag_group_kinds": {"g": "accepts"}}},
    ]}
    assert schema_version_for_payload(bundle) == CONSTRAINT_ONLY_SCHEMA_VERSION


def _derivation_row(condition):
    return {"id": "dddddddd", "type": "derivation", "name": "d", "payload": {"rules": [
        {"id": "r1", "branches": [
            {"condition": condition,
             "action": {"target_var": "t", "mode": "replace", "value": "v"}},
        ]},
    ]}}


_TEST = {"var": "mood", "op": "equals", "value": "calm"}


@pytest.mark.parametrize("condition, expected", [
    (_TEST, CURRENT_SCHEMA_VERSION),
    ({"var": "mood", "op": "is_set", "value": ""}, CURRENT_SCHEMA_VERSION),
    ({"var": "mood", "op": "is_empty", "value": ""}, DERIVATION_CONDITIONS_SCHEMA_VERSION),
    ({"var": "mood", "op": "is_not_empty", "value": ""}, DERIVATION_CONDITIONS_SCHEMA_VERSION),
    ({"match": "all", "conditions": [_TEST, _TEST]}, DERIVATION_CONDITIONS_SCHEMA_VERSION),
    ({"match": "any", "conditions": [_TEST]}, DERIVATION_CONDITIONS_SCHEMA_VERSION),
])
def test_derivation_conditions(condition, expected):
    assert schema_version_for_payload(_derivation_row(condition)) == expected


def test_derivation_group_outranks_only_rule_inside_a_bundle():
    only = _constraint_row()
    only["payload"]["exceptions"] = [{"source_value": "a", "target_value": "b", **_ONLY}]
    bundle = {"children": [
        only,
        _derivation_row({"match": "any", "conditions": [_TEST, _TEST]}),
    ]}
    assert schema_version_for_payload(bundle) == DERIVATION_CONDITIONS_SCHEMA_VERSION


# ── v8 send-to-negative ────────────────────────────────────────────────


def _wildcard_row(negative):
    opt = {"id": "o1", "value": "red", "weight": 1}
    if negative is not None:
        opt["negative"] = negative
    return {"id": "eeeeeeee", "type": "wildcard", "name": "w",
            "payload": {"var_binding": "w", "options": [opt]}}


@pytest.mark.parametrize("negative, expected", [
    (None, CURRENT_SCHEMA_VERSION),
    ("", CURRENT_SCHEMA_VERSION),
    ("   ", CURRENT_SCHEMA_VERSION),
    ("blurry", NEGATIVES_SCHEMA_VERSION),
])
def test_option_negative(negative, expected):
    assert schema_version_for_payload(_wildcard_row(negative)) == expected


def test_fixed_value_and_combine_negatives():
    fixed = {"id": "ffffffff", "type": "fixed_values", "name": "f", "payload": {
        "values": [{"id": "v1", "name": "style", "value": "oil", "negative": "photo"}]}}
    combine = {"id": "abababab", "type": "combine", "name": "c", "payload": {
        "template": "$a", "output_var": "c", "negative": "cropped"}}
    assert schema_version_for_payload(fixed) == NEGATIVES_SCHEMA_VERSION
    assert schema_version_for_payload(combine) == NEGATIVES_SCHEMA_VERSION


def test_add_to_negative_action_and_bundle_child():
    row = _derivation_row(_TEST)
    row["payload"]["rules"][0]["branches"][0]["action"]["mode"] = "negative"
    assert schema_version_for_payload(row) == NEGATIVES_SCHEMA_VERSION
    row["payload"]["rules"][0]["branches"][0]["action"]["mode"] = "negative_replace"
    assert schema_version_for_payload(row) == NEGATIVES_SCHEMA_VERSION
    bundle = {"children": [
        _derivation_row({"match": "any", "conditions": [_TEST]}),
        _wildcard_row("blurry"),
    ]}
    assert schema_version_for_payload(bundle) == NEGATIVES_SCHEMA_VERSION


def test_extra_actions_need_v8():
    row = _derivation_row(_TEST)
    branch = row["payload"]["rules"][0]["branches"][0]
    branch["extra_actions"] = []
    assert schema_version_for_payload(row) == CURRENT_SCHEMA_VERSION
    branch["extra_actions"] = [{"target_var": "u", "mode": "replace", "value": "w"}]
    assert schema_version_for_payload(row) == NEGATIVES_SCHEMA_VERSION


@pytest.mark.parametrize("template, expected", [
    ("$pose", CURRENT_SCHEMA_VERSION),
    ("$pose.negx", CURRENT_SCHEMA_VERSION),
    ("$pose.neg", NEGATIVES_SCHEMA_VERSION),
    ("a $pose.1.neg b", NEGATIVES_SCHEMA_VERSION),
    ("$pose.neg.0", NEGATIVES_SCHEMA_VERSION),
])
def test_neg_accessor_text(template, expected):
    combine = {"id": "abababab", "type": "combine", "name": "c", "payload": {
        "template": template, "output_var": "c"}}
    assert schema_version_for_payload(combine) == expected
