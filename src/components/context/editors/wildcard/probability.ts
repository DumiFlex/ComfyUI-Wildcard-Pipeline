/**
 * Probability helpers for wildcard option rows. Pure functions — no Vue
 * imports. The modal's `OptionRow` calls `probabilityFor(option, allOptions, instance)`
 * to derive its visual `width%` and `NN%` label live as toggles + weights change.
 *
 * Mirrors the engine's pick semantics in `engine/modules/wildcard_handler.py`:
 *   - `enabled_options` null → all options eligible (library default)
 *   - `enabled_options` array → only listed ids eligible
 *   - `category_filter` boolean expression → restrict to options whose
 *     `sub_categories` satisfy the parsed expression (OR/AND/NOT over tags).
 *     Empty/null/absent = no filter. See the multi-tag boolean-filter design
 *     `docs/superpowers/specs/2026-06-06-wildcard-multi-subcategory-boolean-filter-design.md`.
 *   - `option_weights[id]` overrides library `option.weight`, else fall back to 1.0
 *
 * See: docs/superpowers/specs/2026-05-08-instance-overrides-v2-design.md §8.3
 */
import { matches, parse } from "@/manager/parsing/subcatFilter";

export interface WildcardOption {
  id: string;
  weight?: number;
  /** Sub-category tags this option belongs to. Multi-tag (v2): an option
   *  can sit on several axes at once (e.g. `["feline", "warm"]`). Empty
   *  array = untagged. The boolean `category_filter` matches against this
   *  set via the shared parser. */
  sub_categories: string[];
  /** Marks the single optional "null option" per wildcard — picks
   *  resolve to empty string. See spec
   *  `docs/superpowers/specs/2026-05-24-null-wildcard-option-design.md`. */
  is_null?: boolean;
}

export interface InstanceLike {
  enabled_options?: string[] | null;
  option_weights?: Record<string, number> | null;
  /** Boolean sub-category expression (e.g. `"feline and warm"`, `"not lynx"`).
   *  Empty/null/absent = no filter. Parsed + matched via the shared parser. */
  category_filter?: string | null;
  /** When true the null option is dropped from the pool. The sub-category
   *  `category_filter` never strips the null slot — only this toggle does
   *  (the null option carries no tags, so it's orthogonal to the filter). */
  exclude_null?: boolean;
}

export function isEnabled(option: WildcardOption, instance: InstanceLike): boolean {
  if (Array.isArray(instance.enabled_options) && !instance.enabled_options.includes(option.id)) {
    return false;
  }
  // Null option intentionally has no sub-categories. Category filters are
  // about narrowing the tag-bearing pool — the null option is an orthogonal
  // "no-output" slot governed solely by `exclude_null`.
  if (option.is_null) {
    return !instance.exclude_null;
  }
  return matches(parse(instance.category_filter ?? ""), new Set(option.sub_categories ?? []));
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
