import { describe, it, expect } from "vitest";
import { getValidator } from "@/validators";

import wildcardFixture from "@/validators/fixtures/v1/module-wildcard.json";
import fixedValuesFixture from "@/validators/fixtures/v1/module-fixed_values.json";
import combineFixture from "@/validators/fixtures/v1/module-combine.json";
import derivationFixture from "@/validators/fixtures/v1/module-derivation.json";
import constraintFixture from "@/validators/fixtures/v1/module-constraint.json";
import bundleFixture from "@/validators/fixtures/v1/bundle.json";

describe("validator registry", () => {
  it("returns a strict validator for each subtype at v1", () => {
    for (const subtype of ["wildcard", "fixed_values", "combine", "derivation", "constraint"] as const) {
      const validator = getValidator({ kind: "module", subtype, version: 1, mode: "strict" });
      expect(validator).toBeDefined();
    }
  });

  it("strict validators accept their own fixtures", () => {
    const cases = [
      ["wildcard", wildcardFixture],
      ["fixed_values", fixedValuesFixture],
      ["combine", combineFixture],
      ["derivation", derivationFixture],
      ["constraint", constraintFixture],
    ] as const;
    for (const [subtype, fixture] of cases) {
      const v = getValidator({ kind: "module", subtype, version: 1, mode: "strict" });
      const result = v.safeParse(fixture);
      expect(result.success).toBe(true);
    }
  });

  it("bundle v1 validator accepts the bundle fixture", () => {
    const v = getValidator({ kind: "bundle", version: 1, mode: "strict" });
    expect(v.safeParse(bundleFixture).success).toBe(true);
  });

  it("strict validators reject extra fields", () => {
    const v = getValidator({ kind: "module", subtype: "wildcard", version: 1, mode: "strict" });
    const withExtra = { ...wildcardFixture, mystery_field: 42 };
    expect(v.safeParse(withExtra).success).toBe(false);
  });

  it("tolerant validators silently strip extra fields", () => {
    const v = getValidator({ kind: "module", subtype: "wildcard", version: 1, mode: "tolerant" });
    const withExtra = { ...wildcardFixture, mystery_field: 42 };
    const result = v.safeParse(withExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("mystery_field" in result.data).toBe(false);
    }
  });

  it("throws on unknown (kind, version)", () => {
    expect(() => getValidator({ kind: "module", subtype: "wildcard", version: 99, mode: "strict" }))
      .toThrowError(/no validator for/);
  });
});
