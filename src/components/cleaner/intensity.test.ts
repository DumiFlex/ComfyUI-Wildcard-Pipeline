import { describe, it, expect } from "vitest";
import { INTENSITY_TO_RULES, computeEffectiveRules, isPristine } from "./intensity";
import { emptyCleanerConfig, type CleanerNodeConfig } from "./types";

describe("intensity helpers", () => {
  it("INTENSITY_TO_RULES mirrors the Python pipeline", () => {
    expect(INTENSITY_TO_RULES.gentle).toEqual(["whitespace"]);
    expect(INTENSITY_TO_RULES.balanced).toEqual([
      "whitespace", "punctuation", "dedupe_exact", "wp_dedupe", "null_slot",
    ]);
    expect(INTENSITY_TO_RULES.aggressive).toHaveLength(7);
  });

  it("computeEffectiveRules returns intensity rules when no overrides", () => {
    expect(computeEffectiveRules(emptyCleanerConfig())).toEqual([
      "whitespace", "punctuation", "dedupe_exact", "wp_dedupe", "null_slot",
    ]);
  });

  it("rules_override true adds, false removes", () => {
    const cfg: CleanerNodeConfig = {
      ...emptyCleanerConfig(),
      rules_override: { dedupe_exact: false, fuzzy_dedupe: true },
    };
    const effective = computeEffectiveRules(cfg);
    expect(effective).not.toContain("dedupe_exact");
    expect(effective).toContain("fuzzy_dedupe");
  });

  it("non-empty blocklist appends blocklist rule", () => {
    const cfg: CleanerNodeConfig = {
      ...emptyCleanerConfig(),
      blocklist: { kind: "list", entries: ["watermark"] },
    };
    expect(computeEffectiveRules(cfg)).toContain("blocklist");
  });

  it("empty blocklist does not append the rule", () => {
    expect(computeEffectiveRules(emptyCleanerConfig())).not.toContain("blocklist");
  });

  it("isPristine true when overrides empty + blocklist empty", () => {
    expect(isPristine(emptyCleanerConfig())).toBe(true);
  });

  it("isPristine false when any override exists", () => {
    expect(isPristine({ ...emptyCleanerConfig(), rules_override: { fuzzy_dedupe: true } })).toBe(false);
  });

  it("isPristine false when blocklist has entries", () => {
    expect(isPristine({
      ...emptyCleanerConfig(),
      blocklist: { kind: "list", entries: ["x"] },
    })).toBe(false);
  });

  it("rules sorted by registry order regardless of toggle order", () => {
    const cfg: CleanerNodeConfig = {
      ...emptyCleanerConfig(),
      intensity: "gentle",
      rules_override: { fuzzy_dedupe: true, dedupe_exact: true },
    };
    expect(computeEffectiveRules(cfg)).toEqual([
      "whitespace", "dedupe_exact", "fuzzy_dedupe",
    ]);
  });
});
