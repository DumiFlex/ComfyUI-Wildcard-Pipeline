/**
 * Compute pairing badges for the constraint + target-instance UI.
 *
 * Each constraint is paired with the downstream target wildcard
 * instance it will claim at runtime (per the 2026-05-24 first-instance
 * one-shot semantic). The returned map keys are row uids (NOT module
 * ids — duplicate library instances share a module id but each row has
 * its own `_uid`) and the values are
 * `{ number, targetUuid, colorIndex, isOrphan }`:
 *
 *   - Constraint module row → badge of its claimed target instance, OR
 *     an orphan badge (`isOrphan: true`) if no downstream instance is
 *     available — the user still sees the slot it would have occupied
 *     in the sequence so the chain semantic stays visible.
 *   - Target instance module row → matching badge from the constraint
 *     that claimed it.
 *   - Targets WITHOUT a paired constraint never get a badge.
 *
 * The `colorIndex` (1..8) is hashed from the target uuid via the same
 * djb2 used for nested-ref token coloring (`varColorIndex` in
 * `components/shared/var-color.ts`). Distinct target wildcards get
 * distinct colors so two co-existing pair sets (e.g. mood pairs vs
 * style pairs) read at a glance without their numbers colliding.
 *
 * Pure data — no Vue / DOM imports. Pairs are assigned in chain order,
 * one [1], [2], … sequence per target uuid. The walker that produces
 * the input `modules` array is responsible for splicing in upstream +
 * downstream WP_Context modules so pairings work cross-node.
 *
 * See `docs/superpowers/specs/2026-05-24-constraint-first-instance-design.md`.
 */

import { varColorIndex } from "../components/shared/var-color";

export interface ChainModule {
  /** Module id — uuid that constraint.target_wildcard_id matches against. */
  id: string;
  /** Row-unique key — survives library-deduped chains where two rows
   *  share the same module id. Used as the pairings Map key. Falls back
   *  to `id` when the caller can't supply a per-row uid (tests, etc). */
  rowKey: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface PairingBadge {
  number: number;
  targetUuid: string;
  colorIndex: number;
  /** Constraint slot whose downstream target instance is missing.
   *  Renders with a `?` indicator on the constraint row; no badge gets
   *  attached to any target row (because there isn't one). */
  isOrphan: boolean;
}

export function computePairings(modules: ChainModule[]): Map<string, PairingBadge> {
  const out = new Map<string, PairingBadge>();

  // Group constraints by target uuid. Within each group the badge
  // numbering is its own [1], [2], … sequence — distinct target
  // wildcards don't share a sequence.
  const constraintsByTarget = new Map<string, ChainModule[]>();
  for (const m of modules) {
    if (m.type !== "constraint") continue;
    const t = (m.payload as { target_wildcard_id?: string }).target_wildcard_id;
    if (!t) continue;
    const existing = constraintsByTarget.get(t);
    if (existing) existing.push(m);
    else constraintsByTarget.set(t, [m]);
  }

  for (const [targetUuid, cns] of constraintsByTarget) {
    // Each constraint claims the next unclaimed downstream target
    // slot. Slots = top-level chain modules at index > constraint's
    // index whose id matches the target uuid. Solo cases (1 constraint
    // + 1 target) also get badges so the user sees the pairing
    // sequence — clarity beats minimalism here.
    const claimedRowKeys = new Set<string>();
    let badgeNumber = 0;
    const colorIndex = varColorIndex(targetUuid);
    for (const cn of cns) {
      const cnIdx = modules.findIndex((m) => m.rowKey === cn.rowKey);
      if (cnIdx < 0) continue;
      let claimedTarget: ChainModule | null = null;
      for (let j = cnIdx + 1; j < modules.length; j++) {
        const d = modules[j];
        if (d.type !== "wildcard") continue;
        if (d.id !== targetUuid) continue;
        if (claimedRowKeys.has(d.rowKey)) continue;
        claimedTarget = d;
        break;
      }
      badgeNumber++;
      if (claimedTarget === null) {
        // Orphan — no downstream instance available. Constraint still
        // gets a slot in the sequence so the user sees both pairs even
        // when one is broken.
        out.set(cn.rowKey, { number: badgeNumber, targetUuid, colorIndex, isOrphan: true });
        continue;
      }
      claimedRowKeys.add(claimedTarget.rowKey);
      out.set(cn.rowKey, { number: badgeNumber, targetUuid, colorIndex, isOrphan: false });
      out.set(claimedTarget.rowKey, { number: badgeNumber, targetUuid, colorIndex, isOrphan: false });
    }
  }
  return out;
}
