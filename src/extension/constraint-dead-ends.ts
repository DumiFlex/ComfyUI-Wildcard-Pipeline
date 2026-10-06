/**
 * Static check for constraints that can leave their target with nothing to
 * pick. A constraint "dead-ends" when some option of its SOURCE wildcard, once
 * picked, gives every live option of the TARGET a weight of 0 (excluded, an
 * Only rule shutting it out, a reduce to 0, or a 0 weight to begin with). At
 * run time that target binds an empty string and WP Debug shows
 * `constraint_excludes_all_options`; the canvas surfaces it before a run as the
 * `constraint_excludes_all` conflict on the constraint row.
 *
 * A target with a fallback option (schema 9) never dead-ends: the fallback
 * stands in. So this only fires when no fallback is left in the target's pool
 * (none flagged, or the node toggled it off).
 *
 * Deliberately lenient, so it never cries wolf:
 *   - one constraint at a time. Factors multiply and `exclude` absorbs, so a
 *     dead end found for one constraint is a dead end whatever else applies;
 *     two constraints that only empty the pool TOGETHER are not reported.
 *   - a source option's `accepts`-axis tags fold with max (the option is
 *     reported only when EVERY tag it could roll leads to an empty target).
 *   - a source option is tested as a single pick; multi-pick only adds more
 *     factors, so it can't rescue a dead end either.
 *   - nested-via targets (reached through an `@{}` carrier) are skipped.
 *
 * Pure: no DOM, no graph. Inputs are the flattened chain from
 * `collectFullChainModules` plus `computePairingsFull`'s per-row coverage.
 */
import { combineConstraintFactor, EXCLUDE, type AxisKinds } from "../manager/utils/constraint-math";
import {
  effectiveWeight,
  isEnabled,
  type InstanceLike,
  type WildcardOption,
} from "../components/context/editors/wildcard/probability";
import type { ChainModule, RowPairings } from "./constraint-pairs";

interface WildcardSide {
  payload: Record<string, unknown>;
  instance?: Record<string, unknown> | null;
}

type Option = WildcardOption & { value?: unknown };

interface ConstraintPayload {
  source_wildcard_id?: unknown;
  target_wildcard_id?: unknown;
  matrix?: unknown;
  exceptions?: unknown;
}

function optionsOf(payload: Record<string, unknown>): Option[] {
  const raw = payload.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({
      ...o,
      id: String(o.id ?? ""),
      sub_categories: Array.isArray(o.sub_categories)
        ? o.sub_categories.filter((t): t is string => typeof t === "string")
        : [],
    }) as Option);
}

/** `accepts` groups as group -> members (the payload's `tag_groups` filtered
 *  by `tag_group_kinds`), mirroring the engine's `_accepts_axes`. */
function acceptsAxes(payload: Record<string, unknown>): Record<string, string[]> {
  const kinds = (payload.tag_group_kinds ?? {}) as Record<string, unknown>;
  const groups = (payload.tag_groups ?? {}) as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [g, members] of Object.entries(groups)) {
    if (kinds[g] !== "accepts" || !Array.isArray(members)) continue;
    out[g] = members.filter((m): m is string => typeof m === "string");
  }
  return out;
}

function instanceOf(side: WildcardSide): InstanceLike {
  return (side.instance ?? {}) as InstanceLike;
}

/** Pinned and Match-variable instances skip constraint re-weighting on the
 *  target side (a pin) or take a fixed option, so they're handled apart. */
function pinnedOptionId(instance: Record<string, unknown> | null | undefined): string | null {
  if (!instance || instance.mode !== "pinned") return null;
  return typeof instance.pinned_option_id === "string" ? instance.pinned_option_id : null;
}

function matchesVariable(instance: Record<string, unknown> | null | undefined): boolean {
  return typeof instance?.match_variable === "string" && instance.match_variable.trim() !== "";
}

function displayValue(o: Option): string {
  if (o.is_null) return "(nothing)";
  const v = typeof o.value === "string" ? o.value.trim() : "";
  return v || o.id;
}

/**
 * Values of the source wildcard's options that, when picked, leave `target`
 * with no option of non-zero weight under `constraint`. Empty when the target
 * has a fallback, is pinned / matched to a variable, or already has nothing
 * live before the constraint (that's not this constraint's doing).
 */
export function deadEndSourceValues(
  constraint: ConstraintPayload,
  source: WildcardSide,
  target: WildcardSide,
): string[] {
  const tInst = instanceOf(target);
  if (pinnedOptionId(target.instance) || matchesVariable(target.instance)) return [];
  const tPool = optionsOf(target.payload).filter((o) => isEnabled(o, tInst));
  if (tPool.some((o) => o.fallback === true && !o.is_null)) return [];
  const tWeights = tPool.map((o) => Math.max(0, effectiveWeight(o, tInst)));
  if (!tWeights.some((w) => w > 0)) return [];

  const matrix = (constraint.matrix ?? {}) as Parameters<typeof combineConstraintFactor>[2];
  const exceptions = Array.isArray(constraint.exceptions)
    ? (constraint.exceptions as Array<Record<string, unknown>>)
    : [];
  const targetAxes = acceptsAxes(target.payload);
  const sourceAxes = acceptsAxes(source.payload);
  const axisKinds: AxisKinds = {};
  for (const g of Object.keys(sourceAxes)) axisKinds[g] = "accepts";

  const sInst = instanceOf(source);
  let sPool = optionsOf(source.payload).filter((o) => isEnabled(o, sInst));
  const pinned = pinnedOptionId(source.instance);
  if (pinned && !matchesVariable(source.instance)) {
    const only = optionsOf(source.payload).find((o) => o.id === pinned);
    sPool = only ? [only] : sPool;
  }

  const out: string[] = [];
  for (const s of sPool) {
    const tags = s.sub_categories ?? [];
    const axes: Record<string, string[]> = {};
    for (const [g, members] of Object.entries(sourceAxes)) {
      const mine = members.filter((m) => tags.includes(m));
      if (mine.length) axes[g] = mine;
    }
    const pick = { value: String(s.value ?? ""), tags, axes };
    const live = tPool.some((t, i) => {
      if (tWeights[i] <= 0) return false;
      const f = combineConstraintFactor(
        [pick],
        { value: String(t.value ?? ""), tags: t.sub_categories ?? [] },
        matrix,
        exceptions,
        axisKinds,
        targetAxes,
      );
      return f !== EXCLUDE && tWeights[i] * f > 0;
    });
    if (!live) out.push(displayValue(s));
  }
  return out;
}

export interface ConstraintDeadEnd {
  /** Source option values that empty the target (display form). */
  sourceValues: string[];
}

/**
 * Per constraint row (keyed by `rowKey`), the source values that can leave a
 * target instance it covers with nothing to pick. Only constraints with at
 * least one dead end appear. Coverage comes from `pairings` (SP3 reach): a
 * target row counts when one of its `contributors` is this constraint's badge.
 */
export function computeConstraintDeadEnds(
  chain: readonly ChainModule[],
  pairings: ReadonlyMap<string, RowPairings>,
): Map<string, ConstraintDeadEnd> {
  const out = new Map<string, ConstraintDeadEnd>();
  chain.forEach((c, i) => {
    if (c.type !== "constraint" || c.enabled === false) return;
    const p = c.payload as ConstraintPayload;
    const srcId = p.source_wildcard_id;
    const tgtId = p.target_wildcard_id;
    if (typeof srcId !== "string" || typeof tgtId !== "string") return;
    const direct = pairings.get(c.rowKey)?.direct;
    if (!direct || direct.isOrphan) return;

    let source: ChainModule | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const m = chain[j];
      if (m.type === "wildcard" && m.id === srcId && m.enabled !== false) { source = m; break; }
    }
    if (!source) return;

    const values = new Set<string>();
    for (let j = i + 1; j < chain.length; j++) {
      const t = chain[j];
      if (t.type !== "wildcard" || t.id !== tgtId || t.enabled === false) continue;
      const covered = (pairings.get(t.rowKey)?.contributors ?? [])
        .some((b) => b.targetUuid === tgtId && b.number === direct.number);
      if (!covered) continue;
      for (const v of deadEndSourceValues(p, source, t)) values.add(v);
    }
    if (values.size) out.set(c.rowKey, { sourceValues: [...values] });
  });
  return out;
}
