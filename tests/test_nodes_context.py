"""Unit tests for nodes.context_node.WPContext."""

import json

from wp_nodes.context_node import WPContext
from wp_nodes.types import ContextPayload


class TestWPContextSchema:
    def test_schema_basic(self):
        schema = WPContext.define_schema()
        assert schema.node_id == "WP_Context"
        assert schema.display_name == "WP Context"
        assert schema.category == "wildcard-pipeline"
        assert schema.not_idempotent is True

    def test_schema_inputs(self):
        schema = WPContext.define_schema()
        names = [s.name for s in schema.inputs]
        assert names == ["upstream", "seed", "modules"]

        upstream, seed, modules = schema.inputs
        assert upstream.type_name == "PIPELINE_CONTEXT"
        assert upstream.optional is True
        assert seed.type_name == "INT"
        assert modules.type_name == "WP_CONTEXT_MODULES"
        assert modules.socketless is True

    def test_schema_outputs(self):
        schema = WPContext.define_schema()
        assert len(schema.outputs) == 1
        assert schema.outputs[0].type_name == "PIPELINE_CONTEXT"


class TestWPContextExecute:
    def _modules_json(self, entries):
        return json.dumps({
            "version": 1,
            "modules": [{
                "id": "m1",
                "type": "fixed_values",
                "entries": entries,
            }],
        })

    def test_root_context_no_upstream(self):
        payload = self._modules_json([
            {"variable_name": "style", "value": "photo"},
        ])
        out = WPContext.execute(seed=0, modules=payload, upstream=None)

        assert len(out.values) == 1
        result = out.values[0]
        assert isinstance(result, ContextPayload)
        assert result.context == {"style": "photo"}
        assert result.debug["node_seed"] == 0
        assert len(result.debug["__wp_trace__"]) == 1
        assert result.debug["upstream"] == {}

    def test_with_upstream_inherits_vars(self):
        upstream = ContextPayload(
            context={"subject": "knight"},
            debug={"node_seed": 7, "__wp_trace__": [{"id": "up"}]},
        )
        payload = self._modules_json([
            {"variable_name": "style", "value": "painted"},
        ])
        out = WPContext.execute(seed=42, modules=payload, upstream=upstream)
        result = out.values[0]

        assert result.context == {"subject": "knight", "style": "painted"}
        assert result.debug["node_seed"] == 42
        assert result.debug["upstream"] == {
            "node_seed": 7,
            "__wp_trace__": [{"id": "up"}],
        }
        # Trace accumulates across the chain: upstream entry first,
        # then this node's module entries.
        ids = [entry["id"] for entry in result.debug["__wp_trace__"]]
        assert ids == ["up", "m1"]

    def test_empty_modules_still_emits_payload(self):
        out = WPContext.execute(
            seed=0,
            modules='{"version":1,"modules":[]}',
            upstream=None,
        )
        result = out.values[0]
        assert result.context == {}
        assert result.debug["__wp_trace__"] == []

    def test_malformed_modules_runs_empty(self):
        # deserialize_node_input is robust: malformed JSON returns ([], {}, [])
        # so the pipeline runs with an empty module list rather than crashing.
        out = WPContext.execute(seed=0, modules="{not json", upstream=None)
        result = out.values[0]
        assert result.context == {}
        assert result.debug["__wp_trace__"] == []

    def test_disabled_module_trace_carries_binding_and_locked_seed(self):
        # Disabled module trace entry should carry the declared binding
        # + locked_seed value so the debug viewer can render
        # `$varname (disabled)` with the seed instead of falling back
        # to a `$<short-uuid>` label with no seed cell.
        payload = json.dumps({
            "version": 1,
            "modules": [{
                "id": "fv1",
                "type": "fixed_values",
                "enabled": False,
                "entries": [
                    {"variable_name": "color", "value": "red"},
                    {"variable_name": "shape", "value": "circle"},
                ],
                "instance": {"locked_seed": 99999, "internal": True},
            }],
        })
        out = WPContext.execute(seed=42, modules=payload, upstream=None)
        result = out.values[0]
        trace = result.debug["__wp_trace__"]
        assert len(trace) == 1
        entry = trace[0]
        assert entry["status"] == "skipped_disabled"
        assert entry["bindings"] == ["color", "shape"]
        assert entry["seed_locked"] is True
        assert entry["seed"] == 99999
        assert entry["internal"] is True

    def test_ok_module_trace_carries_binding_and_internal_flags(self):
        payload = json.dumps({
            "version": 1,
            "modules": [{
                "id": "fv1",
                "type": "fixed_values",
                "entries": [{"variable_name": "color", "value": "red"}],
                "instance": {"internal": True},
            }],
        })
        out = WPContext.execute(seed=42, modules=payload, upstream=None)
        result = out.values[0]
        trace = result.debug["__wp_trace__"]
        entry = trace[0]
        assert entry["status"] == "ok"
        assert entry["internal"] is True
        assert entry["seed_locked"] is False
        assert entry["seed"] == 42  # chain seed (no locked_seed)

    def test_downstream_overwrite_flows(self):
        first = WPContext.execute(
            seed=1,
            modules=json.dumps({
                "version": 1,
                "modules": [{
                    "id": "a",
                    "type": "fixed_values",
                    "entries": [{"variable_name": "style", "value": "photo"}],
                }],
            }),
            upstream=None,
        ).values[0]

        second = WPContext.execute(
            seed=2,
            modules=json.dumps({
                "version": 1,
                "modules": [{
                    "id": "b",
                    "type": "fixed_values",
                    "entries": [{"variable_name": "style", "value": "painted"}],
                }],
            }),
            upstream=first,
        ).values[0]

        assert second.context == {"style": "painted"}
        assert second.debug["upstream"]["node_seed"] == 1
