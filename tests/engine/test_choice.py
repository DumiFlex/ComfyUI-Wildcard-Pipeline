"""engine/choice.py — matching a variable's text to a dropdown's options."""
import pytest

from engine import choice
from engine.choice import Target, match_option, resolve_choice

CKPTS = [
    "SDXL\\pony\\ponyDiffusionV6XL.safetensors",
    "illustrious/waiNSFW_v140.safetensors",
    "illustrious/waiNSFW_v14.safetensors",
    "sd15/dreamshaper_8.safetensors",
    "flux/flux1-dev-fp8.safetensors",
]
SAMPLERS = ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde"]


@pytest.mark.parametrize(
    ("value", "options", "mode", "expected", "how"),
    [
        ("euler", SAMPLERS, "exact", "euler", "exact"),
        ("Euler", SAMPLERS, "exact", None, ""),
        ("Euler", SAMPLERS, "loose", "euler", "loose"),
        ("euler ancestral", SAMPLERS, "loose", "euler_ancestral", "loose"),
        # starts-with: the shortest option wins, so dpmpp_2m beats dpmpp_2m_sde
        ("dpmpp 2m", SAMPLERS, "loose", "dpmpp_2m", "loose"),
        ("3m", SAMPLERS, "loose", "dpmpp_3m_sde", "loose"),
        # folders, extension, case and separators ignored
        ("ponyDiffusionV6XL", CKPTS, "loose", CKPTS[0], "loose"),
        ("pony diffusion v6 xl.safetensors", CKPTS, "loose", CKPTS[0], "loose"),
        ("wai nsfw v14", CKPTS, "loose", "illustrious/waiNSFW_v14.safetensors", "loose"),
        ("wai nsfw v140", CKPTS, "loose", "illustrious/waiNSFW_v140.safetensors", "loose"),
        ("dreamshaper", CKPTS, "loose", "sd15/dreamshaper_8.safetensors", "loose"),
        ("juggernaut v9", CKPTS, "loose", None, ""),
        # closest forgives typos; loose does not
        ("dreamshapr 8", CKPTS, "loose", None, ""),
        ("dreamshapr 8", CKPTS, "closest", "sd15/dreamshaper_8.safetensors", "closest"),
        ("eular", SAMPLERS, "closest", "euler", "closest"),
        ("zzzz", SAMPLERS, "closest", None, ""),
        ("", SAMPLERS, "closest", None, ""),
        ("euler", [], "loose", None, ""),
    ],
)
def test_match_option(value, options, mode, expected, how):
    assert match_option(value, options, mode) == (expected, how)


def test_version_numbers_keep_their_dot():
    opts = ["model v1.4.safetensors", "model v14.safetensors"]
    assert match_option("model v1.4", opts, "loose")[0] == "model v1.4.safetensors"


def test_same_stem_prefers_the_named_folder():
    opts = ["sdxl/base.safetensors", "pony/base.safetensors"]
    assert match_option("base", opts, "loose")[0] == "sdxl/base.safetensors"
    assert match_option("pony\\base", opts, "loose")[0] == "pony/base.safetensors"


PROMPT = {
    "3": {"class_type": "KSampler", "inputs": {"sampler_name": ["7", 0], "seed": 1},
          "_meta": {"title": "Main sampler"}},
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ["8", 0]}},
    "5": {"class_type": "KSampler", "inputs": {"sampler_name": ["7", 0]}},
    "7": {"class_type": "WP_VarToChoice", "inputs": {"context": ["1", 0]}},
    "8": {"class_type": "WP_VarToChoice", "inputs": {}},
}


def test_find_consumers():
    assert choice.find_consumers(PROMPT, "7") == [
        ("3", "KSampler", "sampler_name"),
        ("5", "KSampler", "sampler_name"),
    ]
    assert choice.find_consumers(PROMPT, 8) == [("4", "CheckpointLoaderSimple", "ckpt_name")]
    assert choice.find_consumers(PROMPT, "7", slot=1) == []
    assert choice.find_consumers(None, "7") == []


def test_options_from_input_types():
    v1 = {"required": {"ckpt_name": (["a.safetensors", "b.safetensors"], {})}}
    v3 = {"optional": {"mode": ("COMBO", {"options": ["x", "y"]})}}
    assert choice.options_from_input_types(v1, "ckpt_name") == ("a.safetensors", "b.safetensors")
    assert choice.options_from_input_types(v3, "mode") == ("x", "y")
    assert choice.options_from_input_types({"required": {"text": ("STRING", {})}}, "text") is None
    assert choice.options_from_input_types({"required": {"any": ("*",)}}, "any") is None
    assert choice.options_from_input_types(v1, "missing") is None
    assert choice.options_from_input_types(None, "x") is None


def test_titles_from_prompt():
    assert choice.titles_from_prompt(PROMPT) == {"3": "Main sampler"}


def _t(options, cls="KSampler", name="sampler_name", nid="3"):
    return Target(nid, cls, name, tuple(options) if options is not None else None)


def test_resolve_match():
    r = resolve_choice("Euler A", [_t(SAMPLERS)], titles={"3": "Main sampler"})
    assert (r.value, r.status) == ("euler_ancestral", "loose")
    assert r.target == "Main sampler › sampler_name"
    assert r.option_count == len(SAMPLERS)
    assert r.note == "Matched “Euler A” loosely."


def test_resolve_fallback_first_option_and_named():
    r = resolve_choice("juggernaut v9", [_t(CKPTS, "CheckpointLoaderSimple", "ckpt_name")])
    assert (r.value, r.status) == (CKPTS[0], "fallback")
    assert "No match for “juggernaut v9”" in r.note
    r = resolve_choice("juggernaut v9", [_t(CKPTS)], fallback="dreamshaper")
    assert r.value == "sd15/dreamshaper_8.safetensors"
    r = resolve_choice("", [_t(SAMPLERS)], fallback="nope")
    assert r.value == "euler" and "The variable is empty" in r.note
    assert "fallback “nope” isn't an option either" in r.note


def test_resolve_stop():
    r = resolve_choice("nope", [_t(SAMPLERS)], stop_on_no_match=True)
    assert r.status == "no_match"
    assert "5 options: euler, euler_ancestral" in r.note


def test_resolve_passthrough():
    r = resolve_choice("anything", [])
    assert (r.value, r.status) == ("anything", "passthrough")
    assert "isn't wired" in r.note
    r = resolve_choice("anything", [_t(None, "AnySwitch", "any_01")])
    assert (r.value, r.status) == ("anything", "passthrough")
    assert "no option list" in r.note
    r = resolve_choice("", [], fallback="euler")
    assert r.value == "euler"
    r = resolve_choice("", [_t([])], fallback="euler")
    assert (r.value, r.status) == ("euler", "passthrough")


def test_resolve_warns_when_another_target_lacks_the_value():
    r = resolve_choice("euler", [_t(SAMPLERS), _t(["dpmpp_2m"], nid="5")])
    assert r.value == "euler"
    assert r.warnings == ["euler isn't an option of KSampler › sampler_name."]


def test_first_option_sentinel_means_no_fallback():
    r = resolve_choice("nope", [_t(SAMPLERS)], fallback=choice.FIRST_OPTION)
    assert r.value == "euler"
    assert "isn't an option either" not in r.note
    r = resolve_choice("", [], fallback=choice.FIRST_OPTION)
    assert r.value == ""
