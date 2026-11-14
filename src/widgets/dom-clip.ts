/**
 * Hides the parts of our DOM widgets that a node drawn above them covers.
 *
 * In the legacy renderer the nodes are canvas paint and every DOM widget
 * sits in one layer over the canvas, so a widget shows through any node
 * that overlaps it. ComfyUI's own clipping (`Comfy.DOMClippingEnabled`)
 * only cuts out the SELECTED node, so a node you merely dropped on top of a
 * WP Debug or Context still had our widget drawn over it.
 *
 * On each canvas draw, every registered widget whose node has a node drawn
 * after it (later in `graph._nodes`, which is LiteGraph's paint order) that
 * overlaps it gets a `clip-path` on its own host element that leaves those
 * nodes out. The clip also stops clicks there, so the node on top gets
 * them. Nodes 2.0 draws each node as DOM with its own stacking, so the
 * clip is cleared there.
 */
import { isVueNodes } from "../extension/renderer";

/** [x, y, width, height]. */
export type Rect = readonly [number, number, number, number];

/** The parts of `base` that `hole` doesn't cover, as up to four
 *  non-overlapping rects (top band, bottom band, left, right). */
export function subtractRect(base: Rect, hole: Rect): Rect[] {
  const [bx, by, bw, bh] = base;
  const x1 = Math.max(bx, hole[0]);
  const y1 = Math.max(by, hole[1]);
  const x2 = Math.min(bx + bw, hole[0] + hole[2]);
  const y2 = Math.min(by + bh, hole[1] + hole[3]);
  if (x2 <= x1 || y2 <= y1) return [base];
  const out: Rect[] = [];
  if (y1 > by) out.push([bx, by, bw, y1 - by]);
  if (y2 < by + bh) out.push([bx, y2, bw, by + bh - y2]);
  if (x1 > bx) out.push([bx, y1, x1 - bx, y2 - y1]);
  if (x2 < bx + bw) out.push([x2, y1, bx + bw - x2, y2 - y1]);
  return out;
}

/** A `clip-path` showing a `width` × `height` box minus `holes`, or `""`
 *  when no hole touches it. Overlapping holes are fine: the visible area
 *  is built from disjoint rects, never from even-odd cut-outs. */
export function clipPathFor(width: number, height: number, holes: readonly Rect[]): string {
  let visible: Rect[] = [[0, 0, width, height]];
  let cut = false;
  for (const hole of holes) {
    const next: Rect[] = [];
    for (const r of visible) {
      const parts = subtractRect(r, hole);
      if (parts.length !== 1 || parts[0] !== r) cut = true;
      next.push(...parts);
    }
    visible = next;
  }
  if (!cut) return "";
  if (visible.length === 0) return "inset(50%)";
  const round = (n: number): number => Math.round(n * 100) / 100;
  const d = visible
    .map(([x, y, w, h]) => `M${round(x)} ${round(y)}h${round(w)}v${round(h)}h${round(-w)}Z`)
    .join("");
  return `path("${d}")`;
}

export interface ClipNode {
  pos: ArrayLike<number>;
  size: ArrayLike<number>;
  graph?: { _nodes?: readonly ClipNode[] } | null;
  getBounding?: () => ArrayLike<number>;
}

interface ClipCanvas {
  canvas?: HTMLCanvasElement;
  ds?: { offset: ArrayLike<number>; scale: number };
  onDrawForeground?: ((...args: unknown[]) => unknown) | null;
}

const TITLE_HEIGHT = 30;

function bounds(n: ClipNode): Rect {
  const b = n.getBounding?.();
  if (b && b.length >= 4) return [b[0], b[1], b[2], b[3]];
  return [n.pos[0], n.pos[1] - TITLE_HEIGHT, n.size[0], n.size[1] + TITLE_HEIGHT];
}

function overlaps(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

interface Entry { node: ClipNode; el: HTMLElement; clip: string }
const entries = new Set<Entry>();
let hooked: ClipCanvas | null = null;
let ourDraw: ((...args: unknown[]) => unknown) | null = null;

function setClip(e: Entry, clip: string): void {
  // Re-apply when something else cleared the style (the browser rewrites a
  // path's text, so compare with what we set, not with the style).
  if (e.clip === clip && (clip === "") === (e.el.style.clipPath === "")) return;
  e.clip = clip;
  e.el.style.clipPath = clip;
}

/** Re-clips every registered widget. Exported for tests. */
export function updateClips(canvas: ClipCanvas): void {
  const vue = isVueNodes();
  const order = new Map<readonly ClipNode[], Map<ClipNode, number>>();
  for (const e of entries) {
    const nodes = e.node.graph?._nodes;
    if (vue || !nodes || !e.el.isConnected || !canvas.canvas || !canvas.ds) {
      setClip(e, "");
      continue;
    }
    let index = order.get(nodes);
    if (!index) {
      index = new Map(nodes.map((n, i) => [n, i]));
      order.set(nodes, index);
    }
    const mine = index.get(e.node);
    if (mine === undefined) { setClip(e, ""); continue; }
    const box = bounds(e.node);
    const above: Rect[] = [];
    for (let i = mine + 1; i < nodes.length; i++) {
      const b = bounds(nodes[i]);
      if (overlaps(box, b)) above.push(b);
    }
    if (above.length === 0) { setClip(e, ""); continue; }
    // Canvas units → this element's own CSS px. ComfyUI scales the widget
    // with a transform, so the element's px are its rect over its layout size.
    const r = e.el.getBoundingClientRect();
    const w = e.el.offsetWidth;
    const h = e.el.offsetHeight;
    if (r.width === 0 || w === 0 || h === 0) continue;
    const k = r.width / w;
    const c = canvas.canvas.getBoundingClientRect();
    const { offset, scale } = canvas.ds;
    const holes = above.map(([x, y, bw, bh]): Rect => [
      (c.left + (x + offset[0]) * scale - r.left) / k,
      (c.top + (y + offset[1]) * scale - r.top) / k,
      (bw * scale) / k,
      (bh * scale) / k,
    ]);
    setClip(e, clipPathFor(w, h, holes));
  }
}

function hook(): void {
  const canvas = (globalThis as { app?: { canvas?: ClipCanvas } }).app?.canvas;
  if (!canvas) return;
  if (hooked === canvas && canvas.onDrawForeground === ourDraw) return;
  const prev = canvas.onDrawForeground;
  ourDraw = function (this: unknown, ...args: unknown[]): unknown {
    const out = prev?.apply(this, args);
    try { updateClips(canvas); } catch { /* never break a canvas frame */ }
    return out;
  };
  canvas.onDrawForeground = ourDraw;
  hooked = canvas;
}

/** Clips `el` (a widget's host element on `node`) against the nodes drawn
 *  above it. Returns the unregister function. */
export function registerOverlapClip(node: ClipNode, el: HTMLElement): () => void {
  const entry: Entry = { node, el, clip: "" };
  entries.add(entry);
  hook();
  return () => {
    entries.delete(entry);
    el.style.clipPath = "";
  };
}

/** Test hook: forget every registration and the canvas hook. */
export function resetOverlapClipForTests(): void {
  entries.clear();
  hooked = null;
  ourDraw = null;
}
