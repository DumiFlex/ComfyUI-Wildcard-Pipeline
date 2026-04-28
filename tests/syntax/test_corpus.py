"""Verify the syntax corpus is well-formed and the version pin matches.

Bumping `EXPECTED_CORPUS_VERSION` requires also updating the TS test that
pins the same number. Forces a coupled-update conversation in PR review.
"""
from __future__ import annotations

import json
from pathlib import Path

CORPUS_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "syntax-corpus.json"
EXPECTED_CORPUS_VERSION = 1


def load_corpus() -> dict:
    return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


def test_corpus_file_exists():
    assert CORPUS_PATH.is_file(), f"corpus missing at {CORPUS_PATH}"


def test_corpus_version_matches():
    assert load_corpus()["version"] == EXPECTED_CORPUS_VERSION, (
        "Corpus version mismatch — re-confirm test expectations match new "
        "schema before bumping EXPECTED_CORPUS_VERSION (and the TS twin)."
    )


def test_corpus_has_cases():
    cases = load_corpus()["cases"]
    assert isinstance(cases, list)
    assert len(cases) >= 3, "seed corpus needs at least empty / literal / escape cases"


def test_each_case_has_required_fields():
    for c in load_corpus()["cases"]:
        assert "name" in c, f"case missing name: {c}"
        assert "input" in c, f"case missing input: {c['name']}"
        assert "expected_tokens" in c, f"case missing expected_tokens: {c['name']}"


def test_case_names_unique():
    names = [c["name"] for c in load_corpus()["cases"]]
    assert len(names) == len(set(names)), "duplicate case names"
