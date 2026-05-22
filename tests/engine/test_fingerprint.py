from engine._fingerprint import module_fingerprint


def _row(**overrides):
    base = {
        "type": "wildcard",
        "name": "x",
        "description": "",
        "tags": [],
        "payload_hash": "deadbeef",
    }
    base.update(overrides)
    return base


def test_module_fingerprint_stable():
    m = _row(
        name="color", description="Basic colors", tags=["palette", "demo"], payload_hash="abc123"
    )
    assert module_fingerprint(m) == module_fingerprint(m)


def test_module_fingerprint_returns_8_hex():
    fp = module_fingerprint(_row())
    assert len(fp) == 8
    int(fp, 16)


def test_module_fingerprint_differs_on_type_change():
    assert module_fingerprint(_row(type="wildcard")) != module_fingerprint(_row(type="combine"))


def test_module_fingerprint_differs_on_name_change():
    assert module_fingerprint(_row(name="a")) != module_fingerprint(_row(name="b"))


def test_module_fingerprint_differs_on_description_change():
    assert module_fingerprint(_row(description="a")) != module_fingerprint(_row(description="b"))


def test_module_fingerprint_tag_order_insensitive():
    assert module_fingerprint(_row(tags=["x", "y"])) == module_fingerprint(_row(tags=["y", "x"]))


def test_module_fingerprint_differs_on_payload_hash_change():
    assert module_fingerprint(_row(payload_hash="abc")) != module_fingerprint(
        _row(payload_hash="def")
    )


def test_module_fingerprint_ignores_out_of_scope_fields():
    a = _row()
    a.update({"id": "u1", "category_id": "c1", "is_favorite": True, "version": 1})
    b = _row()
    b.update({"id": "u2", "category_id": "c2", "is_favorite": False, "version": 9})
    assert module_fingerprint(a) == module_fingerprint(b)


def test_module_fingerprint_collision_prevention():
    """name='ab'+description='' must differ from name='a'+description='b'."""
    assert module_fingerprint(_row(name="ab", description="")) != module_fingerprint(
        _row(name="a", description="b")
    )


def test_python_matches_typescript_djb2_for_known_input():
    """Cross-language invariant: same djb2 output for identical input string.

    Verified value: djb2("test") == "7c73af33". Reproducible in TS via:
        let h=5381; for(let i=0;i<'test'.length;i++) h=((h*33)^'test'.charCodeAt(i))>>>0;
        console.log(h.toString(16).padStart(8,'0'));
    """
    from engine._fingerprint import _djb2
    assert _djb2("test") == "7c73af33"


def test_djb2_unicode_non_bmp_parity():
    """Non-BMP characters (emoji etc.) must hash same as JS charCodeAt.

    Verified TS value: djb2('happy 😀') == '38a7d268'.
    """
    from engine._fingerprint import _djb2
    assert _djb2("happy 😀") == "38a7d268"


def test_module_fingerprint_cross_language_parity():
    """Reference hash computed once via Node and locked in.

    Input parts: ["wildcard","color","Basic colors","demo,palette",
                  "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd"]
    joined by "\\n" → djb2 → "ba7a57fa"
    """
    m = {
        "type": "wildcard",
        "name": "color",
        "description": "Basic colors",
        "tags": ["palette", "demo"],
        "payload_hash": "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd",
    }
    assert module_fingerprint(m) == "ba7a57fa"
