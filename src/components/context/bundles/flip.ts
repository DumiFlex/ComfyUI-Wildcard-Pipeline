/**
 * Manual FLIP-move helper + reduce-motion gate.
 *
 * Used by ContextWidget's drop / picker-add / trash-remove paths to
 * animate row reordering, plus cross-container fade-slide and bundle
 * collapse/expand. Pure functions — no Vue imports, unit-testable.
 *
 * Reduce-motion contract: every helper checks `shouldAnimate()` which
 * returns false when `.wp-a11y-no-motion` is on `document.body`. CSS
 * transitions/animations are handled by a separate blanket rule in
 * src/components/shared/a11y.css; this module handles the JS side.
 *
 * Motion constants mirror the CSS tokens in
 * src/components/shared/theme.css (--wp-motion-*). Keep these in sync.
 */

export const MOTION_COLLAPSE_MS = 240;
export const MOTION_FLIP_MS = 280;
export const MOTION_FADE_MS = 180;
export const MOTION_PULSE_MS = 420;
export const MOTION_STAGGER_MS = 60;
export const MOTION_CURVE_FLIP = "cubic-bezier(0.22, 1, 0.36, 1)";

type FlipOptions = { duration?: number; ease?: string };

/** Whether motion should animate. False when user has reduce-motion ON. */
export function shouldAnimate(): boolean {
  return !document.body.classList.contains("wp-a11y-no-motion");
}

/** Capture each child's bounding rect, keyed by the caller's key function. */
export function captureRects(
  container: HTMLElement,
  key: (el: HTMLElement) => string | null,
): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>();
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    const k = key(el);
    if (k != null) out.set(k, el.getBoundingClientRect());
  }
  return out;
}

/**
 * After a DOM mutation, apply inverse-transform to children whose
 * position changed, then transition back to identity. Skip silently
 * when reduce-motion is on.
 */
export function applyFlip(
  container: HTMLElement,
  before: Map<string, DOMRect>,
  key: (el: HTMLElement) => string | null,
  opt: FlipOptions = {},
): void {
  if (!shouldAnimate()) return;
  const dur = opt.duration ?? MOTION_FLIP_MS;
  const ease = opt.ease ?? MOTION_CURVE_FLIP;
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    const k = key(el);
    if (k == null) continue;
    const beforeRect = before.get(k);
    if (!beforeRect) continue;
    const afterRect = el.getBoundingClientRect();
    const dx = beforeRect.left - afterRect.left;
    const dy = beforeRect.top - afterRect.top;
    if (dx === 0 && dy === 0) continue;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${dur}ms ${ease}`;
      el.style.transform = "translate(0, 0)";
    });
  }
}
