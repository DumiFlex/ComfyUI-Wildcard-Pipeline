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
  /** Bind to a grip element's `pointerdown`. Replaces `resize: vertical`,
   *  which cannot be clamped from outside — see `startResize`. */
  startResize: (ev: PointerEvent) => void;
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

/** Backstop floor for a field whose CSS declares no `min-height`. Enough to
 *  keep one line and its padding visible, so a drag can always be undone. */
const ABSOLUTE_MIN = 28;

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
  /** True between pointerdown on the field and the matching pointerup —
   *  i.e. while the user may be holding the resize handle. */
  let dragging = false;
  let pending = false;
  /** Set once the height cap has been dropped for a manual drag. */
  let capLifted = false;
  /** Pointer Y at the previous move — the drag is incremental, so only the
   *  step between moves matters, never a captured origin. */
  let lastPointerY = 0;
  /** Floor read from CSS at drag start; CSS stays the source of truth. */
  let minPx = 0;

  /**
   * Everything the observer wants to do, moved OUT of the observer.
   *
   * A ResizeObserver callback that reads layout and writes reactive state runs
   * before paint, so doing it synchronously on every frame of a resize drag
   * dirties layout inside the very callback the browser is using to report
   * layout. Chrome throttles that (the "ResizeObserver loop" case) and stops
   * delivering for a frame, which the user feels as the drag seizing up until
   * they release and re-grab. Deferring to rAF leaves the callback trivial.
   */
  function flush(): void {
    pending = false;
    const el = getEl();
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    updateOverflowHint();
    // A height change we did not author is the user on the drag handle.
    if (!autoDriven && Math.abs(h - lastHeight) > 1) userResized.value = true;
    // Follows LIVE, including mid-drag. Scrolling by the overshoot moves the
    // element up by exactly that much, landing its bottom edge at the viewport
    // edge — which is where the pointer already is, so the grip stays under the
    // cursor. Deferring this to pointerup (an earlier attempt at the stall,
    // which turned out to be the height cap) just made the field vanish off
    // the bottom for the whole drag.
    //
    // Gated on `dragging`, which is what the name always implied. It exists to
    // keep the GRIP under the CURSOR, and there is no grip being held unless a
    // drag is in progress. Ungated it also ran on content-driven growth — so
    // typing a long enough template scrolled the page out from under you — and
    // it made this flush mutate scroll position, which moves the element the
    // observer is measuring. A resize handler that can change its own input is
    // the shape a runaway needs.
    if (dragging && h > lastHeight) followGrip();
    lastHeight = h;
  }

  function schedule(): void {
    if (pending) return;
    pending = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
    else flush();
  }

  /**
   * Our own resize drag, replacing the native `resize: vertical`.
   *
   * The native resizer computes `startHeight + (pointerY - startY)` from an
   * origin it captured at pointerdown, and it does NOT clamp to the element's
   * own min/max. Drag past a limit and that sum keeps running while the
   * rendered box stays pinned, so dragging back moves nothing until the
   * invisible total walks all the way home. Measured: collapsing past a 34px
   * floor then expanding cost 13 of 23 frames of completely dead travel. That
   * is the "gets stuck, then starts working" report, and it bites exactly when
   * the box reaches one line — which is also when the overflow fade returns,
   * which is why the fade kept looking guilty.
   *
   * Nothing outside can fix it: rewriting `style.height` mid-drag is ignored,
   * because the browser recomputes from its own captured origin every move.
   * Clamping the RESULT does not help either — the accumulated input is the
   * problem, so a clamped absolute drag measured the same 13 / 23.
   *
   * Applying each move's DELTA to the current height instead keeps no history
   * to accumulate: the first pixel back off a limit moves the box. Same
   * harness, same over-drag: 0 / 23.
   */
  function startResize(ev: PointerEvent): void {
    const el = getEl();
    if (!el) return;
    ev.preventDefault();
    dragging = true;
    userResized.value = true;
    lastPointerY = ev.clientY;

    const cs = getComputedStyle(el);
    // CSS stays the source of truth for the floor; the ceiling is deliberately
    // released, because a deliberate drag is the user overriding a cap that
    // exists only to bound AUTO-grow.
    // `min-height: auto` (the default) parses to NaN, so a field that never
    // declared one would get a floor of 0 and could be dragged away to a
    // sliver. CSS stays authoritative when it says anything; ABSOLUTE_MIN is
    // only the backstop for when it does not.
    const declared = Number.parseFloat(cs.minHeight);
    minPx = Number.isFinite(declared) && declared > 0 ? declared : ABSOLUTE_MIN;
    if (!capLifted) {
      el.style.height = `${el.getBoundingClientRect().height}px`;
      el.style.maxHeight = "none";
      capLifted = true;
    }
    /* No `setPointerCapture`.
     *
     * It reads like the right call and it is what stranded the drag. Capture
     * retargets every subsequent pointer event to the grip — including
     * `pointerup`. The editor re-renders while it resizes, and a captured
     * element that gets replaced is detached: the `pointerup` is delivered to a
     * node no longer in the tree, so it never bubbles to `window`, `dragging`
     * stays true, and the box follows the cursor with no button held and no way
     * to stop it. That is the reported symptom exactly.
     *
     * Capture bought nothing here anyway. The listeners below are on `window`,
     * which sees the events regardless of what is under the cursor.
     *
     * CAPTURE PHASE on all three, so a `stopPropagation()` between the target
     * and the window — ComfyUI's node layer does this to stop the canvas
     * panning under a widget — cannot hide the end of the drag from us.
     */
    window.addEventListener("pointermove", onResizeMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    // A fresh press means the previous drag is over however it ended.
    window.addEventListener("pointerdown", onPointerUp, true);
    window.addEventListener("blur", onPointerUp);
    window.addEventListener("keydown", onDragEscape, true);
  }

  /** Escape ends a drag. Cheap, and it is the key a stuck user presses. */
  function onDragEscape(ev: KeyboardEvent): void {
    if (ev.key === "Escape") onPointerUp();
  }

  function onResizeMove(ev: PointerEvent): void {
    const el = getEl();
    if (!el || !dragging) return;
    // Self-heal. Every pointermove reports which buttons are down, so a move
    // with none held means the pointerup was lost — whatever swallowed it —
    // and the drag should already be over. Without this the field follows the
    // cursor forever and no key or click can stop it, because nothing else in
    // here ever clears `dragging`. Belt and braces on top of the listener
    // changes above: those address the causes we found, this ends the state
    // regardless of a cause we did not.
    if (ev.buttons === 0) {
      onPointerUp();
      return;
    }
    const dy = ev.clientY - lastPointerY;
    lastPointerY = ev.clientY;
    const cur = el.getBoundingClientRect().height;
    el.style.height = `${Math.max(minPx, cur + dy)}px`;
  }

  function onPointerUp(): void {
    if (!dragging) return;
    dragging = false;
    // Re-arm for the next drag. `capLifted` guards a one-time "pin the current
    // height, release the max-height cap" step, and leaving it set meant the
    // release survived for the lifetime of the field while the explicit height
    // that bounded it did not — `applyAtoms` replaces the host element on a
    // rebuild, which drops the inline height but not this flag. The next drag
    // then found an uncapped, unpinned box. Each drag now re-establishes both
    // against the element that actually exists.
    capLifted = false;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  }

  /** Idempotent: callers re-attach when the element they own is REPLACED
   *  rather than mutated (RichTextInput swaps its contenteditable host to
   *  repair a browser-mangled DOM). Without the disconnect the old observer
   *  would keep watching a detached node and leak, and the hint would go
   *  permanently stale on the live one. */
  function attach(): void {
    obs?.disconnect();
    obs = null;
    const el = getEl();
    if (!el) return;
    lastHeight = el.getBoundingClientRect().height;

    /* Re-measure once the webfonts land.
     *
     * These fields are typed in `--wp-font-mono`, a bundled webfont declared
     * `font-display: swap` — so the first paint uses the system fallback
     * (Consolas / Monaco) and the real face swaps in later. The two stacks
     * have different metrics, so the `scrollHeight` measured at mount is taken
     * against type that is about to be replaced.
     *
     * That is the "sometimes the bottom fade is wrong" report: on a cold load
     * the hint is computed against the fallback and never recomputed, and on a
     * warm cache the font is already there so it looks fine. Any later scroll,
     * input or resize also fixes it by accident, which is what made it look
     * intermittent rather than deterministic.
     *
     * `document.fonts.ready` resolves once, after all pending faces settle.
     * Cheap, and a no-op where the font was already cached.
     */
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        // The field may have unmounted during the load.
        if (!getEl()) return;
        updateOverflowHint();
        autosize();
      });
    }

    if (typeof ResizeObserver === "undefined") return;
    obs = new ResizeObserver(schedule);
    obs.observe(el);
  }

  onBeforeUnmount(() => {
    obs?.disconnect();
    obs = null;
    onPointerUp();
  });

  return {
    hasMoreBelow,
    updateOverflowHint,
    scheduleOverflowHint,
    autosize,
    attach,
    userResized,
    startResize,
  };
}
