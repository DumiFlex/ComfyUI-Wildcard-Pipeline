"""End-to-end engine integration tests — JSON in, rendered prompt out."""

from __future__ import annotations

from engine.context import strip_internals
from engine.modules import module_from_dict
from engine.pipeline import PipelineEngine
from engine.template import resolve_variables


def test_full_pipeline_json_to_rendered_prompt():
    """Round-trip: JSON module list → engine.run → template resolve."""
    raw_modules = [
        {
            "id": "char01a2",
            "type": "fixed_values",
            "enabled": True,
            "meta": {"name": "character", "tags": ["char"]},
            "entries": [
                {"variable_name": "subject", "value": "knight"},
                {"variable_name": "style", "value": "photoreal"},
            ],
        },
        {
            "id": "env01b2",
            "type": "fixed_values",
            "enabled": True,
            "meta": {"name": "environment"},
            "entries": [
                {"variable_name": "location", "value": "forest"},
                {"variable_name": "light", "value": "golden hour"},
            ],
        },
    ]

    modules = [module_from_dict(d) for d in raw_modules]
    ctx = PipelineEngine().run(modules, seed=42)

    template = "A $style painting of a $subject in a $location, $light"
    prompt = resolve_variables(template, ctx)

    assert prompt == (
        "A photoreal painting of a knight in a forest, golden hour"
    )

    # Trace records both modules, ordered.
    trace_ids = [entry["id"] for entry in ctx["__wp_trace__"]]
    assert trace_ids == ["char01a2", "env01b2"]

    # Socket-boundary snapshot: user vars only.
    user_ctx = strip_internals(ctx)
    assert user_ctx == {
        "subject": "knight",
        "style": "photoreal",
        "location": "forest",
        "light": "golden hour",
    }


def test_chain_simulates_downstream_context_node():
    """Upstream ctx flows into downstream Context node — last-write-wins."""
    upstream_modules = [
        module_from_dict({
            "id": "upstream",
            "type": "fixed_values",
            "entries": [
                {"variable_name": "style", "value": "photoreal"},
                {"variable_name": "subject", "value": "knight"},
            ],
        })
    ]
    upstream_ctx = PipelineEngine().run(upstream_modules, seed=1)

    # Downstream starts from a COPY of upstream's user vars — mirrors what
    # WP_Context.execute will do when wrapping an upstream ContextPayload.
    downstream_start = strip_internals(upstream_ctx)
    downstream_modules = [
        module_from_dict({
            "id": "override",
            "type": "fixed_values",
            "entries": [{"variable_name": "style", "value": "painted"}],
        })
    ]
    downstream_ctx = PipelineEngine().run(
        downstream_modules, ctx=downstream_start, seed=2
    )

    # Downstream overrides upstream's style; subject flows through unchanged.
    assert downstream_ctx["style"] == "painted"
    assert downstream_ctx["subject"] == "knight"

    # Only the override is in the downstream trace — upstream's trace was
    # not inherited because we stripped internals at the socket boundary.
    trace_ids = [entry["id"] for entry in downstream_ctx["__wp_trace__"]]
    assert trace_ids == ["override"]
    assert downstream_ctx["__wp_trace__"][0]["writes"] == [
        {
            "variable": "style",
            "value": "painted",
            "source": "fixed_values",
            "overwrite": True,
        }
    ]
