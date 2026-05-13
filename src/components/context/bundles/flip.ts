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
