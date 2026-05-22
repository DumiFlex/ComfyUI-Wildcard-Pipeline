from engine._fingerprint import (
    _djb2,
    _js_num_str,
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


def test_djb2_unicode_non_bmp_parity():
    """Non-BMP characters (emoji etc.) must hash same as JS.

    Verified TS value:
        let h=5381; for(let i=0;i<'happy 😀'.length;i++)
          h=((h*33)^'happy 😀'.charCodeAt(i))>>>0;
        h.toString(16).padStart(8,'0')  // => '38a7d268'
    """
    assert _djb2("happy 😀") == "38a7d268"


def test_wildcard_fingerprint_float_weight_matches_int():
    """Integer-valued float weight produces same hash as int weight.

    DB rows can deserialise weight as either Python int or float; both
    must produce the same hash so library MOD detection works regardless
    of round-trip type.
    """
    w_int = {"name": "x", "options": [{"value": "r", "weight": 1}], "tags": []}
    w_float = {"name": "x", "options": [{"value": "r", "weight": 1.0}], "tags": []}
    assert wildcard_fingerprint(w_int) == wildcard_fingerprint(w_float)


def test_constraint_fingerprint_float_value_matches_int():
    """Integer-valued float constraint value hashes same as int value.

    Mirror of the wildcard weight invariant: json.dumps would otherwise
    diverge for Python float vs int even though JS sees one Number type.
    """
    c_int = {"source_uuid": "s", "target_uuid": "t", "op": "equals", "value": 5}
    c_float = {"source_uuid": "s", "target_uuid": "t", "op": "equals", "value": 5.0}
    assert constraint_fingerprint(c_int) == constraint_fingerprint(c_float)


def test_cross_language_parity_wildcard_fixed_hash():
    """Hard-coded parity check against the TypeScript implementation.

    Computed once via Node:
        function djb2(s){let h=5381; for(let i=0;i<s.length;i++)
          h=((h*33)^s.charCodeAt(i))>>>0; return h.toString(16).padStart(8,'0');}
        const parts=['color','','red:1','a,b'];
        djb2(parts.join('\\n'));  // => '754cfde5'
    """
    w = {
        "name": "color",
        "var_binding": "",
        "options": [{"value": "red", "weight": 1}],
        "tags": ["a", "b"],
    }
    assert wildcard_fingerprint(w) == "754cfde5"


def test_js_num_str_1e16_boundary():
    """JS keeps integer notation for `1e16` through `1e20`; only `1e21`+ switches to exponential.

    Verified TS values:
        String(1e16) -> "10000000000000000"
        String(1e20) -> "100000000000000000000"
        String(1e21) -> "1e+21"
    """
    assert _js_num_str(1e16) == "10000000000000000"
    assert _js_num_str(1e20) == "100000000000000000000"
    # At/above 1e21 we fall through to Python str() which yields "1e+21" —
    # also matches JS at that boundary.
    assert _js_num_str(1e21) == "1e+21"
