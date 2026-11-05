"""Node-level tests for WP_PromptCleaner."""
from wp_nodes.prompt_cleaner import _parse_config


def test_parse_config_handles_json_string():
    out = _parse_config('{"intensity": "aggressive"}')
    assert out == {"intensity": "aggressive"}


def test_parse_config_handles_dict():
    src = {"intensity": "gentle"}
    assert _parse_config(src) is src


def test_parse_config_handles_invalid_json():
    assert _parse_config("not-json") == {}


def test_parse_config_handles_none():
    assert _parse_config(None) == {}


def test_parse_config_handles_non_dict_json():
    assert _parse_config("[1,2,3]") == {}


def test_wired_blocklist_adds_to_the_panel_entries():
    import json

    from wp_nodes.prompt_cleaner import WPPromptCleaner, _with_wired_blocklist

    cfg = {"blocklist": {"kind": "list", "entries": ["cat"]}}
    out = _with_wired_blocklist(cfg, "dog, cat\nbird ,")
    assert out["blocklist"]["entries"] == ["cat", "dog", "bird"]
    assert cfg["blocklist"]["entries"] == ["cat"]  # the panel's config is left alone
    assert _with_wired_blocklist(cfg, "  ") is cfg
    assert _with_wired_blocklist(cfg, None) is cfg
    regex = _with_wired_blocklist({"blocklist": {"kind": "regex"}}, "a{1,3}\nb+")
    assert regex["blocklist"]["entries"] == ["a{1,3}", "b+"]

    raw = json.dumps({"blocklist": {"kind": "list", "entries": ["cat"]}})
    res = WPPromptCleaner.execute("cat, dog, tree", raw, blocklist="dog")
    assert res.values[0] == "tree"


def test_schema_has_the_blocklist_socket():
    from wp_nodes.prompt_cleaner import WPPromptCleaner

    names = [i.name for i in WPPromptCleaner.define_schema().inputs]
    assert names == ["prompt", "negative", "blocklist", "wp_cleaner"]
