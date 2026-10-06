"""Model-aware pipelines end to end: WP_ModelInfo → a "Model" wildcard set
to match `$model_variant` → a constraint keyed on that wildcard's pick.

Constraints key off wildcard picks, not variables, so `match_variable` is
the bridge that lets the loaded checkpoint drive one.
"""
from __future__ import annotations

import json
import random

from engine.modules.wildcard_handler import WildcardHandler
from wp_nodes.context_node import WPContext
from wp_nodes.model_info_node import WPModelInfo


def _modules(*mods: dict) -> str:
    return json.dumps({"version": 1, "modules": list(mods)})


def _model_wildcard(instance: dict | None = None, fallback: bool = False) -> dict:
    other = {"id": "o3", "value": "other", "weight": 1, "sub_categories": ["other"]}
    if fallback:
        other["fallback"] = True
    return {
        "id": "0de1a001",
        "type": "wildcard",
        "enabled": True,
        "payload": {
            "var_binding": "model",
            "sub_categories": ["pony", "illustrious", "other"],
            "options": [
                {"id": "o1", "value": "Pony", "weight": 1, "sub_categories": ["pony"]},
                {
                    "id": "o2", "value": "illustrious", "weight": 1,
                    "sub_categories": ["illustrious"],
                },
                other,
            ],
        },
        "instance": {"match_variable": "model_variant", **(instance or {})},
    }


def _style_wildcard() -> dict:
    return {
        "id": "0de1a002",
        "type": "wildcard",
        "enabled": True,
        "payload": {
            "var_binding": "style",
            "sub_categories": ["photo", "anime"],
            "options": [
                {"id": "s1", "value": "photorealistic", "weight": 1, "sub_categories": ["photo"]},
                {"id": "s2", "value": "anime screencap", "weight": 1, "sub_categories": ["anime"]},
            ],
        },
        "instance": {},
    }


def _constraint() -> dict:
    return {
        "id": "0de1a003",
        "type": "constraint",
        "enabled": True,
        "payload": {
            "source_wildcard_id": "0de1a001",
            "target_wildcard_id": "0de1a002",
            "matrix": {"pony": {"photo": {"mode": "exclude", "factor": 1}}},
            "exceptions": [],
        },
        "instance": {},
    }


def _model_info(name: str):
    return WPModelInfo.execute(wp_model_info=json.dumps({"name": name})).values[0]


def test_model_variant_drives_constraint_across_nodes():
    upstream = _model_info("ponyDiffusionV6XL.safetensors")
    for seed in range(20):
        out = WPContext.execute(
            seed=seed,
            wp_modules=_modules(_model_wildcard(), _constraint(), _style_wildcard()),
            upstream=upstream,
        ).values[0]
        assert out.context["model"] == "Pony"
        assert out.context["style"] == "anime screencap", f"seed {seed}"


def test_other_variant_leaves_target_unconstrained():
    upstream = _model_info("illustriousXL_v01.safetensors")
    styles = set()
    for seed in range(30):
        out = WPContext.execute(
            seed=seed,
            wp_modules=_modules(_model_wildcard(), _constraint(), _style_wildcard()),
            upstream=upstream,
        ).values[0]
        assert out.context["model"] == "illustrious"
        styles.add(out.context["style"])
    assert styles == {"photorealistic", "anime screencap"}


def _resolve(instance: dict, ctx_vars: dict, fallback: bool = False):
    ctx = {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        "__wp_catalog__": {},
        "__wp_node_seed__": 0,
        **ctx_vars,
    }
    mod = _model_wildcard(instance, fallback=fallback)
    out = WildcardHandler.resolve(mod["payload"], mod["instance"], ctx)
    return out, ctx["__wp_warnings__"]


def test_match_is_case_insensitive_and_accepts_dollar():
    out, warns = _resolve({"match_variable": "$model_variant"}, {"model_variant": " PONY "})
    assert out == {"model": "Pony"}
    assert warns == []


def test_no_match_takes_fallback_quietly():
    out, warns = _resolve({}, {"model_variant": "flux"}, fallback=True)
    assert out == {"model": "other"}
    assert warns == []


def test_no_match_without_fallback_rolls_and_warns():
    out, warns = _resolve({}, {"model_variant": ""})
    assert out["model"] in {"Pony", "illustrious", "other"}
    assert [w["type"] for w in warns] == ["match_variable_no_match"]


def test_pinned_wins_over_match():
    out, _ = _resolve(
        {"mode": "pinned", "pinned_option_id": "o2"}, {"model_variant": "pony"},
    )
    assert out == {"model": "illustrious"}


def _lora_by_model() -> dict:
    """Same shape as `loraByModelRule` in src/manager/utils/derivation-presets.ts."""
    return {
        "id": "0de1a004",
        "type": "derivation",
        "enabled": True,
        "payload": {"rules": [{
            "id": "r_1",
            "branches": [
                {
                    "condition": {"var": "model_variant", "op": "equals", "value": v},
                    "action": {
                        "target_var": "loras", "mode": "replace",
                        "value": f"<lora:my_{v}_lora:0.8>",
                    },
                }
                for v in ("pony", "illustrious")
            ],
            "else": {"action": {"target_var": "loras", "mode": "replace", "value": ""}},
        }]},
        "instance": {},
    }


def test_lora_by_model_preset_follows_checkpoint():
    for name, want in [
        ("ponyDiffusionV6XL.safetensors", "<lora:my_pony_lora:0.8>"),
        ("waiNSFWIllustrious_v140.safetensors", "<lora:my_illustrious_lora:0.8>"),
        ("juggernautXL.safetensors", ""),
    ]:
        out = WPContext.execute(
            seed=0, wp_modules=_modules(_lora_by_model()), upstream=_model_info(name),
        ).values[0]
        assert out.context["loras"] == want, name
