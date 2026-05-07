import { describe, it, expect } from "vitest";
import { INSTANCE_FIELDS_PER_KIND, INSTANCE_TAB_VISIBLE } from "./_shell";

describe("INSTANCE_FIELDS_PER_KIND registry", () => {
  it("lists exactly the fields each kind exposes per spec §5.5", () => {
    expect(INSTANCE_FIELDS_PER_KIND.wildcard).toEqual([
      "variable_binding", "mode", "pinned_option_id", "enabled_options",
      "option_weights", "category_filter", "locked_seed", "internal",
    ]);
    expect(INSTANCE_FIELDS_PER_KIND.fixed_values).toEqual(["values_overrides"]);
    expect(INSTANCE_FIELDS_PER_KIND.combine).toEqual(["internal"]);
    expect(INSTANCE_FIELDS_PER_KIND.derivation).toEqual(["disabled_rule_ids"]);
    expect(INSTANCE_FIELDS_PER_KIND.constraint).toEqual([
      "disabled_exception_keys", "disabled_matrix_cells",
    ]);
    expect(INSTANCE_FIELDS_PER_KIND.pipeline).toEqual([]);
  });
});

describe("INSTANCE_TAB_VISIBLE", () => {
  it("derives from registry: true when fields list is non-empty", () => {
    expect(INSTANCE_TAB_VISIBLE.wildcard).toBe(true);
    expect(INSTANCE_TAB_VISIBLE.fixed_values).toBe(true);
    expect(INSTANCE_TAB_VISIBLE.combine).toBe(true);
    expect(INSTANCE_TAB_VISIBLE.derivation).toBe(true);
    expect(INSTANCE_TAB_VISIBLE.constraint).toBe(true);
    expect(INSTANCE_TAB_VISIBLE.pipeline).toBe(false);
  });
});
