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

import pytest

from engine.modules._keys import decode_key, encode_key

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


def test_decode_key_round_trip():
    cases = [
        ["red", "black"],
        ["", ""],
        ["ascii", "unicode-é"],
        ["with,comma", "with]bracket"],
    ]
    for parts in cases:
        encoded = encode_key(parts)
        assert decode_key(encoded) == parts


def test_decode_key_rejects_non_array():
    with pytest.raises(ValueError):
        decode_key('"just-a-string"')


def test_decode_key_rejects_array_with_non_strings():
    with pytest.raises(ValueError):
        decode_key('["red",42]')


def test_decode_key_rejects_malformed_json():
    with pytest.raises(ValueError):
        decode_key("not-json")
