/**
 * Canonical PrimeIcons class per WP module kind.
 *
 * Single source — every widget that renders a kind icon (ContextWidget
 * row, ModulePickerModal row, ModuleEditModal header, AssemblerHelper
 * chip, conflict tooltip) imports from here. Changing an icon means
 * touching one map, not 8 files.
 *
 * Pipeline kind removed in the bundle cleanup pass — bundles replace
 * the legacy step-composition use case. Reintroducing pipelines later
 * means adding the row + a test, not refactoring callers.
 */
export const KIND_ICON_MAP = {
  wildcard:     "pi pi-sparkles",
  fixed_values: "pi pi-tag",
  combine:      "pi pi-link",
  derivation:   "pi pi-arrow-right-arrow-left",
  constraint:   "pi pi-filter",
  bundle:       "pi pi-box",
} as const;

export type WpKind = keyof typeof KIND_ICON_MAP;

/** Returns the PrimeIcons class for `kind`, or `pi pi-circle` for unknown kinds. */
export function kindIcon(kind: string): string {
  return (KIND_ICON_MAP as Record<string, string>)[kind] ?? "pi pi-circle";
}
