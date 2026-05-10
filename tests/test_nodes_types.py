"""Unit tests for nodes.types."""

import json
from dataclasses import FrozenInstanceError

import pytest

from engine.modules import FixedValueEntry, FixedValueModule
from wp_nodes.types import (
    ContextPayload,
    build_payload,
    deserialize_modules,
)


class TestContextPayload:
    def test_defaults(self):
        payload = ContextPayload()
        assert payload.context == {}
        assert payload.debug == {}

    def test_frozen(self):
        payload = ContextPayload(context={"a": 1}, debug={"b": 2})
        with pytest.raises(FrozenInstanceError):
            payload.context = {}  # type: ignore[misc]


class TestDeserializeModules:
    def test_empty_list(self):
        assert deserialize_modules('{"version":1,"modules":[]}') == []

    def test_single_fixed_values(self):
        payload = json.dumps({
            "version": 1,
            "modules": [{
                "id": "abcd1234",
                "type": "fixed_values",
                "entries": [{"variable_name": "style", "value": "photo"}],
            }],
        })
        modules = deserialize_modules(payload)
        assert len(modules) == 1
        assert isinstance(modules[0], FixedValueModule)
        assert modules[0].entries == [FixedValueEntry("style", "photo")]

    def test_missing_modules_key_treated_as_empty(self):
        assert deserialize_modules('{"version":1}') == []

    def test_invalid_json_raises(self):
        with pytest.raises(ValueError):
            deserialize_modules("{not valid json")

    def test_non_dict_root_raises(self):
        with pytest.raises(ValueError):
            deserialize_modules("[]")


class TestBuildPayload:
    def test_strips_internals(self):
        ctx = {
            "style": "photo",
            "__wp_node_seed__": 42,
            "__wp_trace__": [{"id": "m1"}],
            "__wp_internal_flags__": {},
        }
        payload = build_payload(ctx, upstream_debug={}, seed=42)
        assert payload.context == {"style": "photo"}

    def test_debug_contains_seed_and_trace(self):
        ctx = {"style": "photo", "__wp_trace__": [{"id": "m1"}]}
        payload = build_payload(ctx, upstream_debug={}, seed=42)
        assert payload.debug["node_seed"] == 42
        assert payload.debug["__wp_trace__"] == [{"id": "m1"}]

    def test_upstream_debug_preserved(self):
        # `upstream` mirror is kept verbatim for any caller that wants
        # the raw upstream blob; `__wp_trace__` accumulates across the
        # chain so a terminal Debug node sees every contribution.
        ctx = {"__wp_trace__": [{"id": "this"}]}
        payload = build_payload(
            ctx,
            upstream_debug={"node_seed": 1, "__wp_trace__": [{"id": "prev"}]},
            seed=2,
        )
        assert payload.debug["upstream"] == {
            "node_seed": 1,
            "__wp_trace__": [{"id": "prev"}],
        }
        assert payload.debug["__wp_trace__"] == [{"id": "prev"}, {"id": "this"}]

    def test_warnings_accumulate_across_chain(self):
        ctx = {"__wp_warnings__": [{"type": "missing_target", "ref": "x"}]}
        payload = build_payload(
            ctx,
            upstream_debug={"__wp_warnings__": [{"type": "shadow"}]},
            seed=0,
        )
        assert payload.debug["__wp_warnings__"] == [
            {"type": "shadow"},
            {"type": "missing_target", "ref": "x"},
        ]

    def test_missing_trace_defaults_to_empty_list(self):
        payload = build_payload({}, upstream_debug={}, seed=0)
        assert payload.debug["__wp_trace__"] == []
        assert payload.debug["__wp_warnings__"] == []
