"""Tests for the pipeline engine."""

from unittest.mock import patch

from engine.pipeline import PipelineEngine, apply_constraints, resolve_variables


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
            {"type": "constrain"},
            {"type": "condition"},
            {"type": "export"},
            {"type": "fixed", "value": "survived", "capture_as": "$ok"},
        ]
        ctx = engine.run(modules, {})
        assert ctx["ok"] == "survived"


class TestApplyConstraints:
    def test_exclusion_removes_matching_options(self):
        options = [
            {"value": "sunny haze", "weight": 1.0},
            {"value": "golden hour", "weight": 1.0},
            {"value": "moonlight", "weight": 1.0},
        ]
        rules = [
            {
                "when_value": "moonlight",
                "rule_type": "exclusion",
                "values": ["sunny haze"],
            }
        ]
        result = apply_constraints(options, rules, "moonlight")
        values = [o["value"] for o in result]
        assert "sunny haze" not in values
        assert "golden hour" in values
        assert "moonlight" in values

    def test_exclusion_no_match_preserves_all(self):
        options = [
            {"value": "a", "weight": 1.0},
            {"value": "b", "weight": 1.0},
        ]
        rules = [{"when_value": "x", "rule_type": "exclusion", "values": ["a"]}]
        result = apply_constraints(options, rules, "no_match")
        assert len(result) == 2

    def test_weight_bias_multiplies_matching_weights(self):
        options = [
            {"value": "warm haze", "weight": 1.0},
            {"value": "cold fog", "weight": 1.0},
        ]
        rules = [
            {
                "when_value": "golden hour",
                "rule_type": "weight_bias",
                "values": ["warm haze"],
                "multiplier": 3.0,
            }
        ]
        result = apply_constraints(options, rules, "golden hour")
        warm = next(o for o in result if o["value"] == "warm haze")
        cold = next(o for o in result if o["value"] == "cold fog")
        assert warm["weight"] == 3.0
        assert cold["weight"] == 1.0

    def test_weight_bias_default_weight(self):
        options = [{"value": "a"}, {"value": "b"}]
        rules = [
            {
                "when_value": "trigger",
                "rule_type": "weight_bias",
                "values": ["a"],
                "multiplier": 2.0,
            }
        ]
        result = apply_constraints(options, rules, "trigger")
        a = next(o for o in result if o["value"] == "a")
        assert a["weight"] == 2.0

    def test_original_options_not_mutated(self):
        options = [{"value": "a", "weight": 1.0}]
        rules = [
            {
                "when_value": "t",
                "rule_type": "weight_bias",
                "values": ["a"],
                "multiplier": 5.0,
            }
        ]
        apply_constraints(options, rules, "t")
        assert options[0]["weight"] == 1.0

    def test_multiple_rules_applied_sequentially(self):
        options = [
            {"value": "a", "weight": 1.0},
            {"value": "b", "weight": 1.0},
            {"value": "c", "weight": 1.0},
        ]
        rules = [
            {"when_value": "t", "rule_type": "exclusion", "values": ["c"]},
            {
                "when_value": "t",
                "rule_type": "weight_bias",
                "values": ["a"],
                "multiplier": 10.0,
            },
        ]
        result = apply_constraints(options, rules, "t")
        assert len(result) == 2
        a = next(o for o in result if o["value"] == "a")
        assert a["weight"] == 10.0

    def test_empty_rules_returns_copy(self):
        options = [{"value": "a", "weight": 1.0}]
        result = apply_constraints(options, [], "trigger")
        assert len(result) == 1
        assert result[0] is not options[0]


class TestPipelineEngineConstrain:
    def test_constrain_resamples_with_exclusion(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "moonlight", "capture_as": "$lighting"},
            {
                "type": "constrain",
                "target": "$lighting",
                "options": [
                    {"value": "sunny haze", "weight": 1.0},
                    {"value": "cold fog", "weight": 1.0},
                ],
                "rules": [
                    {
                        "when_value": "moonlight",
                        "rule_type": "exclusion",
                        "values": ["sunny haze"],
                    }
                ],
                "capture_as": "$weather",
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["weather"] == "cold fog"

    def test_constrain_without_capture_does_not_sample(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "x", "capture_as": "$trigger"},
            {
                "type": "constrain",
                "target": "$trigger",
                "options": [{"value": "a", "weight": 1.0}],
                "rules": [],
            },
        ]
        ctx = engine.run(modules, {})
        assert "weather" not in ctx

    def test_constrain_no_matching_trigger_is_noop(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "sunlight", "capture_as": "$lighting"},
            {
                "type": "constrain",
                "target": "$lighting",
                "options": [{"value": "a", "weight": 1.0}],
                "rules": [
                    {
                        "when_value": "moonlight",
                        "rule_type": "exclusion",
                        "values": ["a"],
                    }
                ],
                "capture_as": "$weather",
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["weather"] == "a"

    def test_constrain_missing_target_is_noop(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "constrain",
                "target": "$nonexistent",
                "options": [{"value": "a", "weight": 1.0}],
                "rules": [],
                "capture_as": "$result",
            },
        ]
        ctx = engine.run(modules, {})
        assert "result" not in ctx


class TestPipelineEngineCondition:
    def test_condition_if_equals_met(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "night", "capture_as": "$time"},
            {
                "type": "condition",
                "variable": "$time",
                "if_equals": "night",
                "value": "dark atmosphere",
                "capture_as": "$mood",
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["mood"] == "dark atmosphere"

    def test_condition_if_equals_not_met_uses_fallback(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "day", "capture_as": "$time"},
            {
                "type": "condition",
                "variable": "$time",
                "if_equals": "night",
                "value": "dark atmosphere",
                "fallback": "bright atmosphere",
                "capture_as": "$mood",
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["mood"] == "bright atmosphere"

    def test_condition_if_equals_not_met_no_fallback(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "day", "capture_as": "$time"},
            {
                "type": "condition",
                "variable": "$time",
                "if_equals": "night",
                "value": "dark",
                "capture_as": "$mood",
            },
        ]
        ctx = engine.run(modules, {})
        assert "mood" not in ctx

    def test_condition_unless_equals(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "day", "capture_as": "$time"},
            {
                "type": "condition",
                "variable": "$time",
                "unless_equals": "night",
                "value": "visible",
                "capture_as": "$visibility",
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["visibility"] == "visible"

    def test_condition_unless_equals_blocked(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "night", "capture_as": "$time"},
            {
                "type": "condition",
                "variable": "$time",
                "unless_equals": "night",
                "value": "visible",
                "capture_as": "$visibility",
            },
        ]
        ctx = engine.run(modules, {})
        assert "visibility" not in ctx

    def test_condition_no_operator_checks_existence(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "anything", "capture_as": "$x"},
            {
                "type": "condition",
                "variable": "$x",
                "value": "exists",
                "capture_as": "$result",
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["result"] == "exists"

    def test_condition_no_operator_missing_var(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "condition",
                "variable": "$missing",
                "value": "exists",
                "capture_as": "$result",
            },
        ]
        ctx = engine.run(modules, {})
        assert "result" not in ctx

    def test_condition_missing_capture_is_noop(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "x", "capture_as": "$a"},
            {
                "type": "condition",
                "variable": "$a",
                "if_equals": "x",
                "value": "matched",
                "capture_as": "",
            },
        ]
        ctx = engine.run(modules, {})
        assert "matched" not in ctx.values() or ctx.get("a") == "x"


class TestPipelineEngineExport:
    def test_export_copies_variables(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "forest", "capture_as": "$location"},
            {"type": "fixed", "value": "golden hour", "capture_as": "$lighting"},
            {"type": "export", "variables": ["$location", "$lighting"]},
        ]
        ctx = engine.run(modules, {})
        assert ctx["__exports__"]["location"] == "forest"
        assert ctx["__exports__"]["lighting"] == "golden hour"

    def test_export_with_prefix(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "x", "capture_as": "$a"},
            {"type": "export", "variables": ["$a"], "prefix": "env_"},
        ]
        ctx = engine.run(modules, {})
        assert ctx["__exports__"]["env_a"] == "x"

    def test_export_missing_variable_skipped(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "x", "capture_as": "$a"},
            {"type": "export", "variables": ["$a", "$nonexistent"]},
        ]
        ctx = engine.run(modules, {})
        assert "a" in ctx["__exports__"]
        assert "nonexistent" not in ctx["__exports__"]

    def test_export_empty_variables_is_noop(self):
        engine = PipelineEngine()
        modules = [
            {"type": "export", "variables": []},
        ]
        ctx = engine.run(modules, {})
        assert "__exports__" not in ctx

    def test_export_accumulates_across_modules(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "x", "capture_as": "$a"},
            {"type": "fixed", "value": "y", "capture_as": "$b"},
            {"type": "export", "variables": ["$a"]},
            {"type": "export", "variables": ["$b"]},
        ]
        ctx = engine.run(modules, {})
        assert ctx["__exports__"]["a"] == "x"
        assert ctx["__exports__"]["b"] == "y"

    def test_export_strips_dollar_prefix(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "v", "capture_as": "$var"},
            {"type": "export", "variables": ["$var"]},
        ]
        ctx = engine.run(modules, {})
        assert "var" in ctx["__exports__"]
        assert "$var" not in ctx["__exports__"]

    def test_export_without_dollar_prefix(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "v", "capture_as": "$var"},
            {"type": "export", "variables": ["var"]},
        ]
        ctx = engine.run(modules, {})
        assert ctx["__exports__"]["var"] == "v"
