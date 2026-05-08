import { describe, it, expect } from "vitest";
import { INSTANCE_FIELDS_PER_KIND, INSTANCE_TAB_VISIBLE } from "./_shell";

describe("INSTANCE_FIELDS_PER_KIND registry", () => {
  it("lists exactly the fields each kind exposes per spec §5.5", () => {
    expect(INSTANCE_FIELDS_PER_KIND.wildcard).toEqual([
      // v2 dropped `mode` + `pinned_option_id` — see
      // docs/superpowers/specs/2026-05-08-instance-overrides-v2-design.md §6.1.
      "variable_binding", "enabled_options",
      "option_weights", "category_filter", "locked_seed", "internal",
    ]);
    expect(INSTANCE_FIELDS_PER_KIND.fixed_values).toEqual([
      // `locked_seed` added in the combine + fixed_values syntax-parity
      // cycle (2026-05-08): fixed_values now resolves `{a|b|c}` per
      // value, so it gains seed-lock parity with wildcard + combine.
      "values_overrides", "enabled_options", "locked_seed",
    ]);
    expect(INSTANCE_FIELDS_PER_KIND.combine).toEqual([
      // v2 single-pane modal exposes per-instance overrides:
      //   - template_override (combine v2, this cycle)
      //   - variable_binding (matches wildcard's identity-section UX)
      //   - locked_seed (parity with wildcard + fixed_values)
      //   - internal (existing hide-from-prompt toggle)
      "template_override", "variable_binding", "locked_seed", "internal",
    ]);
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
