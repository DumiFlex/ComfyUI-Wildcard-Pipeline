import { describe, expect, it } from "vitest";
import { constraintExceptionHaystack, derivationRuleHaystack } from "./listFilter";
import type { DerivationRule } from "../api/types";

function rule(partial: Partial<DerivationRule> = {}): DerivationRule {
  return {
    id: "rule_abc123",
    branches: [
      {
        condition: { var: "location", op: "equals", value: "outdoors" },
        action: { target_var: "outfit", mode: "replace", value: "raincoat" },
      },
    ],
    ...partial,
  };
}

describe("derivationRuleHaystack", () => {
  it("matches on a condition variable, the operator, and the literal", () => {
    const h = derivationRuleHaystack(rule());
    expect(h).toContain("location");
    expect(h).toContain("equals");
    expect(h).toContain("outdoors");
  });

  it("matches on the action's target variable and value", () => {
    const h = derivationRuleHaystack(rule());
    expect(h).toContain("outfit");
    expect(h).toContain("raincoat");
  });

  it("covers every branch, not just the first", () => {
    const h = derivationRuleHaystack(rule({
      branches: [
        {
          condition: { var: "a", op: "equals", value: "1" },
          action: { target_var: "x", mode: "replace", value: "first" },
        },
        {
          condition: { var: "weather", op: "contains", value: "rain" },
          action: { target_var: "y", mode: "append", value: "wet" },
        },
      ],
    }));
    expect(h).toContain("weather");
    expect(h).toContain("wet");
  });

  it("covers the else action", () => {
    const h = derivationRuleHaystack(rule({
      else: { action: { target_var: "mood", mode: "replace", value: "cheerful" } },
    }));
    expect(h).toContain("mood");
    expect(h).toContain("cheerful");
  });

  it("excludes the generated id", () => {
    // The id is never rendered, so a hit on it would be unexplainable.
    expect(derivationRuleHaystack(rule())).not.toContain("rule_abc123");
  });

  it("lowercases, so the caller can compare a lowercased query", () => {
    const h = derivationRuleHaystack(rule({
      branches: [{
        condition: { var: "Location", op: "equals", value: "Outdoors" },
        action: { target_var: "Outfit", mode: "replace", value: "Raincoat" },
      }],
    }));
    expect(h).toContain("outdoors");
    expect(h).not.toContain("Outdoors");
  });

  it("survives a half-built rule with no branches", () => {
    // `Add rule` creates a blank; filtering must not throw on it.
    expect(() => derivationRuleHaystack(rule({ branches: [] }))).not.toThrow();
    expect(derivationRuleHaystack(rule({ branches: [] }))).toBe("");
  });
});

describe("constraintExceptionHaystack", () => {
  const label = (v: string) => (v === "@{deadbeef}" ? "Rainy scenes" : v);
  const modeLabel = () => "Exclude";

  it("matches the RESOLVED label, not the stored uuid token", () => {
    const h = constraintExceptionHaystack(
      { source: "@{deadbeef}", target: "boots", mode: "exclude" },
      label,
      modeLabel,
    );
    expect(h).toContain("rainy scenes");
    // Searching for a uuid nobody can see would be a hit the user cannot explain.
    expect(h).not.toContain("deadbeef");
  });

  it("matches on source, target and mode label", () => {
    const h = constraintExceptionHaystack(
      { source: "sunny", target: "sandals", mode: "exclude" },
      label,
      modeLabel,
    );
    expect(h).toContain("sunny");
    expect(h).toContain("sandals");
    expect(h).toContain("exclude");
  });

  it("drops empty halves rather than joining blanks", () => {
    // A null source renders as "⌀ null" in the table but resolves to "" here;
    // the join must not leave double spaces that break a multi-word query.
    const h = constraintExceptionHaystack(
      { source: "", target: "boots", mode: "exclude" },
      label,
      modeLabel,
    );
    expect(h).toBe("boots exclude");
  });
});
