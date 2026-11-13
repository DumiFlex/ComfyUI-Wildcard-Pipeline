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


def _step(rule: str, before: str, after: str) -> dict[str, Any]:
    """One trace step: the rule and, only when it changed the text, the text
    after it (unchanged steps stay small in the UI payload)."""
    return {"rule": rule, "text": after} if after != before else {"rule": rule}


def _run_rules(
    text: str, mode: str, cfg: dict[str, Any], active: set[RuleId],
) -> tuple[str, RunReport, list[dict[str, Any]]]:
    """Run the active rules in registry order: the text, each rule's stats,
    and one trace step per rule."""
    out = text
    report: RunReport = {}
    steps: list[dict[str, Any]] = []
    for rule_id, fn in RULE_REGISTRY:
        if rule_id not in active:
            continue
        result = fn(out, mode, cfg)
        steps.append(_step(rule_id, out, result["text"]))
        out = result["text"]
        report[rule_id] = result["stats"]
    return out, report, steps


def _trace(text: str, out: str, mode: str, steps: list[dict[str, Any]]) -> dict[str, Any]:
    """What the node's Last run window replays: the text in, the text out and
    each step between (`src/components/cleaner/types.ts:CleanerTrace`)."""
    return {"input": text, "output": out, "mode": mode, "steps": steps}


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
        out, report, steps = _run_rules(text, mode, cfg, active)
        return {"text": out, "report": report, "trace": _trace(text, out, mode, steps)}

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
        out, rule_report, steps = _run_rules(text, mode, cfg, active)
        report: dict[str, Any] = {**rule_report}

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
                dropped = ", ".join(t for t in tags if tag_key(t) not in prompt_keys)
                steps.append(_step("prompt_overlap", out, dropped))
                out = dropped
        return {"text": out, "report": report, "trace": _trace(text, out, mode, steps)}
