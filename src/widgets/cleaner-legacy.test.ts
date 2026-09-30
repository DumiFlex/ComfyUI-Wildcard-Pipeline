import { describe, it, expect } from "vitest";
import { upgradeLegacyValues } from "./cleaner";

function node(prompt: unknown, negative: unknown, rules: unknown) {
  return {
    widgets: [
      { name: "prompt", value: prompt },
      { name: "negative", value: negative },
      { name: "wp_cleaner", value: rules },
    ],
  };
}
const RULES = '{"intensity":"aggressive"}';

describe("upgradeLegacyValues", () => {
  it("moves the rules JSON out of the negative box for a two-value workflow", () => {
    const n = node("a cat", RULES, "{}");
    upgradeLegacyValues(n, { widgets_values: ["a cat", RULES] });
    expect(n.widgets.map((w) => w.value)).toEqual(["a cat", "", RULES]);
  });

  it("leaves a three-value workflow alone", () => {
    const n = node("a cat", "blurry", RULES);
    upgradeLegacyValues(n, { widgets_values: ["a cat", "blurry", RULES] });
    expect(n.widgets.map((w) => w.value)).toEqual(["a cat", "blurry", RULES]);
  });

  it("leaves a workflow restored by name alone", () => {
    const n = node("a cat", "blurry", RULES);
    upgradeLegacyValues(n, { widgets_values: ["a cat", RULES], widgets_values_named: { prompt: "a cat" } });
    expect(n.widgets[1]!.value).toBe("blurry");
  });

  it("ignores missing info or widgets", () => {
    expect(() => upgradeLegacyValues({}, { widgets_values: ["a", RULES] })).not.toThrow();
    expect(() => upgradeLegacyValues(node("a", "", "{}"), null)).not.toThrow();
  });
});
