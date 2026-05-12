// Pure drag/drop helpers — no Vue, no DOM. Caller wires events.
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

export type DropZone =
  | { kind: "row"; idx: number; pos: "before" | "after" }
  | { kind: "bundle"; uid: string; zone: "before" | "inside" | "after" }
  /** Slot between two specific bundle children. `targetIdx` is the row
   *  the bar anchors to in `value.modules[]`; `before` picks above/below
   *  that row. `crossing` true → the drag came from outside this bundle,
   *  paint the frame highlight alongside the gap line. */
  | { kind: "bundle-slot"; uid: string; targetIdx: number; before: boolean; crossing: boolean }
  | { kind: "end" }
  | null;

// Group module indices by `bundle_origin`, update start/end on
// contiguous runs, dissolve on gaps.
export function reconcileBundleRanges(
  modules: ModuleEntry[],
  bundles: BundleInstance[],
): BundleInstance[] {
  if (bundles.length === 0) return bundles;
  const byOrigin = new Map<string, number[]>();
  modules.forEach((m, idx) => {
    const origin = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
    if (!origin) return;
    const arr = byOrigin.get(origin) ?? [];
    arr.push(idx);
    byOrigin.set(origin, arr);
  });
  const next: BundleInstance[] = [];
  for (const b of bundles) {
    const indices = byOrigin.get(b._uid);
    if (!indices || indices.length === 0) continue;
    const sorted = [...indices].sort((a, b) => a - b);
    const contiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (!contiguous) {
      for (const idx of sorted) {
        const m = modules[idx] as ModuleEntry & { bundle_origin?: string };
        delete m.bundle_origin;
      }
      continue;
    }
    next.push({ ...b, start_idx: sorted[0], end_idx: sorted[sorted.length - 1] });
  }
  return next;
}
