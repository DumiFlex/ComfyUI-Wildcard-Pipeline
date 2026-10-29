/**
 * Wire dots that sit in front of the field they feed.
 *
 * A node like Label Grid takes optional text inputs (`title`,
 * `row_headers`, …) that replace a field in its panel once wired. ComfyUI
 * gives a plain input its own labelled row at the top of the node; built-in
 * widgets instead put the input's dot at the left edge, level with the
 * widget, hidden until you hover the widget or wire it. This module gives
 * our inputs the second look: the panel marks each field with
 * `data-wp-socket="<input name>"` and the input's dot follows that field.
 *
 * Nodes 2.0 (Vue) draws each input as a DOM row and measures the row's dot
 * (`[data-slot-key]`) to place wire ends (`syncSlotOffsets`). We take the
 * row out of the flow, hide its label and move it level with the field.
 * The host re-measures dots when the node or its widget grid resizes; a
 * field can also move without either resizing (a node made taller than its
 * content), so after a move we resize the grid by a pixel for a frame to
 * make it measure again.
 *
 * The legacy canvas places a widget's input at `widget.y` and hides its
 * label (`NodeInputSlot.isWidgetInputSlot`). We bind each input to a
 * stand-in widget (`slot._widget`, a weak ref the host reads first) whose
 * `y` is the field's, and `slot.widget = { name }` so the host treats it as
 * a widget input. `name` is the input's own name: no real widget has it, so
 * nothing gets disabled when it is linked, and the Primitive node still
 * finds the input's config by it. The binding is dropped from the saved
 * workflow (`onSerialize`) and under Nodes 2.0, which skips widget inputs
 * that have no matching widget.
 */
import { isVueNodes } from "./renderer";

interface SocketSlot {
  name: string;
  link?: number | null;
  widget?: { name: string };
  _widget?: unknown;
  pos?: unknown;
  alwaysVisible?: boolean;
}

interface SocketWidget {
  name: string;
  y?: number;
  margin?: number;
}

export interface FieldSocketNode {
  id?: string | number;
  graph?: unknown;
  inputs?: SocketSlot[];
  widgets?: SocketWidget[];
  onSerialize?: (o: { inputs?: { name: string; widget?: unknown; alwaysVisible?: unknown }[] }) => unknown;
  setDirtyCanvas?: (fg: boolean, bg?: boolean) => void;
}

interface Entry {
  node: FieldSocketNode;
  root: HTMLElement;
  widgetName: string;
  names: readonly string[];
  /** Field centre below the top of the DOM widget, in graph units; null
   *  while the field is not on screen. */
  offsets: Map<string, number | null>;
  /** Legacy stand-in widgets, held here because `slot._widget` is weak. */
  stand: Map<string, { name: string; readonly y: number }>;
  hot: Set<string>;
}

const ROW_CLASS = "wp-field-socket";
const HOT_CLASS = "wp-field-socket--hot";
/** The host's own wrapper around a widget's dot, which hides it until the
 *  widget row is hovered; we take that over. */
const HOST_CLASS = "wp-field-socket-host";
/** Gap between dots stacked at the panel top for fields not on screen. */
const STACK = 20;

const registry = new Set<Entry>();
let bodyObserver: MutationObserver | null = null;
let queued = false;

function slotHalf(): number {
  const h = (globalThis as { LiteGraph?: { NODE_SLOT_HEIGHT?: number } }).LiteGraph?.NODE_SLOT_HEIGHT;
  return (typeof h === "number" ? h : 20) / 2;
}

function canvasScale(): number {
  const s = (globalThis as { app?: { canvas?: { ds?: { scale?: number } } } }).app?.canvas?.ds?.scale;
  return typeof s === "number" && s > 0 ? s : 1;
}

/** The input is a real widget's own (the Assembler's `template`): ComfyUI
 *  binds it already, and gets it back whenever its field is not on screen
 *  (the widget gives way to the wire once linked). */
function isNative(node: FieldSocketNode, name: string): boolean {
  return node.widgets?.some((w) => w.name === name) ?? false;
}

/** The marked field for `name`, when it is on screen. */
function fieldFor(root: HTMLElement, name: string): HTMLElement | null {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("[data-wp-socket]")]) {
    if (!(el.dataset.wpSocket ?? "").split(/\s+/).includes(name)) continue;
    if (el.getClientRects().length) return el;
  }
  return null;
}

/** Each input's field centre below `top`, in units of `scale`. A socket-only
 *  input whose field is not on screen stacks from the panel top; a widget's
 *  own input gets null (ComfyUI places it). */
function measure(entry: Entry, names: readonly string[], top: number, scale: number): Map<string, number | null> {
  const out = new Map<string, number | null>();
  let stacked = 0;
  const rootTop = entry.root.getBoundingClientRect().top;
  for (const name of names) {
    const field = fieldFor(entry.root, name);
    if (field) {
      const r = field.getBoundingClientRect();
      out.set(name, (r.top + r.height / 2 - top) / scale);
    } else if (isNative(entry.node, name)) {
      out.set(name, null);
    } else {
      out.set(name, (rootTop - top) / scale + slotHalf() + STACK * stacked++);
    }
  }
  return out;
}

function bindLegacy(entry: Entry): void {
  const { node } = entry;
  const widget = node.widgets?.find((w) => w.name === entry.widgetName);
  if (!widget) return;
  // Only re-measure while the panel is laid out; a hidden panel keeps the
  // last place.
  if (entry.root.getClientRects().length) {
    let changed = false;
    const hostTop = entry.root.getBoundingClientRect().top;
    for (const [name, y] of measure(entry, entry.names, hostTop, canvasScale())) {
      if (entry.offsets.get(name) !== y) changed = true;
      entry.offsets.set(name, y);
    }
    if (changed) node.setDirtyCanvas?.(true, false);
  }
  for (const slot of node.inputs ?? []) {
    if (!entry.names.includes(slot.name)) continue;
    const native = isNative(node, slot.name);
    let stand = entry.stand.get(slot.name);
    if (!stand) {
      const name = slot.name;
      stand = {
        name,
        get y(): number {
          // The host puts the slot centre half a slot below `y`
          // (`_arrangeWidgetInputSlots`) and the DOM element `margin`
          // below the widget's own `y` (`DomWidgets.vue`).
          return (widget.y ?? 0) + (widget.margin ?? 10) + (entry.offsets.get(name) ?? 0) - slotHalf();
        },
      };
      entry.stand.set(name, stand);
    }
    const placed = entry.offsets.get(slot.name) != null;
    if (!native && slot.widget?.name !== slot.name) slot.widget = { name: slot.name };
    const want = placed || !native ? stand : undefined;
    if (slot._widget !== want) slot._widget = want;
    if (entry.hot.has(slot.name)) slot.alwaysVisible = true;
    else delete slot.alwaysVisible;
  }
}

function unbindLegacy(entry: Entry): void {
  const { node } = entry;
  for (const slot of node.inputs ?? []) {
    if (!entry.names.includes(slot.name)) continue;
    if (isNative(node, slot.name)) {
      if (slot._widget && entry.stand.get(slot.name) === slot._widget) slot._widget = undefined;
    } else if (slot.widget?.name === slot.name) {
      delete slot.widget;
      slot._widget = undefined;
      slot.pos = undefined;
    }
    delete slot.alwaysVisible;
  }
}

/** Make the host measure the node's dots again: resize its widget grid by a
 *  pixel for a frame (the grid's resize alone re-syncs slots, it reports no
 *  node size). */
function remeasure(nodeEl: HTMLElement): void {
  const grid = nodeEl.querySelector<HTMLElement>('[data-testid="node-widgets"]');
  if (!grid || grid.style.marginBottom) return;
  grid.style.marginBottom = "-1px";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    grid.style.marginBottom = "";
  }));
}

function release(row: HTMLElement): boolean {
  if (!row.classList.contains(ROW_CLASS)) return false;
  row.classList.remove(ROW_CLASS, HOT_CLASS);
  row.style.removeProperty("top");
  row.style.removeProperty("left");
  row.parentElement?.classList.remove(HOST_CLASS);
  return true;
}

function syncVue(entry: Entry): void {
  const { node } = entry;
  const nodeEl = entry.root.closest<HTMLElement>("[data-node-id]");
  if (!nodeEl || !nodeEl.offsetWidth) return;
  const nodeRect = nodeEl.getBoundingClientRect();
  const scale = nodeRect.width / nodeEl.offsetWidth;
  if (!(scale > 0)) return;
  const id = nodeEl.dataset.nodeId ?? String(node.id);
  let moved = false;
  (node.inputs ?? []).forEach((slot, i) => {
    if (!entry.names.includes(slot.name)) return;
    const dot = nodeEl.querySelector<HTMLElement>(`[data-slot-key="${id}-in-${i}"]`);
    const row = dot?.closest<HTMLElement>(".lg-slot--input");
    if (!row) return;
    const parent = row.offsetParent as HTMLElement | null;
    if (!parent) return;
    const pRect = parent.getBoundingClientRect();
    const y = measure(entry, [slot.name], pRect.top, scale).get(slot.name);
    if (y == null) {
      if (release(row)) moved = true;
      return;
    }
    row.classList.add(ROW_CLASS);
    row.classList.toggle(HOT_CLASS, entry.hot.has(slot.name));
    // A widget's own dot sits in a wrapper of the widget row that hides it
    // until the row is hovered.
    if (row.closest("[data-widget-name]")) row.parentElement?.classList.add(HOST_CLASS);
    const top = `${Math.round((y - row.offsetHeight / 2) * 10) / 10}px`;
    const left = `${Math.round(((nodeRect.left - pRect.left) / scale) * 10) / 10}px`;
    if (row.style.top !== top || row.style.left !== left) {
      row.style.top = top;
      row.style.left = left;
      moved = true;
    }
  });
  if (moved) remeasure(nodeEl);
}

function sync(entry: Entry): void {
  if (isVueNodes()) {
    unbindLegacy(entry);
    syncVue(entry);
  } else {
    bindLegacy(entry);
  }
}

function flush(): void {
  queued = false;
  for (const entry of [...registry]) {
    // litegraph nulls `graph` when a node is removed.
    if (entry.node.graph === null) {
      registry.delete(entry);
      continue;
    }
    sync(entry);
  }
}

function queue(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(flush);
}

/** Toggle the "hovering this field" look on every input `el` sits in. */
function hover(entry: Entry, el: EventTarget | null, on: boolean): void {
  const field = el instanceof Element ? el.closest<HTMLElement>("[data-wp-socket]") : null;
  if (!field || !entry.root.contains(field)) return;
  const names = (field.dataset.wpSocket ?? "").split(/\s+/).filter((n) => entry.names.includes(n));
  if (!names.length) return;
  for (const n of names) {
    if (on) entry.hot.add(n);
    else entry.hot.delete(n);
  }
  sync(entry);
  entry.node.setDirtyCanvas?.(true, false);
}

/**
 * Put the dots of `names` (inputs of `node`) in front of the fields marked
 * `data-wp-socket="<name>"` inside `root`, the DOM element of the node's
 * widget `widgetName`. Works for socket-only inputs and for a widget's own
 * input (`names` may hold `widgetName`). Returns the teardown.
 */
export function attachFieldSockets(
  node: FieldSocketNode,
  root: HTMLElement,
  widgetName: string,
  names: readonly string[],
): () => void {
  const entry: Entry = {
    node,
    root,
    widgetName,
    names,
    offsets: new Map(),
    stand: new Map(),
    hot: new Set(),
  };
  registry.add(entry);

  const origSerialize = node.onSerialize;
  node.onSerialize = function (this: FieldSocketNode, o) {
    for (const input of o.inputs ?? []) {
      if (!names.includes(input.name)) continue;
      if (!isNative(node, input.name)) delete input.widget;
      delete input.alwaysVisible;
    }
    return origSerialize?.call(this, o);
  };

  const over = (e: PointerEvent): void => hover(entry, e.target, true);
  const out = (e: PointerEvent): void => {
    const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest("[data-wp-socket]") : null;
    const from = e.target instanceof Element ? e.target.closest("[data-wp-socket]") : null;
    if (from && from !== to) hover(entry, from, false);
  };
  root.addEventListener("pointerover", over);
  root.addEventListener("pointerout", out);

  const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(queue) : null;
  resize?.observe(root);
  if (!bodyObserver && typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
    bodyObserver = new MutationObserver(queue);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }
  queue();

  return () => {
    registry.delete(entry);
    resize?.disconnect();
    root.removeEventListener("pointerover", over);
    root.removeEventListener("pointerout", out);
    if (node.onSerialize !== origSerialize) node.onSerialize = origSerialize;
    unbindLegacy(entry);
  };
}
