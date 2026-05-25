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
