import { kindIcon } from "../../shared/kind-icons";
import type { ModuleEntryKind } from "../../../widgets/_shared";

export type ModuleKind = ModuleEntryKind;

export const KIND_TITLE: Record<string, string> = {
  wildcard: "wildcard",
  fixed_values: "fixed",
  combine: "combine",
  derivation: "derivation",
  constraint: "constraint",
};

export function kindHeaderIcon(kind: string): string {
  return kindIcon(kind);
}

export type InstanceFieldKey =
  | "variable_binding" | "enabled_options" | "option_weights" | "category_filter"
  | "mode" | "pinned_option_id" | "locked_seed" | "internal" | "values_overrides"
  | "template_override"
  | "disabled_rule_ids"
  // Derivation tier-D modal expansion (2026-05-10 cycle)
  | "disabled_branch_keys"
  | "action_value_overrides"
  | "condition_value_overrides"
  | "rule_order_override"
  | "disabled_exception_keys" | "disabled_matrix_cells"
  // Constraint tier-D modal expansion (2026-05-10 cycle)
  | "cell_mode_overrides"
  | "cell_factor_overrides"
  | "exception_mode_overrides"
  | "exception_factor_overrides"
  | "extra_exceptions";

/** Single source of truth for which instance fields each kind exposes.
 *  Drives:
 *   - Tab visibility (INSTANCE_TAB_VISIBLE)
 *   - Modified-state computed (count populated entries from this list)
 *   - "Clear all overrides" button (iterate this list to null each)
 *   - Future validators / drift detection
 *
 *  See: docs/superpowers/specs/2026-05-07-instance-overrides-modal-design.md §5.5
 */
export const INSTANCE_FIELDS_PER_KIND: Record<ModuleEntryKind, readonly InstanceFieldKey[]> = {
  wildcard: [
    // `mode` + `pinned_option_id` dropped in v2 — resolve mode is
    // implicit in pool state. Engine handler still reads them on
    // legacy snapshots; UI never writes them.
    "variable_binding", "enabled_options",
    "option_weights", "category_filter", "locked_seed", "internal",
  ],
  fixed_values: ["values_overrides", "enabled_options", "locked_seed"],
  combine: ["template_override", "variable_binding", "locked_seed", "internal"],
  derivation: [
    // Tier-D modal expansion (2026-05-10):
    //   - rule-group overrides (cleared by Reset btn)
    //   - runtime fields (preserved by Reset btn — wildcard-style split)
    "disabled_rule_ids",
    "disabled_branch_keys",
    "action_value_overrides",
    "condition_value_overrides",
    "rule_order_override",
    "locked_seed",
    "internal",
  ],
  constraint: [
    // Existing v1 disable lists (preserved):
    "disabled_exception_keys",
    "disabled_matrix_cells",
    // Tier-D modal expansion (2026-05-10):
    //   - cell + exception overrides keyed via encodeKey of (src, tgt)
    //   - extra_exceptions: instance-only addition, never library-bound
    "cell_mode_overrides",
    "cell_factor_overrides",
    "exception_mode_overrides",
    "exception_factor_overrides",
    "extra_exceptions",
  ],
  pipeline: [],
};

export const INSTANCE_TAB_VISIBLE: Record<ModuleEntryKind, boolean> =
  Object.fromEntries(
    Object.entries(INSTANCE_FIELDS_PER_KIND).map(([k, v]) => [k, v.length > 0]),
  ) as Record<ModuleEntryKind, boolean>;
