"""Model detection for WP_ModelInfo — pure string logic, no ComfyUI imports.

The node hands this module two facts it read off the graph: the loaded
model's config class name (``SDXL``, ``Flux``, …) and the checkpoint file
name. From those it derives the three variables the node writes:

* ``model_family``  — the architecture, from the config class name.
* ``model_variant`` — the fine-tune lineage (pony, illustrious, …), from the
  file name. Pony and Illustrious are both SDXL by architecture, so the file
  name is the only place that difference shows.
* ``model_name``    — the file name without folders or extension.

Variant rules are mirrored in TS at ``src/extension/model-info.ts`` (static
preview on the canvas) via the shared ``tests/fixtures/model-variant-corpus.json``.
Keep the two in step.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

#: Variables the node writes, in display order.
FAMILY_VAR = "model_family"
VARIANT_VAR = "model_variant"
NAME_VAR = "model_name"
MODEL_VARS = (FAMILY_VAR, VARIANT_VAR, NAME_VAR)

#: Shipped variant rules, as the node's rule rows: first match wins,
#: case-insensitive, matched anywhere in the file name. NoobAI sits above
#: Illustrious because NoobAI files often mention both.
DEFAULT_VARIANT_RULES: tuple[dict[str, str], ...] = (
    {"variant": "noobai", "pattern": "noob"},
    {"variant": "pony", "pattern": "pony|pdxl"},
    {"variant": "illustrious", "pattern": "illustrious|ilxl"},
    {"variant": "animagine", "pattern": "animagine"},
)

# Config class name (``model.model.model_config``'s class) → family. Checked
# as prefixes, longest first, so ``SDXLRefiner`` lands before ``SDXL``.
_FAMILY_PREFIXES: tuple[tuple[str, str], ...] = (
    ("SDXLRefiner", "sdxl_refiner"),
    ("SDXL", "sdxl"),
    ("SSD1B", "sdxl"),
    ("Segmind_Vega", "sdxl"),
    ("KOALA", "sdxl"),
    ("SD15", "sd15"),
    ("SD20", "sd2"),
    ("SD21", "sd2"),
    ("SD3", "sd3"),
    ("Stable_Cascade", "stable_cascade"),
    ("FluxSchnell", "flux"),
    ("Flux", "flux"),
    ("Chroma", "chroma"),
    ("AuraFlow", "auraflow"),
    ("PixArt", "pixart"),
    ("HunyuanDiT", "hunyuan_dit"),
    ("HunyuanVideo", "hunyuan_video"),
    ("HiDream", "hidream"),
    ("Lumina2", "lumina2"),
    ("QwenImage", "qwen_image"),
    ("WAN", "wan"),
    ("LTXV", "ltxv"),
    ("Cosmos", "cosmos"),
)


def family_from_config_name(class_name: str) -> str:
    """Map a model config class name to a lowercase family id.

    Unknown classes fall back to their own name in snake case, so a model
    ComfyUI adds after this list was written still gets a stable value.
    """
    name = (class_name or "").strip()
    if not name:
        return ""
    for prefix, family in sorted(_FAMILY_PREFIXES, key=lambda p: -len(p[0])):
        if name.startswith(prefix):
            return family
    snake = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    return re.sub(r"[^a-z0-9]+", "_", snake.lower()).strip("_")


def model_stem(path: str) -> str:
    """``SDXL\\pony\\ponyDiffusionV6XL.safetensors`` → ``ponyDiffusionV6XL``."""
    base = re.split(r"[\\/]", (path or "").strip())[-1]
    dot = base.rfind(".")
    return base[:dot] if dot > 0 else base


@dataclass(frozen=True)
class VariantRule:
    variant: str
    pattern: str
    regex: re.Pattern[str]


def compile_variant_rules(rows: Any) -> tuple[list[VariantRule], list[str]]:
    """Compile the node's rule rows. Returns ``(rules, problems)``.

    A row with neither field filled is an unfinished row and is skipped
    quietly. A row missing one field, or with a pattern that does not
    compile, is reported in ``problems`` and skipped, so one typo never
    stops the other rules from working.
    """
    rules: list[VariantRule] = []
    problems: list[str] = []
    for row in rows if isinstance(rows, (list, tuple)) else ():
        if not isinstance(row, dict):
            continue
        variant = str(row.get("variant") or "").strip()
        pattern = str(row.get("pattern") or "").strip()
        if not variant and not pattern:
            continue
        if not variant or not pattern:
            problems.append(
                f"rule {variant or pattern!r} needs both a variant and a pattern",
            )
            continue
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as exc:
            problems.append(f"bad pattern for {variant!r}: {exc}")
            continue
        rules.append(VariantRule(variant, pattern, regex))
    return rules, problems


@dataclass(frozen=True)
class ModelInfoConfig:
    """The node's widget state. Empty pins mean "detect it"."""

    rules: tuple[dict[str, str], ...]
    family: str = ""
    variant: str = ""
    name: str = ""


def parse_config(raw: Any) -> ModelInfoConfig:
    """Read the ``wp_model_info`` widget JSON. Anything unreadable, or a
    config without a ``rules`` list, gets the shipped rules."""
    data: Any = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw) if raw.strip() else {}
        except ValueError:
            data = {}
    if not isinstance(data, dict):
        data = {}
    rows = data.get("rules")
    rules = (
        tuple(r for r in rows if isinstance(r, dict))
        if isinstance(rows, list) else DEFAULT_VARIANT_RULES
    )

    def pin(key: str) -> str:
        v = data.get(key)
        return v.strip() if isinstance(v, str) else ""

    return ModelInfoConfig(rules, pin("family"), pin("variant"), pin("name"))


def detect_variant(name: str, rules: list[VariantRule]) -> str:
    """The first rule whose pattern occurs in ``name``, else ``""``."""
    if not name:
        return ""
    for rule in rules:
        if rule.regex.search(name):
            return rule.variant
    return ""


# Input names a loader node keeps its file name under.
_NAME_INPUTS = ("ckpt_name", "unet_name", "model_name", "model_path")
# Inputs a pass-through node (LoRA loader, sampling patch, …) takes the model on.
_MODEL_INPUTS = ("model", "MODEL")
# Inputs a primitive node holding a converted widget keeps its value under.
_VALUE_INPUTS = ("value", "string", "text", "STRING")


def _is_link(v: Any) -> bool:
    return isinstance(v, (list, tuple)) and len(v) == 2 and isinstance(v[1], int)


def _string_behind(prompt: dict, value: Any, depth: int = 0) -> str:
    """A widget value, following it through a primitive node when the widget
    was converted to an input."""
    if isinstance(value, str):
        return value
    if not _is_link(value) or depth > 8:
        return ""
    node = prompt.get(str(value[0]))
    inputs = node.get("inputs") if isinstance(node, dict) else None
    if not isinstance(inputs, dict):
        return ""
    for key in _NAME_INPUTS + _VALUE_INPUTS:
        if key in inputs:
            found = _string_behind(prompt, inputs[key], depth + 1)
            if found:
                return found
    return ""


def find_checkpoint_name(
    prompt: Any, node_id: Any, input_name: str = "model",
) -> str:
    """Follow ``node_id``'s ``input_name`` link back to the node that loaded
    the model and return its file name, or ``""``.

    ``prompt`` is ComfyUI's API prompt (``{id: {class_type, inputs}}``, links
    as ``[origin_id, slot]``). Pass-through nodes — LoRA loaders, sampling
    patches — are stepped over via their own ``model`` input.
    """
    if not isinstance(prompt, dict) or node_id is None:
        return ""
    node = prompt.get(str(node_id))
    inputs = node.get("inputs") if isinstance(node, dict) else None
    link = inputs.get(input_name) if isinstance(inputs, dict) else None
    seen: set[str] = set()
    while _is_link(link):
        origin_id = str(link[0])
        if origin_id in seen or len(seen) > 64:
            return ""
        seen.add(origin_id)
        origin = prompt.get(origin_id)
        o_inputs = origin.get("inputs") if isinstance(origin, dict) else None
        if not isinstance(o_inputs, dict):
            return ""
        for key in _NAME_INPUTS:
            if key in o_inputs:
                name = _string_behind(prompt, o_inputs[key])
                if name:
                    return name
        link = next(
            (o_inputs[k] for k in _MODEL_INPUTS if _is_link(o_inputs.get(k))),
            None,
        )
    return ""
