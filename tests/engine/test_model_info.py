"""engine/model_info.py — detection rules shared with the canvas preview."""
import json
from pathlib import Path

import pytest

from engine import model_info as mi

CORPUS = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "model-variant-corpus.json").read_text(),
)


def _rules(text):
    return mi.parse_variant_rules(mi.DEFAULT_VARIANT_RULES if text is None else text)


@pytest.mark.parametrize("case", CORPUS["variants"], ids=lambda c: c["name"] or "empty")
def test_variant_corpus(case):
    rules, _ = _rules(case["rules"])
    assert mi.detect_variant(case["name"], rules) == case["variant"]


@pytest.mark.parametrize("case", CORPUS["problems"])
def test_problem_corpus(case):
    _, problems = _rules(case["rules"])
    assert len(problems) == case["count"]


@pytest.mark.parametrize("case", CORPUS["stems"], ids=lambda c: c["path"] or "empty")
def test_stem_corpus(case):
    assert mi.model_stem(case["path"]) == case["stem"]


@pytest.mark.parametrize(("cls", "family"), [
    ("SDXL", "sdxl"),
    ("SDXLRefiner", "sdxl_refiner"),
    ("SD15", "sd15"),
    ("SD15_instructpix2pix", "sd15"),
    ("Flux", "flux"),
    ("FluxSchnell", "flux"),
    ("SD3", "sd3"),
    ("Chroma", "chroma"),
    ("WAN21_T2V", "wan"),
    ("SomeNewModel", "some_new_model"),
    ("", ""),
])
def test_family_from_config_name(cls, family):
    assert mi.family_from_config_name(cls) == family


def _prompt():
    return {
        "4": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": "SDXL/ponyDiffusionV6XL.safetensors"}},
        "7": {"class_type": "LoraLoader",
              "inputs": {"model": ["4", 0], "clip": ["4", 1], "lora_name": "x.safetensors"}},
        "9": {"class_type": "WP_ModelInfo", "inputs": {"model": ["7", 0]}},
        "10": {"class_type": "WP_ModelInfo", "inputs": {"model": ["4", 0]}},
        "11": {"class_type": "WP_ModelInfo", "inputs": {}},
    }


def test_find_checkpoint_name_steps_over_lora_loader():
    assert mi.find_checkpoint_name(_prompt(), "9") == "SDXL/ponyDiffusionV6XL.safetensors"


def test_find_checkpoint_name_direct_and_missing():
    p = _prompt()
    assert mi.find_checkpoint_name(p, "10").endswith("ponyDiffusionV6XL.safetensors")
    assert mi.find_checkpoint_name(p, "11") == ""
    assert mi.find_checkpoint_name(p, "404") == ""
    assert mi.find_checkpoint_name(None, "9") == ""


def test_find_checkpoint_name_unet_loader_and_converted_widget():
    p = {
        "1": {"class_type": "PrimitiveString", "inputs": {"value": "flux1-dev.safetensors"}},
        "2": {"class_type": "UNETLoader", "inputs": {"unet_name": ["1", 0]}},
        "3": {"class_type": "WP_ModelInfo", "inputs": {"model": ["2", 0]}},
    }
    assert mi.find_checkpoint_name(p, "3") == "flux1-dev.safetensors"


def test_find_checkpoint_name_survives_cycle():
    p = {
        "1": {"class_type": "X", "inputs": {"model": ["2", 0]}},
        "2": {"class_type": "Y", "inputs": {"model": ["1", 0]}},
        "3": {"class_type": "WP_ModelInfo", "inputs": {"model": ["1", 0]}},
    }
    assert mi.find_checkpoint_name(p, "3") == ""


def test_default_rules_match_corpus():
    # The TS mirror asserts the same string, so the two can't drift apart.
    assert mi.DEFAULT_VARIANT_RULES == CORPUS["default_rules"]
