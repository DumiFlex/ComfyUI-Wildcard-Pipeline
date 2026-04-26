"""Unit tests for nodes.debug_node.WPDebug."""

import json

from wp_nodes.debug_node import WPDebug
from wp_nodes.types import ContextPayload


class TestWPDebugSchema:
    def test_schema_basic(self):
        schema = WPDebug.define_schema()
        assert schema.node_id == "WP_Debug"
        assert schema.display_name == "WP Debug"
        assert schema.category == "wildcard-pipeline"
        assert schema.is_output_node is True
        assert schema.not_idempotent is True

    def test_inputs(self):
        schema = WPDebug.define_schema()
        names = [s.name for s in schema.inputs]
        assert names == ["context", "viewer"]

        ctx_in, viewer_in = schema.inputs
        assert ctx_in.type_name == "PIPELINE_CONTEXT"
        assert viewer_in.type_name == "WP_DEBUG_VIEWER"
        assert viewer_in.socketless is True

    def test_no_outputs(self):
        schema = WPDebug.define_schema()
        assert schema.outputs == []


class TestWPDebugExecute:
    def _parse_snapshot(self, out):
        snapshot_list = out.ui["wp_debug_snapshot"]
        assert len(snapshot_list) == 1
        return json.loads(snapshot_list[0])

    def test_emits_ui_payload(self):
        payload = ContextPayload(
            context={"style": "photo"},
            debug={"node_seed": 42, "trace": []},
        )
        out = WPDebug.execute(context=payload, viewer=None)

        assert out.ui is not None
        assert "wp_debug_snapshot" in out.ui
        snapshot = self._parse_snapshot(out)
        assert snapshot == {
            "context": {"style": "photo"},
            "debug": {"node_seed": 42, "trace": []},
        }

    def test_complex_values_serialized_via_str(self):
        class Weird:
            def __str__(self): return "weird"

        payload = ContextPayload(
            context={"obj": Weird()},
            debug={},
        )
        out = WPDebug.execute(context=payload, viewer=None)
        snapshot = self._parse_snapshot(out)
        assert snapshot["context"]["obj"] == "weird"

    def test_empty_context(self):
        payload = ContextPayload()
        out = WPDebug.execute(context=payload, viewer=None)
        snapshot = self._parse_snapshot(out)
        assert snapshot == {"context": {}, "debug": {}}
