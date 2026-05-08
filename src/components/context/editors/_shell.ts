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
  | "disabled_rule_ids" | "disabled_exception_keys" | "disabled_matrix_cells";

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
  fixed_values: ["values_overrides"],
  combine: ["internal"],
  derivation: ["disabled_rule_ids"],
  constraint: ["disabled_exception_keys", "disabled_matrix_cells"],
  pipeline: [],
};

export const INSTANCE_TAB_VISIBLE: Record<ModuleEntryKind, boolean> =
  Object.fromEntries(
    Object.entries(INSTANCE_FIELDS_PER_KIND).map(([k, v]) => [k, v.length > 0]),
  ) as Record<ModuleEntryKind, boolean>;
