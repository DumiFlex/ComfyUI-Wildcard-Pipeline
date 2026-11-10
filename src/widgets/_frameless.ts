/**
 * Frameless nodes: a node that is only its DOM panel (WP Note, WP Bookmark).
 * LiteGraph draws no title bar or box for them (`NO_TITLE`, transparent
 * background, no badges) and these helpers make the panel act like the
 * node: clicks on it reach the canvas (drag, select, double-click), its pin
 * is ComfyUI's own, and the node stays exactly the panel's size. The Nodes
 * 2.0 side is `components/shared/frameless-node.css`.
 */
import type { DomWidgetHost } from "./_shared";

export interface FramelessNode {
  size: [number, number] | number[];
  graph?: unknown;
  flags?: { pinned?: boolean; collapsed?: boolean };
  pin?: (v?: boolean) => void;
  onDrawForeground?: (...args: unknown[]) => void;
  computeSize?: () => [number, number];
  setDirtyCanvas?: (fg: boolean, bg: boolean) => void;
}

/**
 * Nodes 2.0 places a node's card one title bar above its position
 * (`translate(x, y - NODE_TITLE_HEIGHT)`) and fills that strip with the
 * header. A frameless node hides the header, so without help its panel sits
 * one title bar higher than in Classic. Publish the height for
 * `frameless-node.css`, which shifts the card back down.
 */
export function publishTitleHeight(): void {
  if (typeof document === "undefined") return;
  const h = (globalThis as { LiteGraph?: { NODE_TITLE_HEIGHT?: number } }).LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
  document.documentElement.style.setProperty("--wp-node-title-h", `${h}px`);
}

/** ComfyUI's own pin (the right-click Pin), so its lock icon and menu agree.
 *  pin() needs the node on a graph; before that, set the flag. */
export function setPinned(node: FramelessNode, pinned: boolean): void {
  if (node.pin && node.graph) node.pin(pinned);
  else node.flags = { ...(node.flags ?? {}), pinned };
  node.setDirtyCanvas?.(true, true);
}

/**
 * Lets clicks through the panel to the canvas, so it drags, selects and
 * zooms like a node while it looks like a panel. ComfyUI's wrapper around a
 * DOM widget takes pointer events and its style binding writes `auto` back
 * on every layout change, so keep it at `none` with an observer. The panel's
 * buttons and forms take events again in their own CSS.
 *
 * `when` says whether to pass clicks through right now. While it is false
 * (a note being edited is a form, not a panel to drag) the wrapper keeps
 * ComfyUI's own `auto`: with `none` on an ancestor, Firefox's overlay
 * scrollbars inside the form ignored the pointer until the form was clicked.
 * Returns `{ stop, refresh }` (call `refresh` when `when` may have changed),
 * or null while the wrapper isn't there yet.
 */
export function passPointerThrough(
  el: HTMLElement,
  when: () => boolean = () => true,
): { stop: () => void; refresh: () => void } | null {
  const wrap = el.closest<HTMLElement>(".dom-widget");
  if (!wrap) return null;
  const apply = (): void => {
    const pass = when();
    const current = wrap.style.getPropertyValue("pointer-events");
    const forced = wrap.style.getPropertyPriority("pointer-events") === "important";
    if (pass && current !== "none") wrap.style.setProperty("pointer-events", "none", "important");
    else if (!pass && forced) wrap.style.removeProperty("pointer-events");
  };
  apply();
  const obs = new MutationObserver(apply);
  obs.observe(wrap, { attributes: true, attributeFilter: ["style"] });
  return { stop: () => obs.disconnect(), refresh: apply };
}

/** Keeps ComfyUI's wrapper letting clicks through while `when()` holds. It
 *  is created after the node, and again when the graph is re-shown, so check
 *  on each draw. Returns `refresh`, to call when `when` may have changed. */
export function keepPassThrough(
  node: FramelessNode,
  host: DomWidgetHost,
  when: () => boolean = () => true,
): () => void {
  let wrap: HTMLElement | null = null;
  let pass: { stop: () => void; refresh: () => void } | null = null;
  host.onCleanup(() => pass?.stop());
  const prevDraw = node.onDrawForeground;
  node.onDrawForeground = function (this: FramelessNode, ...args: unknown[]) {
    prevDraw?.apply(this, args);
    const parent = host.element.closest<HTMLElement>(".dom-widget");
    if (parent && parent !== wrap) {
      pass?.stop();
      pass = passPointerThrough(host.element, when);
      wrap = pass ? parent : null;
    }
  };
  return () => pass?.refresh();
}

/**
 * Makes the node exactly its panel: LiteGraph's resize floor and every layout
 * pass ask `computeSize`, and a ResizeObserver follows the panel. The width is
 * the user's, never under `minWidth()`, unless `exactWidth()` says the panel
 * sizes itself (a pill or a label). Returns `fit`, to call after a change of
 * view (it waits two frames for the layout to settle).
 */
export function sizeToPanel(
  node: FramelessNode,
  host: DomWidgetHost,
  panel: () => HTMLElement | null,
  minWidth: () => number,
  exactWidth: () => boolean = () => false,
): () => void {
  const content = (): [number, number] | null => {
    const el = panel();
    if (!el?.isConnected || el.offsetHeight <= 0) return null;
    const w = exactWidth() ? Math.ceil(el.offsetWidth) : minWidth();
    return [w, Math.ceil(el.offsetHeight)];
  };
  node.computeSize = () => content() ?? [minWidth(), 30];
  const apply = (): void => {
    const want = content();
    if (!want) return;
    const size = node.size;
    const w = exactWidth() ? want[0] : Math.max(size[0] ?? 0, want[0]);
    const h = want[1];
    if (Math.abs(w - (size[0] ?? 0)) <= 1 && Math.abs(h - (size[1] ?? 0)) <= 1) return;
    size[0] = w;
    size[1] = h;
    node.setDirtyCanvas?.(true, true);
  };
  // Watch the panel itself, not the host: the host is as wide as the node,
  // so a pill that grows or shrinks would never be seen. The panel element
  // changes when the view does (and appears late, its component loads lazily),
  // so a MutationObserver re-points the ResizeObserver at the current one.
  if (typeof ResizeObserver !== "undefined") {
    let watched: HTMLElement | null = null;
    const obs = new ResizeObserver(() => apply());
    const repoint = (): void => {
      const el = panel();
      if (el === watched) return;
      if (watched) obs.unobserve(watched);
      watched = el;
      if (el) obs.observe(el);
      apply();
    };
    const swaps = new MutationObserver(repoint);
    swaps.observe(host.element, { childList: true, subtree: true });
    repoint();
    host.onCleanup(() => { obs.disconnect(); swaps.disconnect(); });
  }
  return () => {
    node.setDirtyCanvas?.(true, true);
    let frames = 2;
    const step = (): void => {
      if (--frames > 0) { requestAnimationFrame(step); return; }
      apply();
    };
    requestAnimationFrame(step);
  };
}
