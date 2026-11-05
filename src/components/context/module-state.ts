import type { ModuleEntry } from "../../widgets/_shared";
import { currentFrame } from "../context-loop/frame-cursor";
import {
  withFrameInstance,
  effectiveEnabled as feEffectiveEnabled,
  frameEnableOverride as feFrameEnableOverride,
} from "./frame-overrides";

/**
 * Per-row module predicates + labels for the Context canvas: which kinds
 * can be locked / held / hidden, whether a row carries local overrides
 * (the MOD dot + its tooltip), the kind chip slug, and the binding helpers
 * duplicate / embed use for auto-suffixing. Pure functions of a
 * `ModuleEntry`; the frame-aware ones read the shared `currentFrame`
 * cursor (frame-cursor.ts) so ModuleRow sees frame #k's effective state.
 */

export function isCollapsed(m: ModuleEntry): boolean {
  return m.collapsed === true;
}

/** Non-empty array helper — null/undefined/empty all read as "no override". */
export function nonEmptyArr(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/** Non-empty object helper — null/undefined/{} all read as "no override". */
export function nonEmptyObj(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    && Object.keys(v as Record<string, unknown>).length > 0;
}

/**
 * Per-instance override detection. A library-snapshot module is
 * "modified" when any field on `m.instance` differs from the engine's
 * `_fresh_instance()` defaults — option enable/disable, weight
 * overrides, mode (pinned / subcategory), or category filter. Drives
 * the small accent dot on the card header so users can spot which
 * picked modules they've tweaked locally.
 *
 * Symmetric with the modal's `hasInstanceOverrides` (kept in sync
 * manually — small enough surface that DRYing isn't worth a shared
 * util yet).
 */
export function isModified(m: ModuleEntry): boolean {
  // Lock + internal have their own dedicated header buttons, so
  // double-counting them in the "modified" dot is just visual
  // noise. The modified indicator is reserved for state that
  // diverges from the library snapshot.
  const inst = m.instance;
  if (!inst) return false;
  switch (m.type) {
    case "wildcard":
      // Pool overrides — anything that changes WHICH option a roll picks.
      // Identity (display name + variable_binding) is intentionally
      // excluded: those have their own per-field reset icon inside the
      // modal, and counting them in the outer mod dot would conflate
      // identity-level renames with behavioural overrides.
      if (nonEmptyArr(inst.enabled_options)) return true;
      if (nonEmptyObj(inst.option_weights)) return true;
      if (inst.mode && inst.mode !== "random") return true;
      if (inst.pinned_option_id) return true;
      if (typeof inst.match_variable === "string" && inst.match_variable.trim() !== "") return true;
      // `category_filter` is a STRING expr — the old `nonEmptyArr()` test
      // never matched it, so toggling the pool filter never lit the dot.
      if (typeof inst.category_filter === "string" && inst.category_filter.trim() !== "") return true;
      if (inst.exclude_null) return true;
      // Pick-range override (multi-pick / narrowed). Sparse — absent or 1..1
      // is the library default; anything else is a behavioural override.
      if (inst.pick_min != null && inst.pick_min !== 1) return true;
      if (inst.pick_max != null && inst.pick_max !== 1) return true;
      if (inst.pick_independent) return true;
      if (typeof inst.pick_separator === "string" && inst.pick_separator !== "") return true;
      return false;
    case "fixed_values":
      // Library-tracked: `values_overrides` non-empty = user edited entries,
      // OR `enabled_options` set means user toggled row enable/disable.
      // Inline-created (no payload_hash) never light up — no library anchor.
      if (nonEmptyArr((inst as { values_overrides?: unknown }).values_overrides)) return true;
      if (Array.isArray(inst.enabled_options)) return true;
      return false;
    case "combine":
      // Template override only. Identity (binding) excluded — see
      // wildcard branch comment.
      if (typeof inst.template_override === "string" && inst.template_override.length > 0) return true;
      if (typeof inst.negative_override === "string") return true;
      return false;
    case "derivation":
      if (nonEmptyArr(inst.disabled_rule_ids)) return true;
      if (nonEmptyArr(inst.disabled_branch_keys)) return true;
      if (nonEmptyObj(inst.action_value_overrides)) return true;
      if (nonEmptyObj(inst.condition_value_overrides)) return true;
      if (nonEmptyArr(inst.rule_order_override)) return true;
      return false;
    case "constraint":
      if (nonEmptyArr(inst.disabled_exception_keys)) return true;
      if (nonEmptyArr(inst.disabled_matrix_cells)) return true;
      if (nonEmptyObj(inst.cell_mode_overrides)) return true;
      if (nonEmptyObj(inst.cell_factor_overrides)) return true;
      if (nonEmptyObj(inst.exception_mode_overrides)) return true;
      if (nonEmptyObj(inst.exception_factor_overrides)) return true;
      if (nonEmptyArr(inst.extra_exceptions)) return true;
      return false;
    default:
      return false;
  }
}

/** Kinds whose engine handler honors `instance.locked_seed`. Wildcard
 *  pins option pick; combine pins `{a|b|c}` template resolution;
 *  fixed_values pins per-value alternation; derivation pins inline
 *  syntax resolution inside `action.value` (`{a|b|c}` + nested
 *  wildcards) — see derivation_handler.resolve. Other kinds
 *  (constraint) ignore the field — engine doesn't read it.
 *  Inline lock action gates on this set so the icon only appears
 *  where it actually does something. */
export const SEED_LOCKABLE_KINDS: ReadonlySet<string> = new Set([
  "wildcard", "combine", "fixed_values", "derivation",
]);
export function isSeedLockable(m: ModuleEntry): boolean {
  return SEED_LOCKABLE_KINDS.has(m.type);
}

/** True for kinds that produce bindings — i.e. everything EXCEPT
 *  constraint. Constraint modules don't write any `$var`; they only
 *  constrain the relationship between two existing wildcards, so the
 *  `instance.internal` flag has no surface to hide and toggling it
 *  would be a no-op. Bundle master-toggle aggregation and the
 *  per-card internal button both gate on this. */
export function isInternalable(m: ModuleEntry): boolean {
  return m.type !== "constraint";
}

export function isLocked(m: ModuleEntry): boolean {
  return typeof withFrameInstance(m, currentFrame.value).instance?.locked_seed === "number";
}
export function isInternal(m: ModuleEntry): boolean {
  return !!m.instance?.internal;
}
/** Kinds whose handlers honor `seed_scope: hold` — wildcard, combine,
 *  fixed_values, and derivation (which freezes its frame-0 output across a
 *  loop, constrained picks + nested @{} refs included). Now equal to
 *  SEED_LOCKABLE_KINDS, but kept distinct on purpose: lock-the-seed and
 *  hold-the-value are different concepts that could diverge again. Gates
 *  the row context-menu's quick Hold item + which RuntimeSections render
 *  the toggle. */
export const HOLD_KINDS: ReadonlySet<string> = new Set([
  "wildcard", "combine", "fixed_values", "derivation",
]);
export function isHoldable(m: ModuleEntry): boolean {
  return HOLD_KINDS.has(m.type);
}
export function isHeld(m: ModuleEntry): boolean {
  return m.instance?.seed_scope === "hold";
}
export function isOverriddenOnFrame(m: ModuleEntry): boolean {
  const k = currentFrame.value;
  return k != null && !!m.iteration_overrides?.[String(k)];
}
export function effectiveLockedSeed(m: ModuleEntry): number | undefined {
  const v = withFrameInstance(m, currentFrame.value).instance?.locked_seed;
  return typeof v === "number" ? v : undefined;
}

/** Tooltip listing what's been overridden on the module — surfaced
 *  on hover of the modified-indicator dot. Order matches each kind's
 *  modal section layout for visual consistency. */
export function modifiedTooltip(m: ModuleEntry): string {
  const inst = m.instance;
  if (!inst) return "";
  const bits: string[] = [];
  switch (m.type) {
    case "wildcard":
      if (inst.mode === "pinned") bits.push("pinned");
      if (typeof inst.match_variable === "string" && inst.match_variable.trim()) {
        bits.push(`matches $${inst.match_variable.trim()}`);
      }
      else if (inst.mode === "subcategory") bits.push("subset");
      if (inst.category_filter) {
        bits.push(`cats: ${inst.category_filter}`);
      }
      if (Array.isArray(inst.enabled_options)) {
        bits.push(`${inst.enabled_options.length} option(s) enabled`);
      }
      if (nonEmptyObj(inst.option_weights)) {
        bits.push(`${Object.keys(inst.option_weights as Record<string, unknown>).length} weight override(s)`);
      }
      break;
    case "fixed_values": {
      const overrides = (inst as { values_overrides?: unknown[] }).values_overrides;
      if (Array.isArray(overrides) && overrides.length > 0) {
        bits.push(`${overrides.length} value override(s)`);
      }
      if (Array.isArray(inst.enabled_options)) {
        bits.push(`${inst.enabled_options.length} row(s) enabled`);
      }
      break;
    }
    case "combine":
      if (typeof inst.template_override === "string" && inst.template_override.length > 0) {
        bits.push("template override");
      }
      if (typeof inst.negative_override === "string") bits.push("negative override");
      if (typeof inst.variable_binding === "string" && inst.variable_binding.length > 0) {
        bits.push(`binding: ${inst.variable_binding}`);
      }
      break;
    case "derivation":
      if (nonEmptyArr(inst.disabled_rule_ids)) bits.push(`${(inst.disabled_rule_ids as string[]).length} rule(s) disabled`);
      if (nonEmptyArr(inst.disabled_branch_keys)) bits.push(`${(inst.disabled_branch_keys as string[]).length} branch(es) disabled`);
      if (nonEmptyObj(inst.action_value_overrides)) bits.push("action overrides");
      if (nonEmptyObj(inst.condition_value_overrides)) bits.push("condition overrides");
      if (nonEmptyArr(inst.rule_order_override)) bits.push("reordered");
      break;
    case "constraint": {
      const cellOverrides =
        (nonEmptyObj(inst.cell_mode_overrides) ? Object.keys(inst.cell_mode_overrides as object).length : 0)
        + (nonEmptyObj(inst.cell_factor_overrides) ? Object.keys(inst.cell_factor_overrides as object).length : 0);
      if (cellOverrides > 0) bits.push(`${cellOverrides} cell override(s)`);
      if (nonEmptyArr(inst.disabled_matrix_cells)) bits.push(`${(inst.disabled_matrix_cells as string[]).length} cell(s) disabled`);
      if (nonEmptyArr(inst.disabled_exception_keys)) bits.push(`${(inst.disabled_exception_keys as string[]).length} exception(s) disabled`);
      const excOverrides =
        (nonEmptyObj(inst.exception_mode_overrides) ? Object.keys(inst.exception_mode_overrides as object).length : 0)
        + (nonEmptyObj(inst.exception_factor_overrides) ? Object.keys(inst.exception_factor_overrides as object).length : 0);
      if (excOverrides > 0) bits.push(`${excOverrides} exception override(s)`);
      if (nonEmptyArr(inst.extra_exceptions)) bits.push(`${(inst.extra_exceptions as unknown[]).length} extra exception(s)`);
      break;
    }
  }
  return bits.length > 0 ? `Modified: ${bits.join(" · ")}` : "Modified";
}

/**
 * Normalize a module type into the slug used by the
 * `--wp-kind-{slug}` CSS tokens (see `shared/theme.css`). The engine
 * uses `fixed_values` but the colour token is `--wp-kind-fixed`, so
 * the kind chip needs a small alias map. Other kinds pass through
 * unchanged so adding a new kind requires only a token + a
 * `KIND_TITLE` entry, no chip-side change.
 */
export function kindChipModifier(kind: string): string {
  return kind === "fixed_values" ? "fixed" : kind;
}

/** Returns the kind-specific primary binding name (without `$`),
 *  honoring instance overrides. Null when the kind has no single
 *  primary binding (derivation, constraint, fixed_values). */
export function extractPrimaryBinding(m: ModuleEntry): string | null {
  const inst = m.instance?.variable_binding;
  if (typeof inst === "string" && inst.trim()) return inst.trim();
  const p = (m.payload ?? {}) as Record<string, unknown>;
  if (m.type === "wildcard") {
    const b = p.var_binding;
    return typeof b === "string" && b.trim() ? b.trim() : null;
  }
  if (m.type === "combine") {
    const b = p.output_var;
    return typeof b === "string" && b.trim() ? b.trim() : null;
  }
  return null;
}

/** Collect every binding currently in use within this Context's
 *  modules — used to seed the auto-suffix collision set. */
export function collectInContextBindings(modules: readonly ModuleEntry[]): Set<string> {
  const out = new Set<string>();
  for (const m of modules) {
    const b = extractPrimaryBinding(m);
    if (b) out.add(b);
    if (m.type === "fixed_values") {
      for (const e of m.entries ?? []) {
        if (e.variable_name?.trim()) out.add(e.variable_name.trim());
      }
    }
  }
  return out;
}

// Thin wrappers binding the pure frame-overrides enable helpers to the reactive
// `currentFrame` cursor — exposed to ModuleRow via moduleRowCtx.
export function effectiveEnabled(m: ModuleEntry): boolean {
  return feEffectiveEnabled(m, currentFrame.value);
}
export function frameEnableOverride(m: ModuleEntry): "on" | "off" | null {
  return feFrameEnableOverride(m, currentFrame.value);
}
