"""Cross-language fitness test for composite-key encoding.

Reads the JSON fixture written by the Vitest fitness writer
(`src/components/context/editors/instance/keys.fitness.ts`) and asserts
Python `encode_key` produces byte-exact identical output for each input.

If JS encoding ever drifts from Python (e.g. someone changes the
separators or escape strategy), this test fails before the divergence
ships to users.
"""
import json
import pathlib

from engine.modules._keys import encode_key

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "encode_key_js_outputs.json"


def test_python_matches_js_outputs():
    assert FIXTURE.exists(), (
        "Fixture missing — regenerate via "
        "`npx tsx src/components/context/editors/instance/keys.fitness.ts`"
    )
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in cases:
        py_output = encode_key(case["input"])
        assert py_output == case["output"], (
            f"input={case['input']!r}: js={case['output']!r} py={py_output!r}"
        )
