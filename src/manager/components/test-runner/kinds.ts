/** Label + colour per stack kind, shared by the Test Runner components. */
import type { StackKind } from "../../utils/scenario";

export const KIND_META: Record<StackKind, { label: string; color: string; icon: string }> = {
  wildcard:     { label: "Wildcard",   color: "var(--wp-kind-wildcard)",   icon: "pi-sparkles" },
  combine:      { label: "Combine",    color: "var(--wp-kind-combine)",    icon: "pi-link" },
  constraint:   { label: "Constraint", color: "var(--wp-kind-constraint)", icon: "pi-filter" },
  derivation:   { label: "Derivation", color: "var(--wp-kind-derivation)", icon: "pi-arrow-right-arrow-left" },
  fixed_values: { label: "Fixed",      color: "var(--wp-kind-fixed)",      icon: "pi-tag" },
  bundle:       { label: "Bundle",     color: "var(--wp-bundle-default, #6366f1)", icon: "pi-box" },
};
