"""Python side of the cross-language parity check.

The same fixture (tests/fixtures/subcat_filter_cases.json) is consumed by
src/manager/parsing/__tests__/subcatFilter.test.ts so the Python engine and
the TS mirror stay equivalent on parse / reads_as / matches / validate.

Every case is routed through validate_expression so both the syntax layer
(parse) and the semantic layer (reserved / unknown sub-category) are covered
in both languages — the plan requires "every validation fixture runs in both".
"""
import json
import pathlib

from engine.syntax.subcat_filter import matches, parse, reads_as, validate_expression

CASES = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "subcat_filter_cases.json").read_text()
)
# Superset of every tag used by the valid fixture cases.
KNOWN = {"warm", "cold", "red", "pink", "green", "blue"}


def test_python_matches_fixture():
    for c in CASES:
        err = validate_expression(c["expr"], KNOWN)
        if not c["valid"]:
            assert err is not None, f"expected an error for {c['expr']!r}"
            assert c["error"] in err.lower(), (c["expr"], err)
            continue
        assert err is None, (c["expr"], err)
        ast = parse(c["expr"])
        assert reads_as(ast) == c["reads_as"], c["expr"]
        for k, want in c.get("matches", {}).items():
            assert matches(ast, set(k.split(","))) is want, (c["expr"], k)
