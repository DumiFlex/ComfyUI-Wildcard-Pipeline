"""The one-pass stamper (`schema_versions_used`) finds exactly what the
per-feature `uses_*` scans find, on every real fixture we ship and on a
seeded random corpus built from the markers each scan looks for."""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

from engine.migrations import (
    BOOL_ACCESSOR_SCHEMA_VERSION,
    CONSTRAINT_ONLY_SCHEMA_VERSION,
    DERIVATION_CONDITIONS_SCHEMA_VERSION,
    FALLBACK_SCHEMA_VERSION,
    FILTER_VARIABLES_SCHEMA_VERSION,
    NEGATED_TESTS_SCHEMA_VERSION,
    NEGATIVES_SCHEMA_VERSION,
    SP2B_SCHEMA_VERSION,
    SP3_REACH_SCHEMA_VERSION,
    TAG_AXES_SCHEMA_VERSION,
)
from engine.migrations import stamping as st

ROOT = Path(__file__).resolve().parents[2]

_SCANS = (
    (BOOL_ACCESSOR_SCHEMA_VERSION, st.uses_bool_accessor),
    (FILTER_VARIABLES_SCHEMA_VERSION, st.uses_filter_variables),
    (NEGATED_TESTS_SCHEMA_VERSION, st.uses_negated_tests),
    (FALLBACK_SCHEMA_VERSION, st.uses_fallback_option),
    (NEGATIVES_SCHEMA_VERSION, st.uses_negatives),
    (DERIVATION_CONDITIONS_SCHEMA_VERSION, st.uses_derivation_conditions),
    (CONSTRAINT_ONLY_SCHEMA_VERSION, st.uses_constraint_only_rule),
    (TAG_AXES_SCHEMA_VERSION, st.uses_accepts_tag_axis),
    (SP3_REACH_SCHEMA_VERSION, st.uses_target_select_reach),
    (SP2B_SCHEMA_VERSION, st.uses_sp2b_grammar),
)


def _per_scan(node: Any) -> set[int]:
    return {version for version, scan in _SCANS if scan(node)}


def _subtrees(node: Any):
    yield node
    if isinstance(node, dict):
        for value in node.values():
            yield from _subtrees(value)
    elif isinstance(node, list):
        for value in node:
            yield from _subtrees(value)


def _fixture_docs() -> list[Any]:
    docs: list[Any] = []
    folders = [ROOT / "tests" / "fixtures", ROOT / "src" / "validators" / "fixtures"]
    files = [p for f in folders if f.is_dir() for p in sorted(f.rglob("*.json"))]
    files.append(ROOT / "bench" / "bench-library.json")
    for path in files:
        try:
            docs.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return docs


def test_one_pass_matches_every_scan_on_the_shipped_fixtures():
    docs = _fixture_docs()
    assert len(docs) > 20
    checked = 0
    seen: set[int] = set()
    for doc in docs:
        for node in _subtrees(doc):
            if not isinstance(node, (dict, list)):
                continue
            expected = _per_scan(node)
            assert st.schema_versions_used(node) == expected, json.dumps(node)[:400]
            assert st.schema_version_for_payload(node) == st._schema_version_per_scan(node)
            seen |= expected
            checked += 1
    assert checked > 1000
    # The fixtures exercise several features, not just the baseline.
    assert len(seen) >= 4


_KEYS = [
    "negative", "negative_override", "mode", "target_var", "extra_actions", "fallback",
    "value", "op", "var", "category_filter", "branches", "condition", "conditions",
    "matrix", "exceptions", "extra_exceptions", "cell_mode_overrides",
    "exception_mode_overrides", "tag_group_kinds", "target_select", "count", "picks",
    "payload", "children", "options", "template", "instance", "x", "{1-2$$k}",
]
_TEXT = [
    "", " ", "plain", "$a.neg", "$a.2.neg", "$a.negx", "$x.bool", "$x.1.bool", "x.bool",
    "$x.boolean", "@{abcdef12:$v}", "@{abcdef12#Name:hair & $v}", "@{abcdef12:red}",
    "{1-2$$a|b}", "{3~$$, $$a|b}", "{2$$a|b}", "only", "accepts", "all", "next", "pick",
    "negative", "negative_replace", "append", "not_contains", "not_matches", "contains",
    "is_empty", "is_not_empty", "$hair", "hair | $v", "red & !$v", "café {1-3$$é|ü}",
]


def _scalar(rng: random.Random) -> Any:
    roll = rng.random()
    if roll < 0.55:
        return rng.choice(_TEXT)
    if roll < 0.65:
        return rng.choice([True, False, None])
    if roll < 0.8:
        return rng.choice([0, 1, 2, 2.5, -1])
    if roll < 0.85:
        return tuple(rng.choice(_TEXT) for _ in range(rng.randint(0, 2)))
    if roll < 0.93:
        # Branch lists, the one shape a flat random dict rarely hits.
        cond = rng.choice([{"conditions": []}, {"op": "is_empty"}, {"op": "equals"}, "x"])
        return [{"condition": cond}, rng.choice(_TEXT)]
    return rng.choice([[], {}])


def _node(rng: random.Random, depth: int) -> Any:
    if depth <= 0 or rng.random() < 0.25:
        return _scalar(rng)
    if rng.random() < 0.3:
        return [_node(rng, depth - 1) for _ in range(rng.randint(0, 4))]
    out: dict[str, Any] = {}
    for _ in range(rng.randint(0, 5)):
        out[rng.choice(_KEYS)] = _node(rng, depth - 1)
    return out


def test_one_pass_matches_every_scan_on_a_random_corpus():
    seen: set[int] = set()
    for seed in range(8):
        rng = random.Random(seed)
        for _ in range(800):
            node = _node(rng, 5)
            expected = _per_scan(node)
            assert st.schema_versions_used(node) == expected, repr(node)[:400]
            assert st.schema_version_for_payload(node) == st._schema_version_per_scan(node)
            seen |= expected
    # Every feature turns up somewhere in the corpus.
    assert seen == {version for version, _ in _SCANS}


def test_top_level_strings_and_tuples():
    for node in ["{1-2$$a}", "$x.bool", "@{abcdef12:$v}", "$a.neg", ("{1-2$$a}",), 3, None]:
        assert st.schema_versions_used(node) == _per_scan(node)
