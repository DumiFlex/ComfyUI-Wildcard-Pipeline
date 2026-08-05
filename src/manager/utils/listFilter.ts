import type { ConstraintException, ConstraintMode, DerivationRule } from "../api/types";

/**
 * Search text for the filter bars on the constraint and derivation editors.
 *
 * Kept out of the SFCs because "what does this row match on?" is the part worth
 * testing, and mounting an editor to assert it would test the wiring instead.
 *
 * Both builders return a lowercased haystack; callers do `.includes(query)`.
 * The rule is the same in both: **match what the row shows, not what it
 * stores.** A user searches for the text in front of them.
 */

/** Lowercased, space-joined, empty parts dropped. */
function haystack(parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(" ").toLowerCase();
}

/**
 * Every variable name, operator, mode and literal a rule mentions — across all
 * its IF/ELIF branches and its optional ELSE.
 *
 * The rule's `id` is deliberately excluded: it is generated, never rendered,
 * and matching it would produce hits the user cannot explain.
 */
export function derivationRuleHaystack(rule: DerivationRule): string {
  const parts: (string | undefined)[] = [];
  for (const b of rule.branches ?? []) {
    parts.push(b.condition?.var, b.condition?.op, b.condition?.value);
    parts.push(b.action?.target_var, b.action?.mode, b.action?.value);
  }
  const els = rule.else?.action;
  if (els) parts.push(els.target_var, els.mode, els.value);
  return haystack(parts);
}

/**
 * An exception's source and target as DISPLAYED, plus its mode label.
 *
 * `label` resolves an `@{uuid}` token to the module's name — the stored values
 * are frequently uuids, and nobody searches for a uuid they never see. Both
 * resolvers are injected because they live in the editor (they depend on the
 * loaded catalog and on the mode metadata table).
 */
export function constraintExceptionHaystack(
  ex: Pick<ConstraintException, "source" | "target" | "mode">,
  label: (value: string) => string,
  modeLabel: (mode: ConstraintMode) => string,
): string {
  return haystack([label(ex.source), label(ex.target), modeLabel(ex.mode)]);
}
