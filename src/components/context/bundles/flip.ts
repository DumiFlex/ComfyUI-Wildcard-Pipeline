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

export const MOTION_COLLAPSE_MS = 450;
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

/**
 * Mutate state then animate the newly-inserted element (matched by uid)
 * with --arriving → --arrived class transition. The arriving class is
 * applied after the mutation + a microtask so the browser registers
 * the "from" state; arrived flips the next frame so the transition fires.
 * No-op (mutate-only) when reduce-motion is on.
 */
export async function withEnterAnimation(
  uid: string,
  container: HTMLElement,
  mutate: () => void,
): Promise<void> {
  mutate();
  if (!shouldAnimate()) return;
  // Wait one rAF so Vue commits the mutation to DOM before we query.
  // A bare `await Promise.resolve()` schedules a microtask that can
  // race Vue's own microtask-based reactivity scheduler — rAF runs
  // after the microtask queue drains and before paint.
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  const el = container.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
  if (!el) return;
  el.classList.add("wp-module--arriving");
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  el.classList.add("wp-module--arrived");
  const cleanup = (): void => {
    el.classList.remove("wp-module--arriving", "wp-module--arrived");
    el.removeEventListener("transitionend", cleanup);
  };
  el.addEventListener("transitionend", cleanup, { once: true });
}

/**
 * Animate a batch of newly-inserted elements (matched by uid array)
 * with --arriving → --arrived class lifecycle. Caller has already
 * mutated state and is responsible for waiting nextTick if needed —
 * this helper waits one rAF before applying classes so Vue's commit
 * has landed.
 *
 * Two-pass design: apply all --arriving classes first (so every row
 * is at the from-state simultaneously), then apply all --arrived
 * classes on the next frame (so they all transition together). Avoids
 * a staircase effect where rows animate sequentially.
 *
 * No-op when reduce-motion is on.
 */
export async function animateEnterBatch(
  uids: readonly (string | null | undefined)[],
  container: HTMLElement,
): Promise<void> {
  if (!shouldAnimate()) return;
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  const elements: HTMLElement[] = [];
  for (const uid of uids) {
    if (!uid) continue;
    const el = container.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
    if (el) elements.push(el);
  }
  if (elements.length === 0) return;
  for (const el of elements) el.classList.add("wp-module--arriving");
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  for (const el of elements) {
    el.classList.add("wp-module--arrived");
    const cleanup = (): void => {
      el.classList.remove("wp-module--arriving", "wp-module--arrived");
      el.removeEventListener("transitionend", cleanup);
    };
    el.addEventListener("transitionend", cleanup, { once: true });
  }
}

/**
 * Flash a batch of rows with the existing wp-module--flash green ring
 * keyframe (1500ms) — used to indicate library-side mutations (refresh,
 * reset, fork). Staggered so bulk refresh cascades. No-op when reduce-
 * motion is on.
 */
const FLASH_DURATION_MS = MOTION_PULSE_MS;  // 420ms — matches drop pulse timing
export async function flashRows(
  uids: readonly (string | null | undefined)[],
  container: HTMLElement,
  staggerMs: number = MOTION_STAGGER_MS,
): Promise<void> {
  if (!shouldAnimate()) return;
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  for (let i = 0; i < uids.length; i++) {
    const uid = uids[i];
    if (!uid) continue;
    const el = container.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
    if (!el) continue;
    const delay = i * staggerMs;
    setTimeout(() => {
      el.classList.add("wp-module--flash");
      setTimeout(() => el.classList.remove("wp-module--flash"), FLASH_DURATION_MS);
    }, delay);
  }
}

/**
 * Animate an element (matched by uid) with --leaving class, wait for the
 * fade to complete, then run mutate to remove from state. Mutate is
 * called immediately when reduce-motion is on (no class added).
 */
export async function withLeaveAnimation(
  uid: string,
  container: HTMLElement,
  mutate: () => void,
): Promise<void> {
  if (!shouldAnimate()) {
    mutate();
    return;
  }
  const el = container.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
  if (el) el.classList.add("wp-module--leaving");
  await new Promise<void>(r => setTimeout(r, MOTION_FADE_MS));
  mutate();
}
