import { describe, expect, it } from "vitest";
import {
  NEGATIVE_COLLAPSED_PROP,
  editorVariant,
  initialNegativeCollapsed,
} from "./templateEditor";

describe("editorVariant", () => {
  it("negative_template gets the negative editor with the reserved slot", () => {
    const v = editorVariant("negative_template");
    expect(v.negative).toBe(true);
    expect(v.ariaLabel).toBe("Negative template");
    expect(v.placeholder).toBe("$negatives");
    expect(v.reservedVars).toEqual(["negatives"]);
  });

  it("any other input is the prompt template", () => {
    const v = editorVariant("template");
    expect(v.negative).toBe(false);
    expect(v.ariaLabel).toBe("Prompt template");
    expect(v.reservedVars).toEqual([]);
  });
});

describe("initialNegativeCollapsed", () => {
  it("collapsed by default exactly when empty", () => {
    expect(initialNegativeCollapsed(undefined, "")).toBe(true);
    expect(initialNegativeCollapsed({}, "  ")).toBe(true);
    expect(initialNegativeCollapsed({}, "lowres, $negatives")).toBe(false);
  });

  it("a saved choice wins", () => {
    expect(initialNegativeCollapsed({ [NEGATIVE_COLLAPSED_PROP]: false }, "")).toBe(false);
    expect(initialNegativeCollapsed({ [NEGATIVE_COLLAPSED_PROP]: true }, "lowres")).toBe(true);
  });
});
