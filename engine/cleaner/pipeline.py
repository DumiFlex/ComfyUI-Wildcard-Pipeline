"""PromptCleaner — orchestrate rule execution by intensity preset.

The pipeline owns three responsibilities:

  1. Translate an intensity preset ("gentle"/"balanced"/"aggressive")
     into the set of rules that should run by default.
  2. Apply per-rule overrides supplied by the node config.
  3. Iterate the registry in canonical order, accumulating a
     `RunReport` of stats keyed by rule_id.

Rules always execute in registry order — the intensity preset only
controls which rules are *enabled*, never reorders them. This keeps
output deterministic across presets.
"""
from __future__ import annotations

from typing import Any

from engine.cleaner.rules import RULE_REGISTRY
from engine.cleaner.types import RuleId, RunReport

INTENSITY_TO_RULES: dict[str, list[RuleId]] = {
    "gentle": ["whitespace"],
    # Empty groups + LoRA spacing never change what a prompt means; merging
    # weights rewrites how it reads, so it waits for aggressive.
    "balanced": [
        "empty_groups",
        "lora_spacing",
        "whitespace",
        "punctuation",
        "dedupe_exact",
    ],
    "aggressive": [
        "empty_groups",
        "merge_weights",
        "lora_spacing",
        "whitespace",
        "punctuation",
        "dedupe_exact",
        "fuzzy_dedupe",
    ],
}


#: Send-to-negative: the negative column's defaults per preset. Fuzzy dedupe
#: stays off (near-duplicates in a negative, "bad hand" / "bad hands", are
#: usually deliberate) and the blocklist never auto-enables (it keeps words
#: OUT of the prompt, and those are often the words a negative names).
INTENSITY_TO_NEG_RULES: dict[str, list[RuleId]] = {
    "gentle": ["whitespace"],
    "balanced": [
        "empty_groups",
        "lora_spacing",
        "whitespace",
        "punctuation",
        "dedupe_exact",
    ],
    "aggressive": [
        "empty_groups",
        "merge_weights",
        "lora_spacing",
        "whitespace",
        "punctuation",
        "dedupe_exact",
    ],
}


def _effective_rules(
    intensity: str,
    overrides: dict[str, bool],
    table: dict[str, list[RuleId]] = INTENSITY_TO_RULES,
) -> set[RuleId]:
    base: set[RuleId] = set(table.get(intensity, table["balanced"]))
    for rule_id, enabled in overrides.items():
        if enabled:
            base.add(rule_id)  # type: ignore[arg-type]
        else:
            base.discard(rule_id)  # type: ignore[arg-type]
    return base


class PromptCleaner:
    """Stateless orchestrator. Safe to instantiate once and reuse."""

    def run(
        self,
        text: str,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        cfg = config or {}
        mode = cfg.get("mode", "tags")
        intensity = cfg.get("intensity", "balanced")
        overrides: dict[str, bool] = dict(cfg.get("rules_override") or {})

        # Blocklist auto-enables when entries are present unless the user
        # explicitly turned it off via override.
        blocklist_cfg = cfg.get("blocklist") or {}
        if blocklist_cfg.get("entries") and "blocklist" not in overrides:
            overrides["blocklist"] = True

        active = _effective_rules(intensity, overrides)
        out = text
        report: RunReport = {}
        for rule_id, fn in RULE_REGISTRY:
            if rule_id not in active:
                continue
            result = fn(out, mode, cfg)
            out = result["text"]
            report[rule_id] = result["stats"]
        return {"text": out, "report": report}

    def run_negative(
        self,
        text: str,
        config: dict[str, Any] | None = None,
        prompt: str = "",
    ) -> dict[str, Any]:
        """Clean the negative with the negative column's rules.

        `negative_rules_override` is the column's per-rule toggles; the
        blocklist entries are shared with the prompt column. The report
        always names tags the negative shares with `prompt` (the model is
        told to draw them and not draw them); `drop_prompt_overlap` removes
        them from the negative.
        """
        cfg = config or {}
        mode = cfg.get("mode", "tags")
        intensity = cfg.get("intensity", "balanced")
        overrides: dict[str, bool] = dict(cfg.get("negative_rules_override") or {})
        active = _effective_rules(intensity, overrides, INTENSITY_TO_NEG_RULES)
        out = text
        report: dict[str, Any] = {}
        for rule_id, fn in RULE_REGISTRY:
            if rule_id not in active:
                continue
            result = fn(out, mode, cfg)
            out = result["text"]
            report[rule_id] = result["stats"]

        from engine.negatives import split_tags, tag_key  # noqa: PLC0415

        prompt_keys = {tag_key(t) for t in split_tags(prompt)}
        tags = split_tags(out)
        overlap = [t for t in tags if tag_key(t) in prompt_keys]
        if overlap:
            report["prompt_overlap"] = {
                "tags": overlap,
                "dropped": bool(cfg.get("drop_prompt_overlap")),
            }
            if cfg.get("drop_prompt_overlap"):
                out = ", ".join(t for t in tags if tag_key(t) not in prompt_keys)
        return {"text": out, "report": report}
