"""Tests for the pipeline engine."""

from unittest.mock import patch

from engine.pipeline import PipelineEngine, resolve_variables


class TestPipelineEngineFixed:
    """Test the fixed module handler."""

    def test_fixed_captures_value(self):
        engine = PipelineEngine()
        modules = [{"type": "fixed", "value": "hello world", "capture_as": "$greeting"}]
        ctx = engine.run(modules, {})
        assert ctx["greeting"] == "hello world"

    def test_fixed_strips_dollar_prefix(self):
        engine = PipelineEngine()
        modules = [{"type": "fixed", "value": "test", "capture_as": "$myvar"}]
        ctx = engine.run(modules, {})
        assert "myvar" in ctx
        assert "$myvar" not in ctx

    def test_fixed_without_capture_is_noop(self):
        engine = PipelineEngine()
        modules = [{"type": "fixed", "value": "orphan", "capture_as": ""}]
        ctx = engine.run(modules, {})
        assert len(ctx) == 0


class TestPipelineEngineCombine:
    """Test the combine module handler."""

    def test_combine_resolves_variables(self):
        engine = PipelineEngine()
        ctx = {"location": "forest", "lighting": "golden hour"}
        modules = [
            {
                "type": "combine",
                "template": "$location, $lighting",
                "capture_as": "$environment",
            },
        ]
        ctx = engine.run(modules, ctx)
        assert ctx["environment"] == "forest, golden hour"

    def test_combine_preserves_existing_context(self):
        engine = PipelineEngine()
        ctx = {"a": "1", "b": "2"}
        modules = [
            {"type": "combine", "template": "$a + $b", "capture_as": "$sum"},
        ]
        ctx = engine.run(modules, ctx)
        assert ctx["a"] == "1"
        assert ctx["b"] == "2"
        assert ctx["sum"] == "1 + 2"


class TestPipelineEngineWildcard:
    """Test the wildcard module handler with weighted sampling."""

    def test_wildcard_selects_from_options(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [
                    {"value": "forest", "weight": 80},
                    {"value": "desert", "weight": 20},
                ],
                "capture_as": "$location",
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["location"] in ("forest", "desert")

    def test_wildcard_respects_weights(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [
                    {"value": "heavy", "weight": 100},
                    {"value": "light", "weight": 0},
                ],
                "capture_as": "$pick",
            },
        ]
        with patch(
            "engine.pipeline.random.choices",
            return_value=[{"value": "heavy", "weight": 100}],
        ) as mock:
            ctx = engine.run(modules, {})
            mock.assert_called_once()
            args, kwargs = mock.call_args
            assert kwargs["weights"] == [100, 0]
            assert ctx["pick"] == "heavy"

    def test_wildcard_all_zero_weights_uses_uniform(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [
                    {"value": "a", "weight": 0},
                    {"value": "b", "weight": 0},
                ],
                "capture_as": "$pick",
            },
        ]
        with patch(
            "engine.pipeline.random.choices", return_value=[{"value": "a", "weight": 0}]
        ) as mock:
            engine.run(modules, {})
            _, kwargs = mock.call_args
            assert kwargs["weights"] == [1.0, 1.0]

    def test_wildcard_missing_weight_defaults_to_one(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [
                    {"value": "no_weight"},
                    {"value": "has_weight", "weight": 5},
                ],
                "capture_as": "$pick",
            },
        ]
        with patch(
            "engine.pipeline.random.choices", return_value=[{"value": "no_weight"}]
        ) as mock:
            engine.run(modules, {})
            _, kwargs = mock.call_args
            assert kwargs["weights"] == [1.0, 5]

    def test_wildcard_single_option(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [{"value": "only_one", "weight": 10}],
                "capture_as": "$pick",
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["pick"] == "only_one"

    def test_wildcard_empty_options_is_noop(self):
        engine = PipelineEngine()
        modules = [
            {"type": "wildcard", "options": [], "capture_as": "$x"},
        ]
        ctx = engine.run(modules, {})
        assert "x" not in ctx


class TestResolveVariables:
    """Test the resolve_variables function (regex-based $var resolution)."""

    def test_simple_substitution(self):
        assert resolve_variables("$a and $b", {"a": "X", "b": "Y"}) == "X and Y"

    def test_missing_variable_left_as_is(self):
        assert (
            resolve_variables("$known and $unknown", {"known": "X"}) == "X and $unknown"
        )

    def test_dollar_escape(self):
        assert resolve_variables("Price is $$100", {"100": "WRONG"}) == "Price is $100"

    def test_internal_keys_not_substituted(self):
        ctx = {"__internal__": "secret", "visible": "ok"}
        assert resolve_variables("$__internal__ $visible", ctx) == "$__internal__ ok"

    def test_empty_template(self):
        assert resolve_variables("", {"a": "1"}) == ""

    def test_no_variables_in_template(self):
        assert resolve_variables("plain text", {"a": "1"}) == "plain text"

    def test_adjacent_variables(self):
        assert resolve_variables("$a$b", {"a": "X", "b": "Y"}) == "XY"

    def test_numeric_context_value_converted_to_string(self):
        assert resolve_variables("count: $n", {"n": 42}) == "count: 42"

    def test_multiline_template(self):
        template = "line1: $a\nline2: $b"
        result = resolve_variables(template, {"a": "X", "b": "Y"})
        assert result == "line1: X\nline2: Y"


class TestPipelineEngineChaining:
    """Test multiple modules running in sequence."""

    def test_modules_execute_top_to_bottom(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "forest", "capture_as": "$location"},
            {"type": "fixed", "value": "golden hour", "capture_as": "$lighting"},
            {
                "type": "combine",
                "template": "$location at $lighting",
                "capture_as": "$scene",
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["scene"] == "forest at golden hour"

    def test_upstream_context_is_preserved(self):
        engine = PipelineEngine()
        upstream_ctx = {"character": "wanderer"}
        modules = [
            {"type": "fixed", "value": "forest", "capture_as": "$location"},
        ]
        ctx = engine.run(modules, upstream_ctx)
        assert ctx["character"] == "wanderer"
        assert ctx["location"] == "forest"

    def test_unknown_module_type_is_skipped(self):
        engine = PipelineEngine()
        modules = [
            {"type": "unknown_future_type", "data": "foo"},
            {"type": "fixed", "value": "works", "capture_as": "$result"},
        ]
        ctx = engine.run(modules, {})
        assert ctx["result"] == "works"

    def test_internal_keys_preserved_across_modules(self):
        engine = PipelineEngine()
        ctx = {"__active_filter__": {"exclude": ["desert"]}}
        modules = [
            {"type": "fixed", "value": "forest", "capture_as": "$location"},
        ]
        ctx = engine.run(modules, ctx)
        assert ctx["__active_filter__"] == {"exclude": ["desert"]}
        assert ctx["location"] == "forest"


class TestPipelineEngineValidation:
    """Test module schema validation and error handling."""

    def test_module_missing_type_is_skipped(self):
        engine = PipelineEngine()
        modules = [
            {"value": "no type key", "capture_as": "$x"},
            {"type": "fixed", "value": "ok", "capture_as": "$y"},
        ]
        ctx = engine.run(modules, {})
        assert "x" not in ctx
        assert ctx["y"] == "ok"

    def test_module_empty_type_is_skipped(self):
        engine = PipelineEngine()
        modules = [
            {"type": "", "value": "empty type", "capture_as": "$x"},
            {"type": "fixed", "value": "ok", "capture_as": "$y"},
        ]
        ctx = engine.run(modules, {})
        assert "x" not in ctx
        assert ctx["y"] == "ok"

    def test_fixed_missing_required_key_is_skipped(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "capture_as": "$x"},
            {"type": "fixed", "value": "ok", "capture_as": "$y"},
        ]
        ctx = engine.run(modules, {})
        assert "x" not in ctx
        assert ctx["y"] == "ok"

    def test_combine_missing_template_is_skipped(self):
        engine = PipelineEngine()
        modules = [
            {"type": "combine", "capture_as": "$x"},
            {"type": "fixed", "value": "ok", "capture_as": "$y"},
        ]
        ctx = engine.run(modules, {})
        assert "x" not in ctx
        assert ctx["y"] == "ok"

    def test_wildcard_missing_capture_as_is_skipped(self):
        engine = PipelineEngine()
        modules = [
            {"type": "wildcard", "options": [{"value": "a"}]},
            {"type": "fixed", "value": "ok", "capture_as": "$y"},
        ]
        ctx = engine.run(modules, {})
        assert ctx["y"] == "ok"

    def test_malformed_modules_dont_crash_pipeline(self):
        engine = PipelineEngine()
        modules = [
            {},
            {"type": ""},
            {"type": "fixed"},
            {"type": "combine"},
            {"type": "wildcard"},
            {"type": "fixed", "value": "survived", "capture_as": "$ok"},
        ]
        ctx = engine.run(modules, {})
        assert ctx["ok"] == "survived"
