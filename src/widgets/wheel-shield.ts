/**
 * Keep the mouse wheel scrolling our widgets instead of zooming the canvas.
 *
 * Under the legacy renderer a wheel over a scrollable part of our widget just
 * scrolls it. Under Nodes 2.0 it does not: the event reaches ComfyUI's canvas
 * handler, which zooms and cancels the default, so the content never moves.
 * Measured over the Debug viewer's scroller, which reported
 * `scrollHeight > clientHeight`:
 *
 *     legacy      scrollTop 0 -> 300   scale 0.900 -> 0.900
 *     Nodes 2.0   scrollTop 0 ->   0   scale 0.900 -> 0.818
 *
 * ComfyUI hits this with its own multiline textarea widget and solves it in
 * `vueNodes/widgets/utils/multilineTextarea.ts`: when the element can scroll,
 * `stopPropagation()` and nothing else — no `preventDefault()`, so the browser
 * still performs the native scroll, and the canvas never sees the event. This
 * mirrors that, generalised to whichever descendant under the cursor is the
 * scroller.
 *
 * Ctrl+wheel is left alone deliberately: that is pinch-zoom, and the host
 * treats it as a canvas zoom even over a scrollable widget.
 */

/** Nearest ancestor of `start` (inclusive), up to and including `root`, that
 *  can scroll along the axis the wheel is moving. Null when the gesture should
 *  belong to the canvas. */
function scrollableUnder(
  start: EventTarget | null,
  root: HTMLElement,
  horizontal: boolean,
): HTMLElement | null {
  let el = start instanceof HTMLElement ? start : null;
  while (el) {
    const style = getComputedStyle(el);
    const overflow = horizontal ? style.overflowX : style.overflowY;
    if (overflow === "auto" || overflow === "scroll") {
      const scrollSize = horizontal ? el.scrollWidth : el.scrollHeight;
      const clientSize = horizontal ? el.clientWidth : el.clientHeight;
      // Matching the host's own check: scrollable at all, not "scrollable
      // further in this direction". Handing the canvas a zoom the moment the
      // user hits the end of a list is worse than absorbing the event.
      if (scrollSize > clientSize + 1) return el;
    }
    if (el === root) break;
    el = el.parentElement;
  }
  return null;
}

/**
 * Install the shield on a widget root. Returns a disposer.
 *
 * Listens at the WINDOW in capture phase, not on the root in bubble phase.
 * The canvas decides whether to swallow a wheel in `useCanvasInteractions`:
 *
 *     const captureElement = target?.closest('[data-capture-wheel="true"]')
 *     const active = document.activeElement
 *     return !!(captureElement && active && captureElement.contains(active))
 *
 * — it yields only to a widget that both declares the attribute AND currently
 * holds focus. A read-only viewer never takes focus, so it would never qualify,
 * and a bubble-phase `stopPropagation()` on our own element does not reach the
 * decision either (measured: still zoomed 0.900 -> 0.818). Window capture runs
 * before every other listener, so it is the one place we can reliably win.
 *
 * `stopPropagation` alone, deliberately: it suppresses listeners, never the
 * default action, so the browser still performs the native scroll.
 */
export function installWheelShield(root: HTMLElement): () => void {
  // Declare intent to the host as well, so a focused widget takes the
  // documented path rather than relying solely on our interception.
  root.setAttribute("data-capture-wheel", "true");

  const onWheel = (ev: WheelEvent): void => {
    // Pinch-zoom belongs to the canvas.
    if (ev.ctrlKey) return;
    const target = ev.target;
    if (!(target instanceof Node) || !root.contains(target)) return;
    const horizontal = Math.abs(ev.deltaX) > Math.abs(ev.deltaY);
    if (!scrollableUnder(target, root, horizontal)) return;
    ev.stopPropagation();
  };
  window.addEventListener("wheel", onWheel, { capture: true, passive: true });
  return () => window.removeEventListener("wheel", onWheel, { capture: true });
}
