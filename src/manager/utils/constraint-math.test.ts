import { describe, it, expect } from "vitest";
import { combineConstraintFactor, EXCLUDE } from "./constraint-math";
import corpus from "../../../tests/fixtures/constraint-corpus.json";

const pick = (value: string, tags: string[]) => ({ value, tags });
const opt = (value: string, tags: string[]) => ({ value, tags });

describe("combineConstraintFactor", () => {
  it("multi-tag option multiplies each matching cell", () => {
    const m = { rainy: { somber: { mode: "boost", factor: 2 }, tense: { mode: "reduce", factor: 0.5 } } };
    expect(combineConstraintFactor([pick("rain", ["rainy"])], opt("x", ["somber", "tense"]), m, [])).toBe(1);
  });
  it("exclude is absorbing", () => {
    const m = { rainy: { somber: { mode: "exclude", factor: 0 } } };
    expect(combineConstraintFactor([pick("rain", ["rainy"])], opt("blue", ["somber"]), m, [])).toBe(EXCLUDE);
  });
  it.each(corpus.cases)("corpus: $name", (c: any) => {
    const got = combineConstraintFactor(c.picks, c.option, c.matrix, c.exceptions);
    if (c.expect === "EXCLUDE") expect(got).toBe(EXCLUDE);
    else expect(got).toBeCloseTo(c.expect as number);
  });
});
