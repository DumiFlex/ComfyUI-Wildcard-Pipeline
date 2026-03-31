"""Tests for the pipeline engine."""

from engine.pipeline import PipelineEngine


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
    """Test the wildcard module handler (stub — picks first option)."""

    def test_wildcard_captures_first_option(self):
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
        assert ctx["location"] == "forest"

    def test_wildcard_empty_options_is_noop(self):
        engine = PipelineEngine()
        modules = [
            {"type": "wildcard", "options": [], "capture_as": "$x"},
        ]
        ctx = engine.run(modules, {})
        assert "x" not in ctx


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
