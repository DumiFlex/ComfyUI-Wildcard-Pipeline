"""Unit tests for nodes.debug_node.WPDebug."""

import json

from engine.syntax.types import ListVar
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
        assert names == ["context", "wp_viewer"]

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
        # User-facing variables sit at top level of the snapshot.
        # Engine internals (`__wp_*`) are also top-level so the
        # frontend's per-tab readers (snapshot/trace/picks/warnings)
        # can pull them directly. `node_seed` is surfaced as
        # `__wp_node_seed__` so the snapshot tab's `__`-prefix filter
        # hides it (matching trace/picks/warnings).
        payload = ContextPayload(
            context={"style": "photo"},
            debug={"node_seed": 42, "__wp_trace__": [], "__wp_warnings__": []},
        )
        out = WPDebug.execute(context=payload, wp_viewer=None)

        assert out.ui is not None
        assert "wp_debug_snapshot" in out.ui
        snapshot = self._parse_snapshot(out)
        assert snapshot == {
            "style": "photo",
            "__wp_debug_version__": 2,
            "__wp_node_seed__": 42,
        }

    def test_trace_warnings_picks_surface_at_top_level(self):
        payload = ContextPayload(
            context={"style": "photo"},
            debug={
                "node_seed": 7,
                "__wp_trace__": [{"id": "abc", "type": "wildcard"}],
                "__wp_warnings__": [{"type": "duplicate_variable"}],
            },
            internals={"__wp_picks__": {"abc": {"value": "v1"}}},
        )
        out = WPDebug.execute(context=payload, wp_viewer=None)
        snapshot = self._parse_snapshot(out)
        assert snapshot["style"] == "photo"
        assert snapshot["__wp_trace__"] == [{"id": "abc", "type": "wildcard"}]
        assert snapshot["__wp_warnings__"] == [{"type": "duplicate_variable"}]
        assert snapshot["__wp_picks__"] == {"abc": {"value": "v1"}}
        assert snapshot["__wp_node_seed__"] == 7

    def test_complex_values_serialized_via_str(self):
        class Weird:
            def __str__(self): return "weird"

        payload = ContextPayload(
            context={"obj": Weird()},
            debug={},
        )
        out = WPDebug.execute(context=payload, wp_viewer=None)
        snapshot = self._parse_snapshot(out)
        assert snapshot["obj"] == "weird"

    def test_empty_context(self):
        payload = ContextPayload()
        out = WPDebug.execute(context=payload, wp_viewer=None)
        snapshot = self._parse_snapshot(out)
        assert snapshot == {"__wp_debug_version__": 2}

    def test_run_detail_keys_surface(self):
        payload = ContextPayload(
            context={"outfit": ListVar(["a", "b"], " and "), "scratch": "x"},
            debug={
                "__wp_ref_log__": [{"owner": "u1", "uuid": "abcd1234", "depth": 0}],
                "__wp_nodes__": [{"node_id": "3", "seed": 9}],
            },
            internals={
                "__wp_internal_flags__": {"scratch": True},
                "__wp_axes__": {"outfit": [{"SHOES": "boots"}, {}]},
                "__wp_constraint_hits__": {"c1": 2},
                "__wp_loop_index__": 1,
            },
        )
        snapshot = self._parse_snapshot(WPDebug.execute(context=payload, wp_viewer=None))
        # A multi-pick renders joined at the top level, with its items kept.
        assert snapshot["outfit"] == "a and b"
        assert snapshot["__wp_multi__"] == {"outfit": {"items": ["a", "b"], "sep": " and "}}
        assert snapshot["__wp_internal_flags__"] == {"scratch": True}
        assert snapshot["__wp_axes__"] == {"outfit": [{"SHOES": "boots"}, {}]}
        assert snapshot["__wp_constraint_hits__"] == {"c1": 2}
        assert snapshot["__wp_loop_index__"] == 1
        assert snapshot["__wp_ref_log__"][0]["uuid"] == "abcd1234"
        assert snapshot["__wp_nodes__"] == [{"node_id": "3", "seed": 9}]
