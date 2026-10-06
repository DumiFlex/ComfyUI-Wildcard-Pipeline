"""Node-level tests for WP_ModelInfo."""
import json
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


def _run(prompt=PROMPT, node_id="9", config=None, **kwargs):
    WPModelInfo.hidden = SimpleNamespace(unique_id=node_id, prompt=prompt)
    if config is not None:
        kwargs["wp_model_info"] = json.dumps(config)
    try:
        return WPModelInfo.execute(**kwargs)
    finally:
        del WPModelInfo.hidden


def _vars(out):
    ctx = out.values[0].context
    return ctx["model_family"], ctx["model_variant"], ctx["model_name"]


def test_schema():
    s = WPModelInfo.define_schema()
    assert s.node_id == "WP_ModelInfo"
    assert s.category == "wildcard-pipeline"
    assert [o.name for o in s.outputs] == ["context"]
    assert [i.name for i in s.inputs] == ["upstream", "model", "wp_model_info"]


def test_detects_family_variant_and_name_from_loader():
    out = _run(model=_model(SDXL))
    payload = out.values[0]
    assert _vars(out) == ("sdxl", "pony", "ponyDiffusionV6XL")
    trace = payload.debug["__wp_trace__"]
    assert [t["binding"] for t in trace] == ["model_family", "model_variant", "model_name"]
    assert [t["type"] for t in trace] == ["model", "rules", "loader"]
    assert all(t["node"] == "WP_ModelInfo" and t["node_id"] == "9" for t in trace)


def test_reports_detected_values_to_the_widget():
    out = _run(model=_model(SDXL))
    assert out.ui == {"wp_model_info": [{
        "family": "sdxl", "variant": "pony", "name": "ponyDiffusionV6XL",
        "sources": {"family": "model", "variant": "rules", "name": "loader"},
    }]}


def test_empty_or_broken_config_uses_shipped_rules():
    for raw in ("", "{", "[]", json.dumps({"family": "x"})):
        out = _run(model=_model(SDXL), wp_model_info=raw)
        assert _vars(out)[1] == "pony"


def test_pinned_name_wins_over_loader():
    out = _run(model=_model(Flux), config={"name": "illustriousXL_v01.safetensors"})
    assert _vars(out) == ("flux", "illustrious", "illustriousXL_v01")
    assert out.ui["wp_model_info"][0]["sources"]["name"] == "pinned"


def test_pins():
    out = _run(model=_model(SDXL), config={"family": " sd15 ", "variant": "illustrious"})
    assert _vars(out)[:2] == ("sd15", "illustrious")


def test_custom_rules_and_bad_rule_warning():
    rules = [
        {"variant": "mine", "pattern": "diffusion"},
        {"variant": "bad", "pattern": "("},
        {"variant": "", "pattern": ""},
    ]
    out = _run(model=_model(SDXL), config={"rules": rules})
    assert _vars(out)[1] == "mine"
    warns = out.values[0].debug["__wp_warnings__"]
    assert [w["type"] for w in warns] == ["model_info_bad_rule"]


def test_empty_rules_list_means_no_rules():
    out = _run(model=_model(SDXL), config={"rules": []})
    assert _vars(out)[1] == ""


def test_nothing_wired_warns_and_writes_empty_values():
    out = _run()
    assert _vars(out) == ("", "", "")
    assert out.values[0].debug["__wp_warnings__"][0]["type"] == "model_info_nothing_detected"


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
