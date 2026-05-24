"""Node-level smoke + adapter tests for WP_PromptCleaner.

The engine pipeline has its own dedicated test suite; here we only
verify that:
  - PIPELINE_CONTEXT (ContextPayload) → CleanerCtx adapter populates
    picks / warnings / constraints correctly.
  - Dict-shaped fixture also accepted (legacy/test convenience).
  - _parse_config handles JSON string + dict + None inputs.
"""
from wp_nodes.prompt_cleaner import _build_cleaner_ctx, _parse_config
from wp_nodes.types import ContextPayload


def test_build_ctx_from_pipeline_payload_extracts_picks():
    payload = ContextPayload(
        context={},
        debug={"__wp_warnings__": [{"type": "unknown_var", "detail": {"name": "x"}}]},
        internals={"__wp_picks__": {"wc_hair": {"value": "pixie cut"}}},
    )
    ctx = _build_cleaner_ctx(payload)
    assert ctx is not None
    assert ctx.picks == {"wc_hair": {"value": "pixie cut"}}
    assert ctx.warnings[0]["type"] == "unknown_var"


def test_build_ctx_accepts_dict_fixture():
    pipeline_ctx = {
        "__wp_picks__": {"wc_hair": {"value": "pixie cut"}},
        "__wp_constraints__": [],
        "__wp_warnings__": [{"type": "unknown_var", "detail": {"name": "x"}}],
    }
    ctx = _build_cleaner_ctx(pipeline_ctx)
    assert ctx is not None
    assert ctx.picks == {"wc_hair": {"value": "pixie cut"}}
    assert ctx.warnings[0]["type"] == "unknown_var"


def test_build_ctx_returns_none_when_pipeline_context_none():
    assert _build_cleaner_ctx(None) is None


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
