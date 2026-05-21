/**
 * Pure drop applier for the unified slot-zone drag system.
 *
 * Given a resolved DropZone (slot kind) + a drag payload + the current
 * widget value, produce the next widget value with:
 *   - modules[] reordered (and bundle_origin rewritten for module drops)
 *   - bundles[] reconciled (start/end indices refreshed; parent_uid
 *     rewritten for bundle drops)
 *
 * No Vue, no DOM, no side effects. The caller commits the result via
 * ContextWidget's existing commitModules path.
 *
 * Self-drop is handled here: if the resolved slot lands inside the
 * dragged bundle's own current range AND in the same parent scope,
 * the applier returns the input unchanged so the move is a no-op.
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
 * from `DragPayload` at the call site (ContextWidget).
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
  const modules = [...value.modules];
  const [row] = modules.splice(drag.sourceIdx, 1);
  // Pre-splice idx → post-splice idx: anything past sourceIdx shifts
  // left by one.
  let insertIdx = zone.insertIdx;
  if (insertIdx > drag.sourceIdx) insertIdx -= 1;

  const updated = { ...row } as ModuleEntry & { bundle_origin?: string };
  if (zone.containerUid !== null) updated.bundle_origin = zone.containerUid;
  else delete updated.bundle_origin;
  modules.splice(insertIdx, 0, updated);

  const reconciled = reconcileBundleRanges(modules, [...(value.bundles ?? [])]);
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

  // Self-drop guard: slot lands inside the dragged bundle's own
  // current range AND in its current parent scope → no-op. This covers
  // the "hovering near self" case where the indicator follows the
  // pointer back to the bundle's current position.
  const dragBundle = bundles.find((b) => b._uid === drag.bundleUid);
  if (dragBundle) {
    const currentParent = dragBundle.parent_uid ?? null;
    if (
      (zone.containerUid ?? null) === currentParent &&
      zone.insertIdx >= drag.sourceStartIdx &&
      zone.insertIdx <= drag.sourceEndIdx + 1
    ) {
      return value;
    }
  }

  const modules = [...value.modules];
  const range = modules.splice(drag.sourceStartIdx, rangeSize);
  // Pre-splice → post-splice clamp: indices past the removed range
  // shift left by rangeSize; indices inside the range collapse to its
  // start.
  let insertIdx = zone.insertIdx;
  if (insertIdx > drag.sourceEndIdx) insertIdx -= rangeSize;
  else if (insertIdx > drag.sourceStartIdx) insertIdx = drag.sourceStartIdx;
  modules.splice(insertIdx, 0, ...range);

  const nextBundles = bundles.map((b) =>
    b._uid === drag.bundleUid ? { ...b, parent_uid: zone.containerUid } : b,
  );
  const reconciled = reconcileBundleRanges(modules, nextBundles);
  return { ...value, modules, bundles: reconciled };
}

// Type re-exports kept narrow for legacy import sites.
export type { BundleInstance, ContextWidgetValue, ModuleEntry };
