"""Tests for WP_ContextInjector node handler."""
import json

from wp_nodes.injector_node import WPContextInjector
from wp_nodes.types import ContextPayload


def _empty_rows() -> str:
    return json.dumps({"version": 1, "rows": []})


def test_empty_rows_forwards_upstream_ctx():
    upstream = ContextPayload(context={"existing": "value"}, debug={}, internals={})
    out = WPContextInjector.execute(rows=_empty_rows(), upstream=upstream)
    assert out.values[0].context == {"existing": "value"}
