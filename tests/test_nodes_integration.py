"""End-to-end node integration — simulate a small ComfyUI workflow."""

import json

from wp_nodes.assembler_node import WPPromptAssembler
from wp_nodes.context_node import WPContext
from wp_nodes.debug_node import WPDebug
from wp_nodes.types import ContextPayload


def _mods(entries):
    return json.dumps({
        "version": 1,
        "modules": [{
            "id": "auto",
            "type": "fixed_values",
            "entries": entries,
        }],
    })


def test_chain_of_two_context_nodes_into_assembler():
    # Upstream context sets style + subject.
    upstream = WPContext.execute(
        seed=1,
        modules=_mods([
            {"variable_name": "style", "value": "photoreal"},
            {"variable_name": "subject", "value": "knight"},
        ]),
        upstream=None,
    ).values[0]

    # Downstream context adds environment vars + overrides style.
    downstream = WPContext.execute(
        seed=2,
        modules=_mods([
            {"variable_name": "style", "value": "painted"},
            {"variable_name": "location", "value": "forest"},
        ]),
        upstream=upstream,
    ).values[0]

    assert isinstance(downstream, ContextPayload)
    assert downstream.context == {
        "subject": "knight",
        "style": "painted",
        "location": "forest",
    }

    # Assembler renders the final template.
    assembled = WPPromptAssembler.execute(
        context=downstream,
        template="A $style $subject in the $location",
    )
    assert assembled.values == ("A painted knight in the forest",)


def test_debug_node_snapshots_downstream_context():
    upstream = WPContext.execute(
        seed=7,
        modules=_mods([
            {"variable_name": "style", "value": "photoreal"},
        ]),
        upstream=None,
    ).values[0]

    out = WPDebug.execute(context=upstream, viewer=None)
    snapshot = json.loads(out.ui["wp_debug_snapshot"][0])

    assert snapshot["context"] == {"style": "photoreal"}
    assert snapshot["debug"]["node_seed"] == 7
    assert len(snapshot["debug"]["trace"]) == 1
