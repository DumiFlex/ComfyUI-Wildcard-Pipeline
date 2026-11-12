/**
 * WP Debug "Show node" blink: after the canvas centres a node, find the row
 * the step came from inside that node's widgets and pulse it.
 *
 * Context modules (and bundle children) are found by `data-uid`; rows of the
 * other nodes (Injector, Model Info, Toggles, Loop) carry the variables they
 * write in `data-wp-vars` (space separated, no `$`).
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
  const look = (): void => {
    const hosts = nodeWidgetHosts.get(node);
    const el = hosts ? findFlashElement(hosts, target) : null;
    if (el) {
      const host = [...(hosts ?? [])].find((h) => h.contains(el));
      if (host) revealInHost(el, host);
      blink(el);
      return;
    }
    if (++tries < 12) setTimeout(look, 90);
  };
  // Let the canvas finish centring (and a graph switch mount its nodes).
  setTimeout(look, 160);
}
