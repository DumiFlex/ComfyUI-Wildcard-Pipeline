"""Node-level tests for WP_VarToChoice."""
from types import SimpleNamespace

import pytest

from wp_nodes.types import ContextPayload
from wp_nodes.var_to_choice import WPVarToChoice

INPUT_TYPES = {
    "CheckpointLoaderSimple": {"required": {"ckpt_name": ([
        "SDXL/ponyDiffusionV6XL.safetensors",
        "illustrious/waiNSFW_v140.safetensors",
    ], {})}},
    "AnySwitch": {"required": {"any_01": ("*", {})}},
}

PROMPT = {
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ["9", 0]},
          "_meta": {"title": "Load Checkpoint"}},
    "9": {"class_type": "WP_VarToChoice", "inputs": {}},
}


def _ctx(**values):
    return ContextPayload(context=dict(values), debug={}, internals={})


def _run(prompt=PROMPT, node_id="9", **kwargs):
    WPVarToChoice.hidden = SimpleNamespace(unique_id=node_id, prompt=prompt)
    old = WPVarToChoice.input_types_for
    WPVarToChoice.input_types_for = staticmethod(INPUT_TYPES.get)
    try:
        return WPVarToChoice.execute(**kwargs)
    finally:
        del WPVarToChoice.hidden
        WPVarToChoice.input_types_for = old


def test_schema():
    s = WPVarToChoice.define_schema()
    assert s.node_id == "WP_VarToChoice"
    assert s.category == "wildcard-pipeline"
    assert [i.name for i in s.inputs] == [
        "context", "wp_var_name", "match", "fallback", "if_no_match",
    ]
    assert [(o.name, o.type_name) for o in s.outputs] == [("choice", "*")]
    assert s.not_idempotent is False


def test_matches_against_the_wired_loader():
    out = _run(context=_ctx(checkpoint="wai nsfw v14"), wp_var_name="$checkpoint")
    assert out.values == ("illustrious/waiNSFW_v140.safetensors",)
    status = out.ui["wp_choice_status"][0]
    assert status["status"] == "loose"
    assert status["target"] == "Load Checkpoint › ckpt_name"
    assert status["options"] == 2
    assert out.ui["wp_varpicker_source"] == ["wai nsfw v14"]
    assert out.ui["wp_varpicker_parsed"] == ["illustrious/waiNSFW_v140.safetensors"]


def test_fallback_marks_the_strip_amber():
    out = _run(context=_ctx(checkpoint="juggernaut"), wp_var_name="$checkpoint")
    assert out.values == ("SDXL/ponyDiffusionV6XL.safetensors",)
    assert out.ui["wp_varpicker_parsed"] == [None]
    assert out.ui["wp_varpicker_default"] == ["SDXL/ponyDiffusionV6XL.safetensors"]
    assert out.ui["wp_choice_status"][0]["status"] == "fallback"


def test_stop_the_run():
    with pytest.raises(ValueError, match="No match for “juggernaut”"):
        _run(context=_ctx(checkpoint="juggernaut"), wp_var_name="$checkpoint",
             if_no_match="stop the run")


def test_passthrough_into_a_switch():
    prompt = {
        "4": {"class_type": "AnySwitch", "inputs": {"any_01": ["9", 0]}},
        "9": {"class_type": "WP_VarToChoice", "inputs": {}},
    }
    out = _run(prompt=prompt, context=_ctx(sampler="Euler A"), wp_var_name="$sampler")
    assert out.values == ("Euler A",)
    assert out.ui["wp_choice_status"][0]["status"] == "passthrough"


def test_exact_mode_does_not_loosen():
    out = _run(context=_ctx(checkpoint="ponyDiffusionV6XL"), wp_var_name="$checkpoint",
               match="exact", fallback="wai")
    # exact misses, and the fallback is matched exactly too, so the first option
    assert out.values == ("SDXL/ponyDiffusionV6XL.safetensors",)
    assert out.ui["wp_choice_status"][0]["status"] == "fallback"


def test_fallback_dropdown_skips_comfy_list_check():
    # The list is filled on the canvas, so any picked value must validate.
    assert WPVarToChoice.validate_inputs(fallback="illustrious/x.safetensors") is True


def test_fallback_picked_from_the_dropdown():
    out = _run(context=_ctx(checkpoint="juggernaut"), wp_var_name="$checkpoint",
               fallback="illustrious/waiNSFW_v140.safetensors")
    assert out.values == ("illustrious/waiNSFW_v140.safetensors",)
