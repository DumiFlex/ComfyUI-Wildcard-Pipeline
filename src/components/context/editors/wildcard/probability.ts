/**
 * Probability helpers for wildcard option rows. Pure functions — no Vue
 * imports. The modal's `OptionRow` calls `probabilityFor(option, allOptions, instance)`
 * to derive its visual `width%` and `NN%` label live as toggles + weights change.
 *
 * Mirrors the engine's pick semantics in `engine/modules/wildcard_handler.py`:
 *   - `enabled_options` null → all options eligible (library default)
 *   - `enabled_options` array → only listed ids eligible
 *   - `category_filter` array → restrict to options whose sub_category is in the list
 *   - `option_weights[id]` overrides library `option.weight`, else fall back to 1.0
 *
 * See: docs/superpowers/specs/2026-05-08-instance-overrides-v2-design.md §8.3
 */
export interface WildcardOption {
  id: string;
  weight?: number;
  sub_category?: string;
  /** Marks the single optional "null option" per wildcard — picks
   *  resolve to empty string. See spec
   *  `docs/superpowers/specs/2026-05-24-null-wildcard-option-design.md`. */
  is_null?: boolean;
}

export interface InstanceLike {
  enabled_options?: string[] | null;
  option_weights?: Record<string, number> | null;
  category_filter?: string[] | null;
}

export function isEnabled(option: WildcardOption, instance: InstanceLike): boolean {
  if (Array.isArray(instance.enabled_options) && !instance.enabled_options.includes(option.id)) {
    return false;
  }
  if (Array.isArray(instance.category_filter) && instance.category_filter.length > 0) {
    // Null option intentionally has no sub_category. Category filters
    // are about narrowing the sub-cat-bearing pool — the null option is
    // an orthogonal "no-output" slot and stays in the pool regardless.
    // User can still toggle it off via `enabled_options` if desired.
    if (option.is_null) return true;
    if (!option.sub_category) return false;
    if (!instance.category_filter.includes(option.sub_category)) return false;
  }
  return true;
}

export function effectiveWeight(option: WildcardOption, instance: InstanceLike): number {
  const override = instance.option_weights?.[option.id];
  if (typeof override === "number") return override;
  return typeof option.weight === "number" ? option.weight : 1.0;
}

export function probabilityFor(
  option: WildcardOption,
  allOptions: readonly WildcardOption[],
  instance: InstanceLike,
): number {
  if (!isEnabled(option, instance)) return 0;
  const totalEnabledWeight = allOptions
    .filter((o) => isEnabled(o, instance))
    .reduce((sum, o) => sum + effectiveWeight(o, instance), 0);
  if (totalEnabledWeight === 0) return 0;
  return effectiveWeight(option, instance) / totalEnabledWeight;
}
