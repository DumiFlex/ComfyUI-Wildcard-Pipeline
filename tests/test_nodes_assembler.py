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

    def test_template_uses_our_editor_without_losing_the_string_socket(self):
        """The whole point of routing `widgetType` through `extra_dict`.

        The frontend picks a widget constructor with `widgetType ?? type` and
        adds the socket from `type`, so these two facts have to hold at the
        same time: the widget is ours, the socket is still STRING and can be
        driven by an upstream STRING output.

        Using V3's `widget_type=` parameter instead would satisfy the first
        and break the second — `WidgetInput.get_io_type` returns widget_type
        when set, so the socket would become `WP_TEMPLATE_EDITOR` and nothing
        could connect to it. Assert both together; either one alone passes
        while the feature is broken.
        """
        schema = WPPromptAssembler.define_schema()
        tmpl_in = next(s for s in schema.inputs if s.name == "template")
        assert tmpl_in.type_name == "STRING"
        assert (tmpl_in.extra_dict or {}).get("widgetType") == "WP_TEMPLATE_EDITOR"

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
