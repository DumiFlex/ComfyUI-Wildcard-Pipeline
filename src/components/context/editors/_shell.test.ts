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
    expect(INSTANCE_FIELDS_PER_KIND.derivation).toEqual([
      // Tier-D modal expansion (2026-05-10): per-rule + per-branch
      // overrides + value overrides + reorder + runtime fields. Reset
      // preserves locked_seed + internal (wildcard-style split).
      "disabled_rule_ids",
      "disabled_branch_keys",
      "action_value_overrides",
      "condition_value_overrides",
      "rule_order_override",
      "locked_seed",
      "internal",
    ]);
    expect(INSTANCE_FIELDS_PER_KIND.constraint).toEqual([
      // Tier-D modal expansion (2026-05-10): per-cell + per-exception
      // mode/factor overrides + extras. Existing v1 disable lists
      // preserved at the front of the array.
      "disabled_exception_keys",
      "disabled_matrix_cells",
      "cell_mode_overrides",
      "cell_factor_overrides",
      "exception_mode_overrides",
      "exception_factor_overrides",
      "extra_exceptions",
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
