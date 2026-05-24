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
from engine.cleaner.types import CleanerCtx, RuleId, RunReport

INTENSITY_TO_RULES: dict[str, list[RuleId]] = {
    "gentle": ["whitespace"],
    "balanced": ["whitespace", "dedupe_exact", "wp_dedupe", "null_slot"],
    "aggressive": [
        "whitespace",
        "dedupe_exact",
        "wp_dedupe",
        "null_slot",
        "fuzzy_dedupe",
        "dangling_var",
        "reorder",
    ],
}


def _effective_rules(intensity: str, overrides: dict[str, bool]) -> set[RuleId]:
    base: set[RuleId] = set(INTENSITY_TO_RULES.get(intensity, INTENSITY_TO_RULES["balanced"]))
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
        ctx: CleanerCtx | None = None,
    ) -> dict[str, Any]:
        cfg = config or {}
        mode = cfg.get("mode", "tags")
        intensity = cfg.get("intensity", "balanced")
        overrides: dict[str, bool] = dict(cfg.get("rules_override") or {})

        # Blocklist auto-enables when entries are present (overridable).
        blocklist_cfg = cfg.get("blocklist") or {}
        if blocklist_cfg.get("entries") and "blocklist" not in overrides:
            overrides["blocklist"] = True

        active = _effective_rules(intensity, overrides)
        out = text
        report: RunReport = {}
        for rule_id, fn in RULE_REGISTRY:
            if rule_id not in active:
                continue
            result = fn(out, mode, ctx, cfg)
            out = result["text"]
            report[rule_id] = result["stats"]
        return {"text": out, "report": report}
