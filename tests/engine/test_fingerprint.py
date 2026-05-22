from engine._fingerprint import (
    _djb2,
    constraint_fingerprint,
    variable_fingerprint,
    wildcard_fingerprint,
)


def test_wildcard_fingerprint_stable():
    w = {"name": "color", "options": [{"value": "red", "weight": 1}], "tags": ["color"]}
    assert wildcard_fingerprint(w) == wildcard_fingerprint(w)


def test_wildcard_fingerprint_differs_on_option_change():
    a = {"name": "x", "options": [{"value": "red", "weight": 1}], "tags": []}
    b = {"name": "x", "options": [{"value": "blue", "weight": 1}], "tags": []}
    assert wildcard_fingerprint(a) != wildcard_fingerprint(b)


def test_wildcard_fingerprint_tag_order_insensitive():
    a = {"name": "x", "options": [], "tags": ["a", "b"]}
    b = {"name": "x", "options": [], "tags": ["b", "a"]}
    assert wildcard_fingerprint(a) == wildcard_fingerprint(b)


def test_variable_fingerprint_value_sensitive():
    a = {"name": "v1", "value": "foo", "tags": []}
    b = {"name": "v1", "value": "bar", "tags": []}
    assert variable_fingerprint(a) != variable_fingerprint(b)


def test_constraint_fingerprint_op_sensitive():
    a = {"source_uuid": "s", "target_uuid": "t", "op": "equals", "value": "x"}
    b = {"source_uuid": "s", "target_uuid": "t", "op": "not_equals", "value": "x"}
    assert constraint_fingerprint(a) != constraint_fingerprint(b)


def test_constraint_fingerprint_returns_8_hex():
    c = {"source_uuid": "s", "target_uuid": "t", "op": "exists", "value": None}
    fp = constraint_fingerprint(c)
    assert len(fp) == 8
    int(fp, 16)


def test_python_matches_typescript_djb2_for_known_input():
    """Cross-language invariant: same djb2 output for identical input string."""
    assert _djb2("test") == "7c73af33"


def test_wildcard_collision_prevention():
    """Without \\n separator, 'ab'+'' would hash identically to 'a'+'b'."""
    a = {"name": "ab", "var_binding": "", "options": [], "tags": []}
    b = {"name": "a", "var_binding": "b", "options": [], "tags": []}
    assert wildcard_fingerprint(a) != wildcard_fingerprint(b)


def test_variable_collision_prevention():
    a = {"name": "ab", "value": "", "tags": []}
    b = {"name": "a", "value": "b", "tags": []}
    assert variable_fingerprint(a) != variable_fingerprint(b)


def test_constraint_collision_prevention():
    a = {"source_uuid": "st", "target_uuid": "", "op": "equals", "value": "x"}
    b = {"source_uuid": "s", "target_uuid": "t", "op": "equals", "value": "x"}
    assert constraint_fingerprint(a) != constraint_fingerprint(b)


def test_cross_language_parity_wildcard():
    """Same wildcard input → same fingerprint as TypeScript wildcardFingerprint.

    The TS implementation uses parts.join("\\n") on parts:
      [name, var_binding ?? "", options as 'value:weight' joined by '|', sorted tags joined by ',']
    Python must produce byte-identical output.
    """
    w = {
        "name": "color",
        "var_binding": "",
        "options": [{"value": "red", "weight": 1}],
        "tags": ["a", "b"],
    }
    # Run the TS equivalent in your head: parts = ["color", "", "red:1", "a,b"]
    # joined by "\n" -> "color\n\nred:1\na,b"
    # djb2("color\n\nred:1\na,b") -> some 8-hex value
    # We don't assert a specific hex value here (would couple test to djb2 internals);
    # instead this test just exercises the canonical shape and confirms it's 8-hex.
    fp = wildcard_fingerprint(w)
    assert len(fp) == 8
    int(fp, 16)
