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
        assert len(result.debug["trace"]) == 1
        assert result.debug["upstream"] == {}

    def test_with_upstream_inherits_vars(self):
        upstream = ContextPayload(
            context={"subject": "knight"},
            debug={"node_seed": 7, "trace": [{"id": "up"}]},
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
            "trace": [{"id": "up"}],
        }
        assert [entry["id"] for entry in result.debug["trace"]] == ["m1"]

    def test_empty_modules_still_emits_payload(self):
        out = WPContext.execute(
            seed=0,
            modules='{"version":1,"modules":[]}',
            upstream=None,
        )
        result = out.values[0]
        assert result.context == {}
        assert result.debug["trace"] == []

    def test_malformed_modules_runs_empty(self):
        # deserialize_node_input is robust: malformed JSON returns ([], {}, [])
        # so the pipeline runs with an empty module list rather than crashing.
        out = WPContext.execute(seed=0, modules="{not json", upstream=None)
        result = out.values[0]
        assert result.context == {}
        assert result.debug["trace"] == []

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
