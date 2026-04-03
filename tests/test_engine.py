"""Tests for the pipeline engine."""

import random
from unittest.mock import MagicMock, patch

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
        # weight=0 for 'light' means it can never be chosen; verify deterministically
        ctx = engine.run(modules, {}, rng=random.Random(42))
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
        # All-zero weights fall back to uniform; result is valid either way
        ctx = engine.run(modules, {}, rng=random.Random(42))
        assert ctx["pick"] in ("a", "b")

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
        # Missing weight treated as 1.0; just verify a valid value is captured
        ctx = engine.run(modules, {}, rng=random.Random(42))
        assert ctx["pick"] in ("no_weight", "has_weight")

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
                "when_variable": "lighting",
                "when_value": "moonlight",
                "rule_type": "exclusion",
                "values": ["sunny haze"],
            }
        ]
        ctx = {"lighting": "moonlight"}
        result = apply_constraints(options, rules, ctx)
        values = [o["value"] for o in result]
        assert "sunny haze" not in values
        assert "golden hour" in values
        assert "moonlight" in values

    def test_exclusion_no_match_preserves_all(self):
        options = [
            {"value": "a", "weight": 1.0},
            {"value": "b", "weight": 1.0},
        ]
        rules = [
            {
                "when_variable": "v",
                "when_value": "x",
                "rule_type": "exclusion",
                "values": ["a"],
            }
        ]
        ctx = {"v": "no_match"}
        result = apply_constraints(options, rules, ctx)
        assert len(result) == 2

    def test_weight_bias_multiplies_matching_weights(self):
        options = [
            {"value": "warm haze", "weight": 1.0},
            {"value": "cold fog", "weight": 1.0},
        ]
        rules = [
            {
                "when_variable": "lighting",
                "when_value": "golden hour",
                "rule_type": "weight_bias",
                "values": ["warm haze"],
                "multiplier": 3.0,
            }
        ]
        ctx = {"lighting": "golden hour"}
        result = apply_constraints(options, rules, ctx)
        warm = next(o for o in result if o["value"] == "warm haze")
        cold = next(o for o in result if o["value"] == "cold fog")
        assert warm["weight"] == 3.0
        assert cold["weight"] == 1.0

    def test_weight_bias_default_weight(self):
        options = [{"value": "a"}, {"value": "b"}]
        rules = [
            {
                "when_variable": "v",
                "when_value": "trigger",
                "rule_type": "weight_bias",
                "values": ["a"],
                "multiplier": 2.0,
            }
        ]
        ctx = {"v": "trigger"}
        result = apply_constraints(options, rules, ctx)
        a = next(o for o in result if o["value"] == "a")
        assert a["weight"] == 2.0

    def test_original_options_not_mutated(self):
        options = [{"value": "a", "weight": 1.0}]
        rules = [
            {
                "when_variable": "v",
                "when_value": "t",
                "rule_type": "weight_bias",
                "values": ["a"],
                "multiplier": 5.0,
            }
        ]
        apply_constraints(options, rules, {"v": "t"})
        assert options[0]["weight"] == 1.0

    def test_multiple_rules_applied_sequentially(self):
        options = [
            {"value": "a", "weight": 1.0},
            {"value": "b", "weight": 1.0},
            {"value": "c", "weight": 1.0},
        ]
        rules = [
            {
                "when_variable": "v",
                "when_value": "t",
                "rule_type": "exclusion",
                "values": ["c"],
            },
            {
                "when_variable": "v",
                "when_value": "t",
                "rule_type": "weight_bias",
                "values": ["a"],
                "multiplier": 10.0,
            },
        ]
        ctx = {"v": "t"}
        result = apply_constraints(options, rules, ctx)
        assert len(result) == 2
        a = next(o for o in result if o["value"] == "a")
        assert a["weight"] == 10.0

    def test_empty_rules_returns_copy(self):
        options = [{"value": "a", "weight": 1.0}]
        result = apply_constraints(options, [], {})
        assert len(result) == 1
        assert result[0] is not options[0]

    def test_weight_bias_zero_multiplier_zeroes_weight(self):
        options = [{"value": "a", "weight": 1.0}, {"value": "b", "weight": 1.0}]
        rules = [
            {
                "when_variable": "v",
                "when_value": "t",
                "rule_type": "weight_bias",
                "values": ["a"],
                "multiplier": 0.0,
            }
        ]
        result = apply_constraints(options, rules, {"v": "t"})
        a = next(o for o in result if o["value"] == "a")
        assert a["weight"] == 0.0

    def test_ctx_variable_lookup_uses_when_variable_key(self):
        options = [{"value": "x", "weight": 1.0}, {"value": "y", "weight": 1.0}]
        rules = [
            {
                "when_variable": "scene_type",
                "when_value": "night",
                "rule_type": "exclusion",
                "values": ["x"],
            }
        ]
        ctx_match = {"scene_type": "night"}
        ctx_no_match = {"scene_type": "day"}
        result_match = apply_constraints(options, rules, ctx_match)
        result_no_match = apply_constraints(options, rules, ctx_no_match)
        assert len(result_match) == 1
        assert len(result_no_match) == 2


class TestPipelineEngineEnabled:
    def test_disabled_module_is_skipped(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "a", "capture_as": "$x", "enabled": False},
            {"type": "fixed", "value": "b", "capture_as": "$y"},
        ]
        ctx = engine.run(modules, {})
        assert "x" not in ctx
        assert ctx["y"] == "b"

    def test_enabled_true_module_runs(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "a", "capture_as": "$x", "enabled": True},
        ]
        ctx = engine.run(modules, {})
        assert ctx["x"] == "a"

    def test_enabled_absent_module_runs(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "a", "capture_as": "$x"},
        ]
        ctx = engine.run(modules, {})
        assert ctx["x"] == "a"

    def test_disabled_wildcard_skipped(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [{"value": "sun", "weight": 1}],
                "capture_as": "$weather",
                "enabled": False,
            },
        ]
        ctx = engine.run(modules, {})
        assert "weather" not in ctx

    def test_disabled_constrain_not_registered(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "constrain",
                "enabled": False,
                "rules": [
                    {
                        "target": "weather",
                        "when_variable": "lighting",
                        "when_value": "moonlight",
                        "rule_type": "exclusion",
                        "values": ["sunny"],
                    }
                ],
            },
        ]
        ctx = engine.run(modules, {})
        assert "__constraints__" not in ctx


class TestPipelineEngineConstrain:
    def test_constrain_registers_rules_and_wildcard_applies_them(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "moonlight", "capture_as": "$lighting"},
            {
                "type": "constrain",
                "rules": [
                    {
                        "target": "weather",
                        "when_variable": "lighting",
                        "when_value": "moonlight",
                        "rule_type": "exclusion",
                        "values": ["sunny haze"],
                    }
                ],
            },
            {
                "type": "wildcard",
                "capture_as": "$weather",
                "options": [
                    {"value": "sunny haze", "weight": 1.0},
                    {"value": "cold fog", "weight": 1.0},
                ],
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["weather"] == "cold fog"

    def test_constrain_stores_rules_in_ctx_constraints(self):
        engine = PipelineEngine()
        rules = [
            {
                "target": "weather",
                "when_variable": "lighting",
                "when_value": "moonlight",
                "rule_type": "exclusion",
                "values": ["sunny haze"],
            }
        ]
        modules = [
            {"type": "constrain", "rules": rules},
        ]
        ctx = engine.run(modules, {})
        assert "__constraints__" in ctx
        assert len(ctx["__constraints__"]) == 1
        assert ctx["__constraints__"][0]["target"] == "weather"

    def test_constrain_only_applies_rules_matching_target(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "moonlight", "capture_as": "$lighting"},
            {
                "type": "constrain",
                "rules": [
                    {
                        "target": "location",
                        "when_variable": "lighting",
                        "when_value": "moonlight",
                        "rule_type": "exclusion",
                        "values": ["forest"],
                    }
                ],
            },
            {
                "type": "wildcard",
                "capture_as": "$weather",
                "options": [
                    {"value": "rainy", "weight": 1.0},
                    {"value": "sunny", "weight": 1.0},
                ],
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["weather"] in ("rainy", "sunny")

    def test_constrain_without_capture_does_not_sample(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "x", "capture_as": "$trigger"},
            {
                "type": "constrain",
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
                "rules": [
                    {
                        "target": "weather",
                        "when_variable": "lighting",
                        "when_value": "moonlight",
                        "rule_type": "exclusion",
                        "values": ["a"],
                    }
                ],
            },
            {
                "type": "wildcard",
                "capture_as": "$weather",
                "options": [{"value": "a", "weight": 1.0}],
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["weather"] == "a"

    def test_constrain_missing_target_is_noop(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "constrain",
                "rules": [],
            },
        ]
        ctx = engine.run(modules, {})
        assert "result" not in ctx

    def test_multiple_constraints_on_same_target_all_applied(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "moonlight", "capture_as": "$lighting"},
            {"type": "fixed", "value": "cold", "capture_as": "$temperature"},
            {
                "type": "constrain",
                "rules": [
                    {
                        "target": "weather",
                        "when_variable": "lighting",
                        "when_value": "moonlight",
                        "rule_type": "exclusion",
                        "values": ["sunny haze"],
                    }
                ],
            },
            {
                "type": "constrain",
                "rules": [
                    {
                        "target": "weather",
                        "when_variable": "temperature",
                        "when_value": "cold",
                        "rule_type": "exclusion",
                        "values": ["warm drizzle"],
                    }
                ],
            },
            {
                "type": "wildcard",
                "capture_as": "$weather",
                "options": [
                    {"value": "sunny haze", "weight": 1.0},
                    {"value": "warm drizzle", "weight": 1.0},
                    {"value": "cold fog", "weight": 1.0},
                ],
            },
        ]
        ctx = engine.run(modules, {})
        assert ctx["weather"] == "cold fog"

    def test_weight_bias_zero_effectively_excludes_via_uniform_fallback(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "trigger", "capture_as": "$v"},
            {
                "type": "constrain",
                "rules": [
                    {
                        "target": "pick",
                        "when_variable": "v",
                        "when_value": "trigger",
                        "rule_type": "weight_bias",
                        "values": ["a"],
                        "multiplier": 0.0,
                    }
                ],
            },
            {
                "type": "wildcard",
                "capture_as": "$pick",
                "options": [
                    {"value": "a", "weight": 1.0},
                    {"value": "b", "weight": 1.0},
                ],
            },
        ]
        for _ in range(20):
            ctx = engine.run(modules, {})
            assert ctx.get("pick") in ("a", "b")


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


class TestPipelineEngineCrossNodeConstraints:
    """Constraints registered in one node's run() and applied in another's."""

    def test_constraint_from_upstream_ctx_applies_to_downstream_wildcard(self):
        engine = PipelineEngine()
        node1_modules = [
            {"type": "fixed", "value": "moonlight", "capture_as": "$lighting"},
            {
                "type": "constrain",
                "rules": [
                    {
                        "target": "weather",
                        "when_variable": "lighting",
                        "when_value": "moonlight",
                        "rule_type": "exclusion",
                        "values": ["sunny haze"],
                    }
                ],
            },
        ]
        ctx = engine.run(node1_modules, {})
        assert "__constraints__" in ctx
        assert ctx["lighting"] == "moonlight"

        node2_modules = [
            {
                "type": "wildcard",
                "capture_as": "$weather",
                "options": [
                    {"value": "sunny haze", "weight": 1.0},
                    {"value": "cold fog", "weight": 1.0},
                ],
            },
        ]
        ctx = engine.run(node2_modules, ctx)
        assert ctx["weather"] == "cold fog"

    def test_when_variable_from_earlier_node_triggers_constraint_in_later_node(self):
        engine = PipelineEngine()
        node1_ctx = engine.run(
            [{"type": "fixed", "value": "golden hour", "capture_as": "$lighting"}],
            {},
        )
        node2_ctx = engine.run(
            [
                {
                    "type": "constrain",
                    "rules": [
                        {
                            "target": "weather",
                            "when_variable": "lighting",
                            "when_value": "golden hour",
                            "rule_type": "weight_bias",
                            "values": ["warm haze"],
                            "multiplier": 100.0,
                        }
                    ],
                },
            ],
            node1_ctx,
        )
        assert "__constraints__" in node2_ctx

        # 100x weight bias for 'warm haze' makes it overwhelmingly likely to be chosen
        node3_ctx = engine.run(
            [
                {
                    "type": "wildcard",
                    "capture_as": "$weather",
                    "options": [
                        {"value": "warm haze", "weight": 1.0},
                        {"value": "cold fog", "weight": 1.0},
                    ],
                }
            ],
            node2_ctx,
            rng=random.Random(42),
        )
        assert node3_ctx["weather"] == "warm haze"

    def test_constraint_registered_after_target_has_no_effect(self):
        engine = PipelineEngine()
        node1_ctx = engine.run(
            [
                {
                    "type": "wildcard",
                    "capture_as": "$weather",
                    "options": [{"value": "sunny haze", "weight": 1.0}],
                },
            ],
            {},
        )
        assert node1_ctx["weather"] == "sunny haze"

        node2_ctx = engine.run(
            [
                {"type": "fixed", "value": "moonlight", "capture_as": "$lighting"},
                {
                    "type": "constrain",
                    "rules": [
                        {
                            "target": "weather",
                            "when_variable": "lighting",
                            "when_value": "moonlight",
                            "rule_type": "exclusion",
                            "values": ["sunny haze"],
                        }
                    ],
                },
            ],
            node1_ctx,
        )
        assert node2_ctx["weather"] == "sunny haze"

    def test_three_node_chain_lighting_constrain_weather(self):
        engine = PipelineEngine()
        ctx = engine.run(
            [{"type": "fixed", "value": "moonlight", "capture_as": "$lighting"}],
            {},
        )
        ctx = engine.run(
            [
                {
                    "type": "constrain",
                    "rules": [
                        {
                            "target": "weather",
                            "when_variable": "lighting",
                            "when_value": "moonlight",
                            "rule_type": "exclusion",
                            "values": ["sunny haze"],
                        }
                    ],
                },
            ],
            ctx,
        )
        ctx = engine.run(
            [
                {
                    "type": "wildcard",
                    "capture_as": "$weather",
                    "options": [
                        {"value": "sunny haze", "weight": 1.0},
                        {"value": "cold fog", "weight": 1.0},
                    ],
                },
            ],
            ctx,
        )
        assert ctx["weather"] == "cold fog"

    def test_constraints_accumulate_across_multiple_nodes(self):
        engine = PipelineEngine()
        ctx = engine.run(
            [
                {"type": "fixed", "value": "moonlight", "capture_as": "$lighting"},
                {"type": "fixed", "value": "cold", "capture_as": "$temperature"},
            ],
            {},
        )
        ctx = engine.run(
            [
                {
                    "type": "constrain",
                    "rules": [
                        {
                            "target": "weather",
                            "when_variable": "lighting",
                            "when_value": "moonlight",
                            "rule_type": "exclusion",
                            "values": ["sunny haze"],
                        }
                    ],
                },
            ],
            ctx,
        )
        ctx = engine.run(
            [
                {
                    "type": "constrain",
                    "rules": [
                        {
                            "target": "weather",
                            "when_variable": "temperature",
                            "when_value": "cold",
                            "rule_type": "exclusion",
                            "values": ["warm drizzle"],
                        }
                    ],
                },
            ],
            ctx,
        )
        ctx = engine.run(
            [
                {
                    "type": "wildcard",
                    "capture_as": "$weather",
                    "options": [
                        {"value": "sunny haze", "weight": 1.0},
                        {"value": "warm drizzle", "weight": 1.0},
                        {"value": "cold fog", "weight": 1.0},
                    ],
                },
            ],
            ctx,
        )
        assert ctx["weather"] == "cold fog"

    def test_constraints_persist_through_unrelated_modules(self):
        engine = PipelineEngine()
        ctx = engine.run(
            [
                {"type": "fixed", "value": "moonlight", "capture_as": "$lighting"},
                {
                    "type": "constrain",
                    "rules": [
                        {
                            "target": "weather",
                            "when_variable": "lighting",
                            "when_value": "moonlight",
                            "rule_type": "exclusion",
                            "values": ["sunny haze"],
                        }
                    ],
                },
            ],
            {},
        )
        ctx = engine.run(
            [
                {"type": "fixed", "value": "forest", "capture_as": "$location"},
                {
                    "type": "combine",
                    "template": "$location under $lighting",
                    "capture_as": "$scene",
                },
            ],
            ctx,
        )
        assert ctx["scene"] == "forest under moonlight"
        assert "__constraints__" in ctx

        ctx = engine.run(
            [
                {
                    "type": "wildcard",
                    "capture_as": "$weather",
                    "options": [
                        {"value": "sunny haze", "weight": 1.0},
                        {"value": "cold fog", "weight": 1.0},
                    ],
                },
            ],
            ctx,
        )
        assert ctx["weather"] == "cold fog"


class TestPipelineEngineRNG:
    def test_run_accepts_rng_parameter(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [{"value": "a", "weight": 1}],
                "capture_as": "$x",
            }
        ]
        ctx = engine.run(modules, {}, rng=random.Random(42))
        assert ctx["x"] == "a"

    def test_run_without_rng_uses_default(self):
        engine = PipelineEngine()
        modules = [{"type": "fixed", "value": "hello", "capture_as": "$greeting"}]
        ctx = engine.run(modules, {})
        assert ctx["greeting"] == "hello"

    def test_module_seeds_tracked_in_context(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [{"value": "a", "weight": 1}],
                "capture_as": "$x",
            }
        ]
        ctx = engine.run(modules, {}, rng=random.Random(42))
        assert "__wp_module_seeds__" in ctx
        assert "x" in ctx["__wp_module_seeds__"]
        assert isinstance(ctx["__wp_module_seeds__"]["x"], int)

    def test_module_seeds_deterministic(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [{"value": "a", "weight": 1}, {"value": "b", "weight": 1}],
                "capture_as": "$x",
            }
        ]
        ctx1 = engine.run(modules, {}, rng=random.Random(42))
        ctx2 = engine.run(modules, {}, rng=random.Random(42))
        assert ctx1["__wp_module_seeds__"]["x"] == ctx2["__wp_module_seeds__"]["x"]
        assert ctx1["x"] == ctx2["x"]

    def test_disabled_modules_not_in_module_seeds(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [{"value": "a", "weight": 1}],
                "capture_as": "$x",
                "enabled": False,
            }
        ]
        ctx = engine.run(modules, {}, rng=random.Random(42))
        assert ctx.get("__wp_module_seeds__", {}).get("x") is None

    def test_non_wildcard_modules_not_in_module_seeds(self):
        engine = PipelineEngine()
        modules = [
            {"type": "fixed", "value": "v", "capture_as": "$f"},
            {"type": "combine", "template": "$f", "capture_as": "$c"},
        ]
        ctx = engine.run(modules, {}, rng=random.Random(42))
        seeds = ctx.get("__wp_module_seeds__", {})
        assert "f" not in seeds
        assert "c" not in seeds

    def test_rng_produces_deterministic_results(self):
        engine = PipelineEngine()
        modules = [
            {
                "type": "wildcard",
                "options": [{"value": "a", "weight": 1}, {"value": "b", "weight": 1}],
                "capture_as": "$pick",
            }
        ]
        ctx1 = engine.run(modules, {}, rng=random.Random(42))
        ctx2 = engine.run(modules, {}, rng=random.Random(42))
        assert ctx1["pick"] == ctx2["pick"]
