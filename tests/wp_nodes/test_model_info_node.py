"""Node-level tests for WP_ModelInfo."""
from types import SimpleNamespace

from wp_nodes.model_info_node import WPModelInfo
from wp_nodes.types import ContextPayload


class SDXL:  # stands in for comfy.supported_models.SDXL
    pass


class Flux:
    pass


def _model(config_cls):
    return SimpleNamespace(model=SimpleNamespace(model_config=config_cls()))


PROMPT = {
    "4": {"class_type": "CheckpointLoaderSimple",
          "inputs": {"ckpt_name": "SDXL/ponyDiffusionV6XL.safetensors"}},
    "9": {"class_type": "WP_ModelInfo", "inputs": {"model": ["4", 0]}},
}


def _run(monkeypatch=None, prompt=PROMPT, node_id="9", **kwargs):
    WPModelInfo.hidden = SimpleNamespace(unique_id=node_id, prompt=prompt)
    try:
        return WPModelInfo.execute(**kwargs)
    finally:
        del WPModelInfo.hidden


def test_schema():
    s = WPModelInfo.define_schema()
    assert s.node_id == "WP_ModelInfo"
    assert s.category == "wildcard-pipeline"
    assert [o.name for o in s.outputs] == [
        "context", "model_family", "model_variant", "model_name",
    ]


def test_detects_family_variant_and_name_from_loader():
    out = _run(model=_model(SDXL))
    payload, family, variant, name = out.values
    assert (family, variant, name) == ("sdxl", "pony", "ponyDiffusionV6XL")
    assert payload.context["model_family"] == "sdxl"
    assert payload.context["model_variant"] == "pony"
    assert payload.context["model_name"] == "ponyDiffusionV6XL"
    trace = payload.debug["__wp_trace__"]
    assert [t["binding"] for t in trace] == ["model_family", "model_variant", "model_name"]
    assert all(t["node"] == "WP_ModelInfo" and t["node_id"] == "9" for t in trace)


def test_model_name_input_wins_over_loader():
    out = _run(model=_model(Flux), model_name="illustriousXL_v01.safetensors")
    _, family, variant, name = out.values
    assert (family, variant, name) == ("flux", "illustrious", "illustriousXL_v01")


def test_overrides():
    out = _run(model=_model(SDXL), family_override=" sd15 ", variant_override="illustrious")
    _, family, variant, _ = out.values
    assert (family, variant) == ("sd15", "illustrious")


def test_custom_rules_and_bad_rule_warning():
    out = _run(model=_model(SDXL), variant_rules="mine: diffusion\nbad: (")
    payload, _, variant, _ = out.values
    assert variant == "mine"
    warns = payload.debug["__wp_warnings__"]
    assert [w["type"] for w in warns] == ["model_info_bad_rule"]


def test_nothing_wired_warns_and_writes_empty_values():
    out = _run()
    payload, family, variant, name = out.values
    assert (family, variant, name) == ("", "", "")
    assert payload.context["model_variant"] == ""
    assert payload.debug["__wp_warnings__"][0]["type"] == "model_info_nothing_detected"


def test_extends_upstream_and_clears_shadowed_negatives_and_flags():
    upstream = ContextPayload(
        context={"hair": "red", "model_variant": "old"},
        debug={"__wp_trace__": [{"node": "WP_Context"}]},
        internals={
            "__wp_negatives__": {"model_variant": [{"text": "x"}], "hair": [{"text": "y"}]},
            "__wp_internal_flags__": {"model_variant": True, "hair": True},
            "__wp_picks__": {"abcd1234": {"value": "red"}},
        },
    )
    out = _run(upstream=upstream, model=_model(SDXL))
    payload = out.values[0]
    assert payload.context["hair"] == "red"
    assert payload.context["model_variant"] == "pony"
    assert payload.internals["__wp_negatives__"] == {"hair": [{"text": "y"}]}
    assert payload.internals["__wp_internal_flags__"] == {"hair": True}
    assert payload.internals["__wp_picks__"] == {"abcd1234": {"value": "red"}}
    assert len(payload.debug["__wp_trace__"]) == 4
    # Upstream payload untouched.
    assert "model_variant" in upstream.internals["__wp_negatives__"]
