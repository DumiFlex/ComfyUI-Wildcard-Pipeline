"""Unit tests for nodes.assembler_node.WPPromptAssembler."""

from wp_nodes.assembler_node import WPPromptAssembler
from wp_nodes.types import ContextPayload


class TestWPPromptAssemblerSchema:
    def test_schema_basic(self):
        schema = WPPromptAssembler.define_schema()
        assert schema.node_id == "WP_PromptAssembler"
        assert schema.display_name == "WP Prompt Assembler"
        assert schema.category == "wildcard-pipeline"

    def test_inputs(self):
        schema = WPPromptAssembler.define_schema()
        names = [s.name for s in schema.inputs]
        assert names == ["context", "template"]

        ctx_in, tmpl_in = schema.inputs
        assert ctx_in.type_name == "PIPELINE_CONTEXT"
        assert tmpl_in.type_name == "STRING"
        assert tmpl_in.multiline is True

    def test_outputs(self):
        schema = WPPromptAssembler.define_schema()
        assert len(schema.outputs) == 1
        assert schema.outputs[0].type_name == "STRING"


class TestWPPromptAssemblerExecute:
    def test_resolves_single_var(self):
        payload = ContextPayload(context={"style": "photoreal"}, debug={})
        out = WPPromptAssembler.execute(context=payload, template="A $style shot")
        assert out.values == ("A photoreal shot",)

    def test_resolves_multiple_vars(self):
        payload = ContextPayload(
            context={"style": "photo", "subject": "knight", "light": "soft"},
            debug={},
        )
        out = WPPromptAssembler.execute(
            context=payload,
            template="A $style $subject in $light light",
        )
        assert out.values == ("A photo knight in soft light",)

    def test_missing_var_dropped_with_whitespace_cleanup(self):
        # Missing vars resolve to empty string and surrounding whitespace is
        # collapsed so the prompt stays clean.
        payload = ContextPayload(context={}, debug={})
        out = WPPromptAssembler.execute(context=payload, template="$unknown here")
        assert out.values == ("here",)

    def test_dollar_escape(self):
        payload = ContextPayload(context={"x": "1"}, debug={})
        out = WPPromptAssembler.execute(context=payload, template="$$ costs $x")
        assert out.values == ("$ costs 1",)

    def test_empty_template(self):
        payload = ContextPayload(context={"x": "1"}, debug={})
        out = WPPromptAssembler.execute(context=payload, template="")
        assert out.values == ("",)
