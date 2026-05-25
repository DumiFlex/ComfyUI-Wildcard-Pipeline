import { describe, it, expect } from "vitest";
import { INTENSITY_TO_RULES, computeEffectiveRules, isPristine } from "./intensity";
import { emptyCleanerConfig, type CleanerNodeConfig } from "./types";

describe("intensity helpers", () => {
  it("INTENSITY_TO_RULES mirrors the Python pipeline", () => {
    expect(INTENSITY_TO_RULES.gentle).toEqual(["whitespace"]);
    expect(INTENSITY_TO_RULES.balanced).toEqual([
      "whitespace", "punctuation", "dedupe_exact",
    ]);
    expect(INTENSITY_TO_RULES.aggressive).toHaveLength(4);
  });

  it("computeEffectiveRules returns intensity rules when no overrides", () => {
    expect(computeEffectiveRules(emptyCleanerConfig())).toEqual([
      "whitespace", "punctuation", "dedupe_exact",
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

  it("isPristine still true when blocklist has entries but no overrides", () => {
    // Blocklist entries are data, not a "modification" of the intensity preset.
    expect(isPristine({
      ...emptyCleanerConfig(),
      blocklist: { kind: "list", entries: ["x"] },
    })).toBe(true);
  });

  it("isPristine false when blocklist has entries AND override flips it off", () => {
    expect(isPristine({
      ...emptyCleanerConfig(),
      blocklist: { kind: "list", entries: ["x"] },
      rules_override: { blocklist: false },
    })).toBe(false);
  });

  it("isPristine true when blocklist override matches entries baseline", () => {
    // override=true with entries present matches the auto-enable baseline.
    expect(isPristine({
      ...emptyCleanerConfig(),
      blocklist: { kind: "list", entries: ["x"] },
      rules_override: { blocklist: true },
    })).toBe(true);
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
