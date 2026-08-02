/**
 * The behaviour every capped, user-resizable text field in this project needs.
 *
 * Three components had grown their own copy of it — `RichTextInput`'s two
 * hosts, the fixed-values `ValueRow`, the combine template — and the copies had
 * already diverged: only one clears the resize grip, only one follows the grip
 * off-screen, and the auto-grow in `ValueRow` silently fought the drag handle.
 * One implementation, three fixes, no third copy.
 *
 * What it provides:
 *
 *   1. **Auto-grow that yields to the user.** The field sizes itself to its
 *      content until the user drags the handle; from then on their height is
 *      authoritative. Previously `height = scrollHeight` ran on every input and
 *      external value change, so a manually collapsed box snapped straight back
 *      open — which reads as "the drag sticks, then starts working".
 *
 *   2. **A "more below" flag.** A capped box looks identical whether it holds
 *      its whole value or a third of it.
 *
 *   3. **Grip-follow.** Dragging a field taller than the space beneath it moves
 *      the box, not the pointer, so the handle being held slides off-screen and
 *      the drag goes blind. Scrolling by exactly the overshoot pins the bottom
 *      edge to the viewport, keeping the grip under the cursor.
 *
 * DOM-only and framework-light: takes an element getter, returns plain
 * functions plus one ref. Callers own their own `onMounted` / `watch`.
 */
import { onBeforeUnmount, ref, type Ref } from "vue";

export interface GrowableField {
  /** True while content extends past the visible bottom edge. */
  hasMoreBelow: Ref<boolean>;
  /** Re-measure the overflow flag. Cheap; call on scroll and input. */
  updateOverflowHint: () => void;
  /** Same, deferred a frame — use at mount, before layout has settled. */
  scheduleOverflowHint: () => void;
  /** Resize to fit content, UNLESS the user has taken manual control. */
  autosize: () => void;
  /** Begin observing: wires the resize observer for the hint + grip-follow. */
  attach: () => void;
  /** True once the user has dragged the handle. */
  userResized: Ref<boolean>;
}

/** Nearest ancestor that actually scrolls, or null when only the page does.
 *  Walks computed `overflow-y` rather than trusting a class name — these
 *  fields live in modals, pages and canvas widgets, each of which puts its
 *  scroller somewhere different. */
function scrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export function useGrowableField(
  getEl: () => HTMLElement | null,
  opts: { minHeight?: number } = {},
): GrowableField {
  const hasMoreBelow = ref(false);
  const userResized = ref(false);

  function updateOverflowHint(): void {
    const el = getEl();
    if (!el) return;
    // 2px slack absorbs sub-pixel rounding at the exact bottom.
    hasMoreBelow.value = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
  }

  function scheduleOverflowHint(): void {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(updateOverflowHint);
    else updateOverflowHint();
  }

  function autosize(): void {
    const el = getEl();
    // The user's drag wins from the moment it happens. Re-running the fit
    // after that is what made a collapsed box spring open again.
    if (!el || userResized.value) return;
    autoDriven = true;
    el.style.height = "auto";
    const next = Math.max(opts.minHeight ?? 0, el.scrollHeight);
    el.style.height = `${next}px`;
    lastHeight = next;
    // Release on the next frame: the observer fires asynchronously, and
    // clearing synchronously would let our own write look like a user drag.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => { autoDriven = false; });
    } else {
      autoDriven = false;
    }
  }

  /** Keep the grip under the cursor while the box grows past the fold.
   *  Only ever scrolls DOWN, and only while the bottom is genuinely
   *  off-screen — shrinking must not yank the view around.
   *
   *  Deliberately not `scrollIntoView`, which this project bans for scrolling
   *  every ancestor rather than the one the user is working in. */
  function followGrip(): void {
    const el = getEl();
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const container = scrollableAncestor(el);
    if (container) {
      const cRect = container.getBoundingClientRect();
      const overshoot = rect.bottom - (cRect.bottom - margin);
      if (overshoot > 0) container.scrollTop += overshoot;
      return;
    }
    const overshoot = rect.bottom - (window.innerHeight - margin);
    if (overshoot > 0) window.scrollBy(0, overshoot);
  }

  let obs: ResizeObserver | null = null;
  let lastHeight = 0;
  /** Set while `autosize` is writing, so its own change is not mistaken for a
   *  drag. Without it the first auto-fit would lock the field immediately. */
  let autoDriven = false;

  function attach(): void {
    const el = getEl();
    if (!el) return;
    lastHeight = el.getBoundingClientRect().height;
    if (typeof ResizeObserver === "undefined") return;
    obs = new ResizeObserver(() => {
      const cur = getEl();
      if (!cur) return;
      const h = cur.getBoundingClientRect().height;
      updateOverflowHint();
      // A height change we did not author is the user on the drag handle.
      if (!autoDriven && Math.abs(h - lastHeight) > 1) userResized.value = true;
      if (h > lastHeight) followGrip();
      lastHeight = h;
    });
    obs.observe(el);
  }

  onBeforeUnmount(() => {
    obs?.disconnect();
    obs = null;
  });

  return {
    hasMoreBelow,
    updateOverflowHint,
    scheduleOverflowHint,
    autosize,
    attach,
    userResized,
  };
}
