"""Unit tests for engine.context."""

from __future__ import annotations

from engine.context import strip_internals


class TestStripInternals:
    def test_empty(self):
        assert strip_internals({}) == {}

    def test_only_user_keys(self):
        ctx = {"name": "A", "count": 3}
        assert strip_internals(ctx) == ctx

    def test_only_internal_keys(self):
        ctx = {"__wp_node_seed__": 42, "__wp_trace__": []}
        assert strip_internals(ctx) == {}

    def test_mixed(self):
        ctx = {"name": "A", "__wp_node_seed__": 42, "count": 3}
        assert strip_internals(ctx) == {"name": "A", "count": 3}

    def test_returns_new_dict(self):
        ctx = {"name": "A", "__seed": 1}
        stripped = strip_internals(ctx)
        stripped["name"] = "B"
        assert ctx["name"] == "A"

    def test_single_underscore_prefix_not_stripped(self):
        # Only the double-underscore convention is internal.
        ctx = {"_private": 1, "__internal": 2, "normal": 3}
        assert strip_internals(ctx) == {"_private": 1, "normal": 3}
