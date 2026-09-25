"""Content-driven schema_version stamping. Mirrors the TS cases in
`src/manager/__tests__/import-export/publish-stamping.test.ts`."""
import pytest

from engine.migrations import (
    CURRENT_SCHEMA_VERSION,
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
