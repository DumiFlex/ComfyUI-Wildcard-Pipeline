/**
 * WP Debug "Show node" blink: after the canvas centres a node, find the row
 * the step came from inside that node's widgets and pulse it.
 *
 * Context modules (and bundle children) are found by `data-uid`; rows of the
 * other nodes (Injector, Model Info, Toggles, Loop) carry the variables they
 * write in `data-wp-vars` (space separated, no `$`).
 *
 * A row can be out of sight inside its node: a folded bundle, a folded
 * Toggles label group. Before looking, every element marked
 * `data-wp-reveal` in the node's widgets gets a `wp-reveal` event carrying
 * the target, and the widget unfolds what hides it. Subgraphs are never
 * unpacked: `focusNode` opens the graph the node lives in instead.
 */
import { nodeWidgetHosts } from "../extension/_stashes";

export interface FlashTarget {
  /** Module instance `_uid` (Context rows, bundle children). */
  uid?: string;
  /** Variable names (no `$`) the row writes. */
  vars?: string[];
}

function escapeAttr(v: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(v)
    : v.replace(/["\\]/g, "\\$&");
}

/** The DOM event a widget listens for to unfold what hides `target`. */
export const REVEAL_EVENT = "wp-reveal";

/** Ask every widget in `hosts` to unfold what hides `target`. */
export function askReveal(hosts: Iterable<HTMLElement>, target: FlashTarget): void {
  for (const h of hosts) {
    if (!h.isConnected) continue;
    for (const el of h.querySelectorAll<HTMLElement>("[data-wp-reveal]")) {
      el.dispatchEvent(new CustomEvent<FlashTarget>(REVEAL_EVENT, { detail: target }));
    }
  }
}

/** The target a `wp-reveal` event carries, or null for any other event. */
export function revealTarget(ev: Event): FlashTarget | null {
  const d = (ev as CustomEvent<unknown>).detail;
  return d && typeof d === "object" ? (d as FlashTarget) : null;
}

/** The element in `hosts` that best stands for `target`, or null. */
export function findFlashElement(hosts: Iterable<HTMLElement>, target: FlashTarget): HTMLElement | null {
  const live = [...hosts].filter((h) => h.isConnected);
  const selectors: string[] = [];
  if (target.uid) selectors.push(`[data-uid="${escapeAttr(target.uid)}"]`);
  for (const v of target.vars ?? []) if (v) selectors.push(`[data-wp-vars~="${escapeAttr(v)}"]`);
  for (const sel of selectors) {
    for (const h of live) {
      const el = h.querySelector<HTMLElement>(sel);
      if (el && el.getClientRects().length) return el;
    }
  }
  return null;
}

/** Scroll `el` into view inside its own widget only (never the page or the
 *  canvas container, which `scrollIntoView` would also move). */
function revealInHost(el: HTMLElement, host: HTMLElement): void {
  for (let p = el.parentElement; p && p !== host.parentElement; p = p.parentElement) {
    if (p.scrollHeight <= p.clientHeight + 1) continue;
    const oy = getComputedStyle(p).overflowY;
    if (oy !== "auto" && oy !== "scroll") continue;
    const pr = p.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < pr.top) p.scrollTop -= pr.top - er.top + 8;
    else if (er.bottom > pr.bottom) p.scrollTop += er.bottom - pr.bottom + 8;
  }
}

const RING = "var(--wp-accent)";

/** Pulse `el` twice with an accent ring. */
export function blink(el: HTMLElement): void {
  if (typeof el.animate !== "function") return;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)")?.matches === true;
  const on = { boxShadow: `0 0 0 2px ${RING}, 0 0 14px 2px ${RING}` };
  const off = { boxShadow: "0 0 0 0 transparent, 0 0 0 0 transparent" };
  el.animate(reduce ? [on, on, off] : [off, on, off, on, off], {
    duration: reduce ? 900 : 1100,
    easing: "ease-in-out",
  });
}

/**
 * Find and blink `target` inside `node`'s widgets. The node may have just
 * been opened in another graph, so this keeps looking for about a second.
 */
export function flashInNode(node: object, target: FlashTarget): void {
  if (!target.uid && !target.vars?.length) return;
  let tries = 0;
  let asked = false;
  const look = (): void => {
    const hosts = nodeWidgetHosts.get(node);
    // Once the widgets are mounted, unfold first, then look on the next try
    // (after the widget has re-rendered).
    if (hosts && !asked && [...hosts].some((h) => h.isConnected)) {
      asked = true;
      askReveal(hosts, target);
      setTimeout(look, 60);
      return;
    }
    const el = hosts ? findFlashElement(hosts, target) : null;
    if (el) {
      const host = [...(hosts ?? [])].find((h) => h.contains(el));
      if (host) revealInHost(el, host);
      blink(el);
      return;
    }
    // A graph switch can take a while to mount its nodes (Nodes 2.0).
    if (++tries < 20) setTimeout(look, 90);
  };
  // Let the canvas finish centring (and a graph switch mount its nodes).
  setTimeout(look, 160);
}
