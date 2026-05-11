/**
 * Groups a flat `modules[]` list + `bundles[]` metadata into a
 * sequence of render groups for ContextWidget:
 *   { type: "module", entry, idx }                   — standalone module
 *   { type: "bundle", instance, children: [...] }    — bundle wrapper
 *
 * Children inside a bundle group keep their absolute `idx` over the
 * original `modules[]` so click handlers + drag-and-drop still target
 * the right row.
 *
 * Bundles with invalid or out-of-bounds ranges are silently skipped.
 * Frontend should dissolve the frame on next interaction; until then
 * the rows render as plain top-level modules (no frame, no chrome).
 *
 * Bundles are NOT allowed to overlap — if two BundleInstances claim
 * overlapping ranges, the second one is skipped. Range integrity is
 * the ContextWidget's responsibility on drag-in/drag-out.
 */
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

export interface ModuleGroup {
  type: "module";
  entry: ModuleEntry;
  idx: number;
}

export interface BundleChild {
  entry: ModuleEntry;
  idx: number;
}

export interface BundleGroup {
  type: "bundle";
  instance: BundleInstance;
  children: BundleChild[];
}

export type RenderGroup = ModuleGroup | BundleGroup;

function isValidRange(b: BundleInstance, total: number): boolean {
  return (
    b.start_idx >= 0 &&
    b.end_idx >= b.start_idx &&
    b.end_idx < total
  );
}

export function groupModulesAndBundles(
  modules: ModuleEntry[],
  bundles: BundleInstance[],
): RenderGroup[] {
  // Filter + sort bundles by start_idx so we can walk modules linearly.
  // Skip ranges that overlap an already-claimed window.
  const valid = bundles
    .filter((b) => isValidRange(b, modules.length))
    .sort((a, b) => a.start_idx - b.start_idx);
  const claimed: boolean[] = new Array(modules.length).fill(false);
  const usableBundles: BundleInstance[] = [];
  for (const b of valid) {
    let overlap = false;
    for (let i = b.start_idx; i <= b.end_idx; i++) {
      if (claimed[i]) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    for (let i = b.start_idx; i <= b.end_idx; i++) {
      claimed[i] = true;
    }
    usableBundles.push(b);
  }

  // Index bundles by start_idx for O(1) lookup during the walk.
  const byStart = new Map<number, BundleInstance>();
  for (const b of usableBundles) byStart.set(b.start_idx, b);

  const groups: RenderGroup[] = [];
  let i = 0;
  while (i < modules.length) {
    const b = byStart.get(i);
    if (b) {
      const children: BundleChild[] = [];
      for (let j = b.start_idx; j <= b.end_idx; j++) {
        children.push({ entry: modules[j], idx: j });
      }
      groups.push({ type: "bundle", instance: b, children });
      i = b.end_idx + 1;
    } else {
      groups.push({ type: "module", entry: modules[i], idx: i });
      i++;
    }
  }
  return groups;
}
