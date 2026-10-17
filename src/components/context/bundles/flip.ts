/**
 * Re-export shim. The original FLIP helper lived here back when only
 * the Context module list used it. Now also consumed by InjectorRow
 * and (future) other row UIs — the real module moved to
 * `src/components/shared/flip.ts`. This file kept as a thin
 * passthrough so existing ContextWidget imports don't break.
 *
 * New code should import directly from
 * `src/components/shared/flip.ts`.
 */
export {
  MOTION_COLLAPSE_MS,
  MOTION_FLIP_MS,
  MOTION_FADE_MS,
  MOTION_PULSE_MS,
  MOTION_STAGGER_MS,
  MOTION_CURVE_FLIP,
  shouldAnimate,
  captureRects,
  applyFlip,
  withEnterAnimation,
  animateEnterBatch,
  flashRows,
  withLeaveAnimation,
  type AnimationClasses,
} from "../../shared/flip";

import { applyFlip, captureRects, MOTION_CURVE_FLIP, MOTION_FLIP_MS } from "../../shared/flip";

/**
 * FLIP rects captured at every list-level container in a ContextWidget.
 * Feed it back into `playFlipSnapshot` after Vue commits the mutated
 * value and re-renders.
 *
 * Two scope levels are captured non-overlappingly:
 *   - `.wp-modules` direct children: bundles + standalone modules
 *   - each `.wp-bundle-children` direct children: in-bundle modules
 *
 * Capturing both lets us animate top-level reorders AND in-bundle
 * reorders cleanly. A bundle moving as a unit only FLIPs at the top
 * level; its children get the transform via inheritance and skip the
 * inner pass (their rects don't change relative to the bundle).
 */
export type FlipSnapshot = { scope: HTMLElement; before: Map<string, DOMRect> }[];

/** `frame` is the widget's `.wp-modules-frame` (null before mount → empty). */
export function captureFlipSnapshot(frame: HTMLElement | null): FlipSnapshot {
  if (!frame) return [];
  const snapshot: FlipSnapshot = [];
  const top = frame.querySelector<HTMLElement>(".wp-modules");
  if (top) snapshot.push({ scope: top, before: captureRects(top, el => el.dataset.uid ?? null) });
  for (const inner of Array.from(frame.querySelectorAll<HTMLElement>(".wp-bundle-children"))) {
    snapshot.push({ scope: inner, before: captureRects(inner, el => el.dataset.uid ?? null) });
  }
  return snapshot;
}

/**
 * Drops a uid from every scope's pre-mutation rect map so playFlipSnapshot
 * leaves that element alone. Used when the row should animate via a
 * different mechanism (e.g. --arriving fade-slide for cross-scope moves)
 * — without this, the FLIP inline transform would override the class-
 * driven transition.
 */
export function excludeFromFlipSnapshot(snapshot: FlipSnapshot, uid: string): void {
  for (const entry of snapshot) entry.before.delete(uid);
}

export function playFlipSnapshot(snapshot: FlipSnapshot): void {
  for (const { scope, before } of snapshot) {
    applyFlip(scope, before, el => el.dataset.uid ?? null, {
      duration: MOTION_FLIP_MS,
      ease: MOTION_CURVE_FLIP,
    });
  }
}
