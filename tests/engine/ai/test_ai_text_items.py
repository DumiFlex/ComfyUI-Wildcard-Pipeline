"""engine/ai/text_items.py — the text panels' answer schemas."""
from __future__ import annotations

from engine.ai import text_items


def test_answer_schemas_cap_every_string():
    """A 9B wrote the Template panel's answer on to its output limit on an
    empty library (panel eval, 2026-10-24): every string is capped."""
    for schema in (text_items.TEMPLATE_SCHEMA, text_items.COMBINE_SCHEMA):
        assert all(p["maxLength"] for p in schema["properties"].values())
    row = text_items.FIXED_SCHEMA["properties"]["values"]
    assert row["maxItems"] == text_items.MAX_VALUES
    assert all(p["maxLength"] for p in row["items"]["properties"].values())
