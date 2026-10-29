/**
 * Output dots that sit at the right edge of the row they belong to, the
 * output twin of `field-sockets.ts`.
 *
 * WP Toggles gives each pinned toggle a BOOLEAN output. ComfyUI stacks
 * outputs at the top of the node; this module moves each one level with
 * the panel element marked `data-wp-out="<output name>"` (several names,
 * space separated, when a folded group gathers its dots on one row).
 * Outputs no element names stay where ComfyUI puts them.
 *
 * The legacy canvas reads an output's place from `output.pos` (relative to
 * the node, the dot's centre) when it is set, and leaves such outputs out of
 * its own stacking. We set it from the measured element and drop it from
 * the saved workflow (`onSerialize`), since it is only a screen position.
 *
 * It also paints the output's name beside the dot, which would show through
 * a see-through row. It skips the name only for `isWidgetInputSlot`, a
 * getter output slots pin to `false`; a placed output gets its own
 * non-enumerable `true` (`hideLabel`), dropped again when it goes back.
 *
 * Nodes 2.0 (Vue) draws each output as a DOM row (`.lg-slot--output`: the
 * label, then the dot) and measures the dot to place wire ends. As
 * field-sockets does for inputs, we take the row out of the flow, hide its
 * label and put it level with the element, its right edge on the node's.
 */
import { isVueNodes } from "./renderer";

interface OutSlot {
  name: string;
  pos?: [number, number] | number[];
}

interface OutWidget {
  name: string;
  y?: number;
  margin?: number;
}

export interface RowOutputNode {
  id?: string | number;
  graph?: unknown;
  size?: [number, number] | number[];
  outputs?: OutSlot[];
  widgets?: OutWidget[];
  inputs?: { name: string; widget?: unknown; pos?: unknown }[];
  /** Legacy canvas: where widgets start (below the slots when unset). */
  widgets_start_y?: number;
  onSerialize?: (o: { outputs?: { name: string; pos?: unknown }[] }) => unknown;
  setDirtyCanvas?: (fg: boolean, bg?: boolean) => void;
}

interface Entry {
  node: RowOutputNode;
  root: HTMLElement;
  widgetName: string;
  /** Which outputs this module places (others are left alone). */
  owns: (name: string) => boolean;
  /** Frames in a row that a sync changed something (see `flush`). */
  settling: number;
}

const ROW_ATTR = "data-wp-row-output";
const LEGACY_CLASS = "wp-row-outputs--legacy";

const registry = new Set<Entry>();
let bodyObserver: MutationObserver | null = null;
let queued = false;

/** Legacy canvas: paint no name beside a placed output (see the header). */
function hideLabel(slot: OutSlot, hide: boolean): void {
  const own = Object.prototype.hasOwnProperty.call(slot, "isWidgetInputSlot");
  if (hide && !own) {
    Object.defineProperty(slot, "isWidgetInputSlot", { get: () => true, configurable: true, enumerable: false });
  } else if (!hide && own) {
    delete (slot as { isWidgetInputSlot?: unknown }).isWidgetInputSlot;
  }
}

function slotHalf(): number {
  const h = (globalThis as { LiteGraph?: { NODE_SLOT_HEIGHT?: number } }).LiteGraph?.NODE_SLOT_HEIGHT;
  return (typeof h === "number" ? h : 20) / 2;
}

function canvasScale(): number {
  const s = (globalThis as { app?: { canvas?: { ds?: { scale?: number } } } }).app?.canvas?.ds?.scale;
  return typeof s === "number" && s > 0 ? s : 1;
}

/** The element whose row `name`'s dot follows, when it is on screen. */
export function rowFor(root: HTMLElement, name: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>("[data-wp-out]")) {
    if (!(el.dataset.wpOut ?? "").split(/\s+/).includes(name)) continue;
    if (el.getClientRects().length) return el;
  }
  return null;
}

/** Centre of `name`'s row below `top`, in units of `scale`; null when no
 *  row on screen names it. */
function centreOf(root: HTMLElement, name: string, top: number, scale: number): number | null {
  const el = rowFor(root, name);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return (r.top + r.height / 2 - top) / scale;
}

function syncLegacy(entry: Entry): boolean {
  const { node, root } = entry;
  const widget = node.widgets?.find((w) => w.name === entry.widgetName);
  if (!widget || !root.getClientRects().length) return false;
  const top = root.getBoundingClientRect().top;
  const scale = canvasScale();
  const x = (node.size?.[0] ?? 0) + 1 - slotHalf();
  let changed = false;
  for (const slot of node.outputs ?? []) {
    if (!entry.owns(slot.name)) continue;
    const y0 = centreOf(root, slot.name, top, scale);
    hideLabel(slot, y0 != null);
    if (y0 == null) {
      if (slot.pos) {
        delete slot.pos;
        changed = true;
      }
      continue;
    }
    // The DOM element sits `margin` below the widget's own `y` (`DomWidgets.vue`).
    const y = Math.round(((widget.y ?? 0) + (widget.margin ?? 10) + y0) * 10) / 10;
    if (slot.pos?.[0] !== x || slot.pos?.[1] !== y) {
      slot.pos = [x, y];
      changed = true;
    }
  }
  // The host starts widgets below the lowest slot, placed ones included:
  // ours sit on the widget, so that would push it down every frame. Start
  // them below the slots it still stacks itself instead.
  const stacked = Math.max(
    1,
    (node.inputs ?? []).filter((i) => !i.widget && !i.pos).length,
    (node.outputs ?? []).filter((o) => !o.pos).length,
  );
  const start = stacked * slotHalf() * 2 + 6;
  if (node.widgets_start_y !== start) {
    node.widgets_start_y = start;
    changed = true;
  }
  if (changed) node.setDirtyCanvas?.(true, true);
  return changed;
}

function clearLegacy(entry: Entry): void {
  for (const slot of entry.node.outputs ?? []) {
    if (!entry.owns(slot.name)) continue;
    delete slot.pos;
    hideLabel(slot, false);
  }
  delete entry.node.widgets_start_y;
}

/** Make the host measure the node's dots again (see field-sockets). */
function remeasure(nodeEl: HTMLElement): void {
  const grid = nodeEl.querySelector<HTMLElement>('[data-testid="node-widgets"]');
  if (!grid || grid.style.marginBottom) return;
  grid.style.marginBottom = "-1px";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    grid.style.marginBottom = "";
  }));
}

function release(row: HTMLElement): boolean {
  if (!row.hasAttribute(ROW_ATTR)) return false;
  row.removeAttribute(ROW_ATTR);
  row.style.removeProperty("top");
  row.style.removeProperty("left");
  return true;
}

function syncVue(entry: Entry): boolean {
  const { node, root } = entry;
  const nodeEl = root.closest<HTMLElement>("[data-node-id]");
  if (!nodeEl || !nodeEl.offsetWidth) return false;
  const nodeRect = nodeEl.getBoundingClientRect();
  const scale = nodeRect.width / nodeEl.offsetWidth;
  if (!(scale > 0)) return false;
  const id = nodeEl.dataset.nodeId ?? String(node.id);
  let moved = false;
  (node.outputs ?? []).forEach((slot, i) => {
    if (!entry.owns(slot.name)) return;
    const dot = nodeEl.querySelector<HTMLElement>(`[data-slot-key="${id}-out-${i}"]`);
    const row = dot?.closest<HTMLElement>(".lg-slot--output");
    if (!row) return;
    const y0 = centreOf(root, slot.name, 0, scale);
    if (y0 == null) {
      if (release(row)) moved = true;
      return;
    }
    row.setAttribute(ROW_ATTR, "");
    const parent = row.offsetParent as HTMLElement | null;
    if (!parent) return;
    const pRect = parent.getBoundingClientRect();
    const y = y0 - pRect.top / scale;
    const topPx = `${Math.round((y - row.offsetHeight / 2) * 10) / 10}px`;
    const leftPx = `${Math.round(((nodeRect.right - pRect.left) / scale - row.offsetWidth) * 10) / 10}px`;
    if (row.style.top !== topPx || row.style.left !== leftPx) {
      row.style.top = topPx;
      row.style.left = leftPx;
      moved = true;
    }
  });
  if (moved) remeasure(nodeEl);
  return moved;
}

function sync(entry: Entry): boolean {
  const vue = isVueNodes();
  // The legacy canvas draws the dot inside the node, over the panel's right
  // edge; give the panel a gutter there. Nodes 2.0 puts it on the border.
  entry.root.classList.toggle(LEGACY_CLASS, !vue);
  if (vue) {
    clearLegacy(entry);
    return syncVue(entry);
  }
  return syncLegacy(entry);
}

/** Frames a sync may follow itself. A change moves things it measured from:
 *  a new `widgets_start_y` moves `widget.y` only once the host lays the node
 *  out again (on its next draw), and nothing in the DOM tells us when. */
const SETTLE_FRAMES = 3;

function flush(): void {
  queued = false;
  let again = false;
  for (const entry of [...registry]) {
    if (entry.node.graph === null) {
      registry.delete(entry);
      continue;
    }
    if (sync(entry) && entry.settling < SETTLE_FRAMES) {
      entry.settling++;
      again = true;
    } else {
      entry.settling = 0;
    }
  }
  if (again) queueRowOutputs();
}

/** Re-place the dots on the next frame (after an output was added or removed). */
export function queueRowOutputs(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(flush);
}

/**
 * Put the dots of the outputs `owns` accepts level with the elements inside
 * `root` (the DOM element of widget `widgetName`) that name them in
 * `data-wp-out`. Returns the teardown.
 */
export function attachRowOutputs(
  node: RowOutputNode,
  root: HTMLElement,
  widgetName: string,
  owns: (name: string) => boolean,
): () => void {
  const entry: Entry = { node, root, widgetName, owns, settling: 0 };
  registry.add(entry);

  const origSerialize = node.onSerialize;
  node.onSerialize = function (this: RowOutputNode, o) {
    for (const out of o.outputs ?? []) if (owns(out.name)) delete out.pos;
    return origSerialize?.call(this, o);
  };

  const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(queueRowOutputs) : null;
  resize?.observe(root);
  if (!bodyObserver && typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
    bodyObserver = new MutationObserver(queueRowOutputs);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }
  queueRowOutputs();

  return () => {
    registry.delete(entry);
    resize?.disconnect();
    root.classList.remove(LEGACY_CLASS);
    if (node.onSerialize !== origSerialize) node.onSerialize = origSerialize;
    clearLegacy(entry);
  };
}
