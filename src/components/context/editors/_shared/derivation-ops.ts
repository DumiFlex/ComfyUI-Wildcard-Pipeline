/**
 * Derivation ops registry — single source of truth for op metadata
 * surfaced by the SPA rule editor + (future) the inline modal.
 *
 * Keeps engine `_VALID_OPS` (engine/modules/derivation_handler.py) in
 * lockstep with the frontend dropdown by enumerating ops here and
 * letting both layers reference the same names.
 *
 * Ops split into two semantic groups:
 *   - **Compare ops** (equals / not_equals / contains / matches) read
 *     `condition.value` and compare against ctx[var].
 *   - **Presence ops** (exists / not_exists / is_set / is_unset) only
 *     check key presence (`exists`/`not_exists`) or non-empty value
 *     (`is_set`/`is_unset`); `condition.value` is ignored, so the
 *     editor disables the value input via `VALUE_DISABLED_OPS`.
 *
 * Plain TS — no Vue dep so engine-crosswalk future tests + headless
 * tooling can import without spinning up Vue.
 */

export const DERIVATION_OPS = [
  "equals",
  "not_equals",
  "contains",
  "matches",
  "exists",
  "not_exists",
  "is_set",
  "is_unset",
  "is_empty",
  "is_not_empty",
] as const;

export type DerivationOp = (typeof DERIVATION_OPS)[number];

/** User-facing label in the dropdown. Reads naturally as part of the
 *  prose layout: "When $age <equals> 30". `not_equals` collapses to
 *  the math symbol "≠" so the row stays compact in Proposal B grid. */
export const OP_LABELS: Record<DerivationOp, string> = {
  equals: "equals",
  not_equals: "not equals",
  contains: "contains",
  matches: "matches (regex)",
  exists: "exists",
  not_exists: "does not exist",
  is_set: "is set",
  is_unset: "is unset",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

/** Semantic tooltip text shown on hover of each option. Surfaced via
 *  the dropdown's `title` attribute so user understands behavior
 *  without trial-and-error. The matches text intentionally references
 *  `re.search` + `regex101` so the regex-help popover (Task 8) reads
 *  consistently with this tooltip. */
export const OP_TOOLTIPS: Record<DerivationOp, string> = {
  equals: "Exact string match (case-sensitive)",
  not_equals: "Not an exact string match",
  contains: "Substring match (case-sensitive)",
  matches: "Python regex via re.search — test patterns at regex101.com (Python flavor)",
  exists: "Variable key is present in the runtime context (any value, even empty)",
  not_exists: "Variable key is absent from the runtime context",
  is_set: "Variable is present AND has a non-empty value",
  is_unset: "Variable is absent OR has an empty value",
  is_empty: "Variable resolved to an empty string (including the null option of a wildcard)",
  is_not_empty: "Variable resolved to a non-empty string",
};

/** Operator-specific placeholder for the condition-value input. Drives
 *  the `placeholder` attribute so users see a real example matching
 *  the selected op shape (`30` for equals, `^a.*z$` for matches).
 *  Presence ops inherit the disabled-state placeholder. */
export const OP_PLACEHOLDERS: Record<DerivationOp, string> = {
  equals: "30",
  not_equals: "not this value",
  contains: "warm",
  matches: "^a.*z$",
  exists: "no value needed",
  not_exists: "no value needed",
  is_set: "no value needed",
  is_unset: "no value needed",
  is_empty: "no value needed",
  is_not_empty: "no value needed",
};

/** Ops where the condition-value input is purely informational —
 *  engine ignores `condition.value` for these. Editor binds this set
 *  to the input's `disabled` attribute so the field grays out + reads
 *  read-only when one of these ops is selected.
 *
 *  Payload value is preserved on toggle (engine just doesn't read it),
 *  so flipping back to `equals` restores the user's typed value. */
export const VALUE_DISABLED_OPS: ReadonlySet<DerivationOp> = new Set<DerivationOp>([
  "exists",
  "not_exists",
  "is_set",
  "is_unset",
  "is_empty",
  "is_not_empty",
]);
