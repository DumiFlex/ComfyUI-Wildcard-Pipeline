// Pure drag/drop helpers — no Vue, no DOM. Caller wires events.
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

/** Re-export the container-scoped DropZone from drop-zone.ts so legacy
 *  consumers that imported it from this module keep working. The flat
 *  `bundle-slot` / `bundle.zone` shapes that lived here previously
 *  were retired in the nested-drag redesign. */
export type { DropZone } from "./drop-zone";

// Group module indices by `bundle_origin`, update start/end on
// contiguous runs, dissolve on gaps. Nested bundles (parent_uid set)
// contribute their leaves' indices to BOTH their own range AND every
// ancestor's range — the outer's range envelopes everything inside,
// including inner-bundle leaves whose immediate bundle_origin points
// at the inner. Without this, an outer with a single inner-bundle
// child (no direct leaves of its own) would collapse to zero range
// and dissolve.
export function reconcileBundleRanges(
  modules: ModuleEntry[],
  bundles: BundleInstance[],
): BundleInstance[] {
  if (bundles.length === 0) return bundles;

  // 1. Immediate leaves per bundle (matches the row's bundle_origin).
  const immediate = new Map<string, number[]>();
  modules.forEach((m, idx) => {
    const origin = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
    if (!origin) return;
    const arr = immediate.get(origin) ?? [];
    arr.push(idx);
    immediate.set(origin, arr);
  });

  // 2. Walk parent chain from each bundle up, accumulating descendant
  //    indices into every ancestor. Tier-2 cap → at most 1 hop; the
  //    defensive depth limit (8) absorbs corrupt cycles.
  const byBundle = new Map<string, number[]>();
  for (const b of bundles) {
    const own = immediate.get(b._uid) ?? [];
    if (own.length > 0) {
      const arr = byBundle.get(b._uid) ?? [];
      arr.push(...own);
      byBundle.set(b._uid, arr);
    }
  }
  // Build a parent lookup keyed by _uid → parent_uid.
  const parentOf = new Map<string, string | null>();
  for (const b of bundles) {
    parentOf.set(b._uid, typeof b.parent_uid === "string" ? b.parent_uid : null);
  }
  // For each bundle that owns immediate leaves, propagate those indices
  // upward through parent_uid.
  for (const [bundleUid, idxs] of immediate.entries()) {
    let cur = parentOf.get(bundleUid) ?? null;
    let depth = 0;
    const seen = new Set<string>([bundleUid]);
    while (cur && !seen.has(cur) && depth < 8) {
      seen.add(cur);
      const arr = byBundle.get(cur) ?? [];
      arr.push(...idxs);
      byBundle.set(cur, arr);
      cur = parentOf.get(cur) ?? null;
      depth++;
    }
  }

  const next: BundleInstance[] = [];
  for (const b of bundles) {
    const indices = byBundle.get(b._uid);
    if (!indices || indices.length === 0) continue;
    const sorted = [...indices].sort((a, b) => a - b);
    const contiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (!contiguous) {
      // Only strip bundle_origin on this bundle's IMMEDIATE leaves —
      // descendant-contributed indices belong to other bundles and
      // their bundle_origin must stay intact.
      for (const idx of immediate.get(b._uid) ?? []) {
        const m = modules[idx] as ModuleEntry & { bundle_origin?: string };
        delete m.bundle_origin;
      }
      continue;
    }
    next.push({ ...b, start_idx: sorted[0], end_idx: sorted[sorted.length - 1] });
  }
  return next;
}
