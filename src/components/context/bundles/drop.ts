/**
 * Pure drop applier for the container-scoped drag system.
 *
 * Given a resolved DropZone + a drag payload + the current widget
 * value, produce the next widget value with:
 *   - modules[] reordered (and bundle_origin rewritten for module drops)
 *   - bundles[] reconciled (start/end indices refreshed, parent_uid
 *     rewritten for bundle drops)
 *
 * No Vue, no DOM, no side effects. The caller commits the result via
 * ContextWidget's existing commitModules path.
 *
 * The applier collapses what the old onDrop did across 200+ lines of
 * patched branches into a single switch over the resolved zone. The
 * resolver already pre-clamped tier-2 cap violations, so the applier
 * doesn't need to worry about them.
 */

import type {
  BundleInstance,
  ContextWidgetValue,
  ModuleEntry,
} from "../../../widgets/_shared";
import { reconcileBundleRanges } from "./drag";
import type { DropZone } from "./drop-zone";

/**
 * Drop payload — the dragged thing's identity + source position. Built
 * from `DragPayload` at the call site (ContextWidget). Kept narrow so
 * the applier doesn't depend on the full drag-store type.
 */
export type DropPayload =
  | { kind: "module"; sourceIdx: number; sourceUid: string }
  | { kind: "bundle"; bundleUid: string; sourceStartIdx: number; sourceEndIdx: number };

/** Applies the drop to the current widget value. Returns a NEW value;
 *  the caller commits it. Null zone → no-op. */
export function applyDrop(
  zone: DropZone,
  drag: DropPayload,
  value: ContextWidgetValue,
): ContextWidgetValue {
  if (!zone) return value;
  if (drag.kind === "module") return applyModuleDrop(zone, drag, value);
  return applyBundleDrop(zone, drag, value);
}

// ─────────────────────────────────────────────────────────────────────
// Module drop

function applyModuleDrop(
  zone: NonNullable<DropZone>,
  drag: Extract<DropPayload, { kind: "module" }>,
  value: ContextWidgetValue,
): ContextWidgetValue {
  const bundles = [...(value.bundles ?? [])];
  const insertIdx = computeInsertIdx(zone, drag.sourceIdx, /*rangeSize=*/ 1, value.modules, bundles);
  const modules = [...value.modules];
  const [row] = modules.splice(drag.sourceIdx, 1);
  const finalIdx = clampForRemoval(insertIdx, drag.sourceIdx, 1);

  const containerUid = resolveModuleBundleOrigin(zone, bundles);
  const updated = { ...row } as ModuleEntry & { bundle_origin?: string };
  if (containerUid !== null) updated.bundle_origin = containerUid;
  else delete updated.bundle_origin;
  modules.splice(finalIdx, 0, updated);

  const reconciled = reconcileBundleRanges(modules, bundles);
  return { ...value, modules, bundles: reconciled };
}

// ─────────────────────────────────────────────────────────────────────
// Bundle drop

function applyBundleDrop(
  zone: NonNullable<DropZone>,
  drag: Extract<DropPayload, { kind: "bundle" }>,
  value: ContextWidgetValue,
): ContextWidgetValue {
  const bundles = [...(value.bundles ?? [])];
  const rangeSize = drag.sourceEndIdx - drag.sourceStartIdx + 1;
  // Self-drop guard: zone resolver returns null for self-hover, but the
  // header.before/after case can still land on the dragged bundle's
  // own header. Treat as no-op so the user can't drop a bundle on
  // itself and corrupt the range.
  if (zone.kind === "header" && zone.uid === drag.bundleUid) {
    return value;
  }
  const insertIdx = computeInsertIdx(zone, drag.sourceStartIdx, rangeSize, value.modules, bundles);

  const modules = [...value.modules];
  const range = modules.splice(drag.sourceStartIdx, rangeSize);
  const finalIdx = clampForRemoval(insertIdx, drag.sourceStartIdx, rangeSize);
  modules.splice(finalIdx, 0, ...range);

  const nextParentUid = resolveBundleParentUid(zone, bundles);
  const nextBundles = bundles.map((b) =>
    b._uid === drag.bundleUid ? { ...b, parent_uid: nextParentUid } : b,
  );

  const reconciled = reconcileBundleRanges(modules, nextBundles);
  return { ...value, modules, bundles: reconciled };
}

// ─────────────────────────────────────────────────────────────────────
// Position resolvers

/** Maps a zone (with indices into the PRE-splice modules list) to an
 *  insertion index in the ORIGINAL list. The caller clamps for the
 *  post-splice list via `clampForRemoval`. */
function computeInsertIdx(
  zone: NonNullable<DropZone>,
  _sourceStartIdx: number,
  _rangeSize: number,
  modules: ModuleEntry[],
  bundles: BundleInstance[],
): number {
  switch (zone.kind) {
    case "end":
      return modules.length;
    case "row":
      return zone.pos === "before" ? zone.insertIdx : zone.insertIdx + 1;
    case "empty": {
      // Empty body — drop becomes the first child of this bundle. The
      // bundle's start_idx tells us where to insert; if the bundle had
      // a sentinel range (end<start), use start_idx anyway since
      // reconcile will sort indices out post-drop.
      const target = bundles.find((b) => b._uid === zone.uid);
      if (!target) return modules.length;
      return Math.max(0, Math.min(modules.length, target.start_idx));
    }
    case "header": {
      const target = bundles.find((b) => b._uid === zone.uid);
      if (!target) return modules.length;
      return zone.pos === "before" ? target.start_idx : target.end_idx + 1;
    }
  }
}

/** Clamps a pre-splice insertion index to the post-splice list. Indices
 *  past the removed range shift left by rangeSize; indices inside the
 *  removed range collapse to its start. */
function clampForRemoval(insertIdx: number, sourceStartIdx: number, rangeSize: number): number {
  const sourceEnd = sourceStartIdx + rangeSize - 1;
  if (insertIdx > sourceEnd) return insertIdx - rangeSize;
  if (insertIdx >= sourceStartIdx) return sourceStartIdx;
  return insertIdx;
}

/** Bundle origin for a module drop. */
function resolveModuleBundleOrigin(
  zone: NonNullable<DropZone>,
  bundles: BundleInstance[],
): string | null {
  switch (zone.kind) {
    case "end":
      return null;
    case "row":
      return zone.containerUid;
    case "empty":
      return zone.uid;
    case "header": {
      const target = bundles.find((b) => b._uid === zone.uid);
      // Sibling drop: dropped row sits in the target's parent scope.
      return target?.parent_uid ?? null;
    }
  }
}

/** parent_uid for a bundle drop. */
function resolveBundleParentUid(
  zone: NonNullable<DropZone>,
  bundles: BundleInstance[],
): string | null {
  switch (zone.kind) {
    case "end":
      return null;
    case "row":
      return zone.containerUid;
    case "empty":
      return zone.uid;
    case "header": {
      const target = bundles.find((b) => b._uid === zone.uid);
      return target?.parent_uid ?? null;
    }
  }
}
