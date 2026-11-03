import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { keepPassThrough, publishTitleHeight, setPinned, sizeToPanel, type FramelessNode } from "./_frameless";
import { panelAt } from "./note-peek";
import { isVueNodes } from "../extension/renderer";
import { reactiveFromGraph } from "../extension/reactive";
import { walkAllNodes, type LiteGraphLike } from "../extension/graph";
import { bookmarkCells } from "../extension/_stashes";
import { liveKeymap, type KeymapAppLike } from "../extension/bookmark-keymap";
import { MODE_BYPASS, MODE_NEVER } from "../extension/toggle-control";
import { pushToast } from "../components/shared/toast-store";
import { isProbeEvent, probeCombo } from "../extension/key-probe";
import {
  BOOKMARK_ANCHORS,
  BOOKMARK_MARGIN,
  comboFromEvent,
  defaultBookmarkConfig,
  easeInOutQuad,
  jumpFields,
  jumpOffset,
  jumpScale,
  parseBookmarkConfig,
  sortBookmarks,
  suggestFreeCombo,
  type BookmarkConfig,
  type BookmarkJump,
  type DockSpot,
  type KeyOwner,
  type ScreenBox,
} from "../extension/bookmarks";

const BookmarkWidget = defineAsyncComponent(() => import("../components/bookmark/BookmarkWidget.vue"));

/** The node type name. Frontend-only: nothing on the Python side. */
export const BOOKMARK_NODE_TYPE = "WP_Bookmark";
const WIDGET_NAME = "wp_bookmark";
const DEFAULT_TITLE = "Bookmark";
const TITLE_H = 30;
const JUMP_MS = 280;
const HISTORY_MAX = 30;

export interface BookmarkNode extends MountTargetNode {
  id: number | string;
  type?: string;
  title: string;
  pos: [number, number] | number[];
  size: [number, number] | number[];
  mode?: number;
  color?: string | undefined;
  graph?: LiteGraphLike | null;
  widgets?: { name?: string; value?: unknown }[];
  boundingRect?: ArrayLike<number>;
  setDirtyCanvas?: (fg: boolean, bg?: boolean) => void;
}

interface CanvasLike {
  graph?: LiteGraphLike | null;
  ds?: { offset: number[]; scale: number; getViewportSize?: () => [number, number] };
  canvas?: HTMLCanvasElement;
  graph_mouse?: number[];
  setGraph?: (graph: LiteGraphLike) => void;
  deselect?: (item: unknown) => void;
  setDirty?: (fg: boolean, bg?: boolean) => void;
}

function canvasOf(): CanvasLike | undefined {
  return (app as unknown as { canvas?: CanvasLike }).canvas;
}

/** The canvas element, for measuring the free part of it. */
export function canvasElement(): HTMLCanvasElement | undefined {
  return canvasOf()?.canvas;
}

/** The canvas zoom right now ("use the zoom you're at"). */
export function currentZoom(): number {
  return canvasOf()?.ds?.scale ?? 1;
}

function rootGraph(): LiteGraphLike | undefined {
  return (app as unknown as { graph?: LiteGraphLike }).graph;
}

// ── config cells ──────────────────────────────────────────────────────

/** Change listeners: the dock re-reads when any bookmark changes. */
const listeners = new Set<() => void>();
export function onBookmarksChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  for (const fn of [...listeners]) fn();
}
/** A note's bookmark settings changed: re-read the dock. */
export const bookmarksChanged = notify;

/** A WP Bookmark node, or a WP Note with its Bookmark switch on. */
export function isBookmark(node: unknown): node is BookmarkNode {
  if (!node || typeof node !== "object") return false;
  const cell = bookmarkCells.get(node);
  if (cell?.kind === "note") return cell.get() != null;
  return (node as { type?: string }).type === BOOKMARK_NODE_TYPE;
}

/** A note bookmark rather than a WP Bookmark node. */
export function isNoteBookmark(node: unknown): boolean {
  return !!node && typeof node === "object" && bookmarkCells.get(node)?.kind === "note";
}

export function readConfig(node: BookmarkNode): BookmarkConfig {
  const cell = bookmarkCells.get(node);
  const got = cell?.get() as BookmarkConfig | null | undefined;
  if (got) return got;
  if (cell) return defaultBookmarkConfig();
  return parseBookmarkConfig(node.widgets?.find((w) => w.name === WIDGET_NAME)?.value);
}

export function writeConfig(node: BookmarkNode, next: BookmarkConfig): void {
  bookmarkCells.get(node)?.set(next);
}

/** Muted or bypassed: the bookmark is off (its shortcut does nothing and the
 *  dock greys it), the same way muting a node switches it off. */
export function isDisabled(node: BookmarkNode): boolean {
  return node.mode === MODE_NEVER || node.mode === MODE_BYPASS;
}

export interface BookmarkEntry {
  node: BookmarkNode;
  graph: LiteGraphLike;
  title: string;
  config: BookmarkConfig;
  disabled: boolean;
  /** Inside a subgraph rather than on the root graph. */
  nested: boolean;
  /** A WP Note that is also a bookmark: always shown on the canvas. */
  kind: "node" | "note";
}

/** Every bookmark in the workflow, subgraphs included, in dock order. */
export function listBookmarks(): BookmarkEntry[] {
  const root = rootGraph();
  if (!root) return [];
  const out: BookmarkEntry[] = [];
  for (const { graph, node } of walkAllNodes(root)) {
    if (!isBookmark(node)) continue;
    out.push({
      node,
      graph,
      title: node.title || (isNoteBookmark(node) ? "WP Note" : DEFAULT_TITLE),
      config: readConfig(node),
      disabled: isDisabled(node),
      nested: graph !== root,
      kind: isNoteBookmark(node) ? "note" : "node",
    });
  }
  return sortBookmarks(out);
}

/** The other bookmarks' shortcuts, as keymap owners. */
function bookmarkOwners(except?: BookmarkNode): KeyOwner[] {
  return listBookmarks()
    .filter((b) => b.node !== except && b.config.shortcut)
    .map((b) => ({ combo: b.config.shortcut, label: `jump to ${b.title}`, source: b.kind === "note" ? "WP Note bookmark" : "WP Bookmark" }));
}

// Keys another extension took when a bookmark's key was pressed. That kind
// of clash can't be seen ahead (the extension reads keydown itself), so it is
// remembered once seen: the clash check flags it and Suggest skips it.
const TAKEN_KEY = "wp.bookmarkTakenKeys";
export function takenKeys(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TAKEN_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}
function rememberTaken(combo: string): void {
  const list = takenKeys();
  if (list.includes(combo)) return;
  try {
    localStorage.setItem(TAKEN_KEY, JSON.stringify([...list, combo].slice(-50)));
  } catch {
    // Storage blocked: the toast still said so this time.
  }
}

/** Everyone else holding a key, for `node`'s conflict check. */
export function keymapFor(node?: BookmarkNode): KeyOwner[] {
  const learned = takenKeys().map((combo) => ({
    combo,
    label: "something on this page answers this key (another extension)",
    source: "checked on this page",
  }));
  return [...liveKeymap(app as unknown as KeymapAppLike, bookmarkOwners(node)), ...learned];
}

/**
 * Ask the page whether anything answers `combo` (see key-probe.ts) and
 * remember it when something does, so the clash check lists it from then
 * on. The probe is sent where a real press lands: the canvas.
 */
export function checkCombo(combo: string): boolean {
  if (!combo) return false;
  const taken = probeCombo(combo, canvasElement() ?? null);
  // A key ComfyUI's keymap already names needs no second line.
  if (taken && !liveKeymap(app as unknown as KeymapAppLike, []).some((o) => o.combo === combo)) rememberTaken(combo);
  return taken;
}

/** A free shortcut for `node`: the first suggestion no keymap owner holds
 *  and nothing on the page answers. `skip` is a key not to offer (the one it
 *  has). "" when none is left. */
export function suggestShortcut(node?: BookmarkNode, skip = ""): string {
  const owners = keymapFor(node);
  if (skip) owners.push({ combo: skip, label: "", source: "" });
  for (let tries = 0; tries < 40; tries++) {
    const combo = suggestFreeCombo(owners);
    if (!combo || !checkCombo(combo)) return combo;
    owners.push({ combo, label: "", source: "" });
  }
  return "";
}

// ── jumping ───────────────────────────────────────────────────────────

interface View { graph: LiteGraphLike | null | undefined; offset: [number, number]; scale: number }
const history: View[] = [];
let lastJumped: BookmarkNode | null = null;
let animFrame = 0;

function reducedMotion(): boolean {
  if (document.body?.classList.contains("wp-a11y-no-motion")) return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function viewportSize(c: CanvasLike): [number, number] {
  const v = c.ds?.getViewportSize?.();
  if (v && v[0] > 0 && v[1] > 0) return v;
  const el = c.canvas;
  return [el?.clientWidth || 1280, el?.clientHeight || 800];
}

/** Tween the view to `offset` / `scale`. A new jump cancels a running one. */
function animateView(c: CanvasLike, offset: [number, number], scale: number): void {
  const ds = c.ds;
  if (!ds) return;
  cancelAnimationFrame(animFrame);
  if (reducedMotion()) {
    ds.offset[0] = offset[0];
    ds.offset[1] = offset[1];
    ds.scale = scale;
    c.setDirty?.(true, true);
    return;
  }
  const from = { x: ds.offset[0] ?? 0, y: ds.offset[1] ?? 0, s: ds.scale };
  const [vw, vh] = viewportSize(c);
  // Tween the screen centre's canvas point and the scale, not the raw
  // offset, so a zoom change doesn't swing out and back.
  const fromCx = vw / 2 / from.s - from.x;
  const fromCy = vh / 2 / from.s - from.y;
  const toCx = vw / 2 / scale - offset[0];
  const toCy = vh / 2 / scale - offset[1];
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / JUMP_MS);
    const e = easeInOutQuad(t);
    const s = from.s * Math.pow(scale / from.s, e);
    const cx = fromCx + (toCx - fromCx) * e;
    const cy = fromCy + (toCy - fromCy) * e;
    ds.scale = s;
    ds.offset[0] = vw / 2 / s - cx;
    ds.offset[1] = vh / 2 / s - cy;
    c.setDirty?.(true, true);
    if (t < 1) animFrame = requestAnimationFrame(step);
  };
  animFrame = requestAnimationFrame(step);
}

// ── the free part of the canvas ───────────────────────────────────────

/** Not the host's chrome, so never a bar or a box to keep clear of: nodes'
 *  DOM widgets, the Vue renderer's nodes, our own dock and toasts,
 *  ComfyUI's selection toolbox and ComfyUI's toasts. The toolbox floats over
 *  the selected node and moves with it, so keeping a jump clear of it pushed
 *  a selected bookmark further down on every press. A toast (the reka
 *  viewport, or PrimeVue's on older frontends) comes and goes, and read as a
 *  bar it moved the dock and the jump spot while it showed. */
const GRAPH_CONTENT = ".dom-widget, [data-node-id], .lg-node, .wp-widget, #wp-bookmark-dock-root, .wp-toast-stack, "
  + ".selection-toolbox, [data-testid=\"selection-toolbox\"], .selection-overlay-container, "
  + "[data-testid=\"toast-viewport\"], [data-testid=\"toast\"], .p-toast";

/** True when nothing but the graph (or one of `skip`) covers this screen
 *  point. */
function isFreeAt(canvasEl: Element, x: number, y: number, skip: readonly Element[] = []): boolean {
  if (typeof document.elementsFromPoint !== "function") return true;
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === canvasEl) return true;
    if (el.closest(GRAPH_CONTENT)) continue;
    if (skip.some((s) => s.contains(el))) continue;
    return false;
  }
  return true;
}

/** ComfyUI's pane for the canvas: what the side panel and the bottom panel
 *  (console, shortcuts) leave, below the floating toolbar. */
const CANVAS_PANEL = "#graph-canvas-panel";

function visible(el: Element): boolean {
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
}

/**
 * The host's floating pieces inside the canvas pane (the minimap, the zoom
 * controls, the selection toolbox): the first element down each branch that
 * takes the pointer and has a size. Containers that let clicks through
 * (`pointer-events: none`) are looked into, not counted; graph content is
 * skipped.
 */
function paneOverlays(pane: Element): Element[] {
  const out: Element[] = [];
  const look = (el: Element, depth: number): void => {
    for (const child of Array.from(el.children)) {
      if (child.matches(GRAPH_CONTENT) || !visible(child)) continue;
      const r = child.getBoundingClientRect();
      if (getComputedStyle(child).pointerEvents !== "none" && r.width > 0 && r.height > 0) out.push(child);
      else if (depth < 6) look(child, depth + 1);
    }
  };
  look(pane, 0);
  return out;
}

/** The free part of the canvas, in page px. */
export interface FreeArea {
  /** `[left, top, right, bottom]` of what the host's bars and panels leave. */
  free: ScreenBox;
  /** Floating boxes inside it to keep clear of (minimap, zoom controls). */
  avoid: ScreenBox[];
}

/**
 * Where bookmarks land and the dock sits. ComfyUI's canvas pane gives what
 * the side panel, the bottom panel and the floating toolbar leave, and moves
 * with them; inside it the minimap and zoom controls float and are boxes to
 * keep clear of. Bars the pane doesn't know (another extension's toolbar, an
 * older frontend without the pane) are found by walking in from each edge
 * with `elementsFromPoint` until bare canvas.
 */
export function freeArea(canvasEl: Element | undefined): FreeArea {
  if (!canvasEl) return { free: [0, 0, 0, 0], avoid: [] };
  const r = canvasEl.getBoundingClientRect();
  const pane = document.querySelector(CANVAS_PANEL);
  const p = pane?.getBoundingClientRect();
  const usable = p && p.width > 40 && p.height > 40;
  const base = {
    left: usable ? Math.max(r.left, p.left) : r.left,
    top: usable ? Math.max(r.top, p.top) : r.top,
    right: usable ? Math.min(r.right, p.right) : r.right,
    bottom: usable ? Math.min(r.bottom, p.bottom) : r.bottom,
  };
  const overlays = usable && pane ? paneOverlays(pane) : [];
  const [il, it, ir, ib] = walkInsets(canvasEl, base, overlays);
  const box = (el: Element): ScreenBox => {
    const b = el.getBoundingClientRect();
    return [b.left, b.top, b.right, b.bottom];
  };
  return {
    free: [base.left + il, base.top + it, base.right - ir, base.bottom - ib],
    avoid: overlays.map(box),
  };
}

/**
 * How far the host's bars reach into the canvas from each edge, in screen
 * px: `[left, top, right, bottom]`. Kept for callers that only want the
 * insets; the minimap and other floating boxes are not in it.
 */
export function freeInsets(canvasEl: Element | undefined): [number, number, number, number] {
  if (!canvasEl) return [0, 0, 0, 0];
  const r = canvasEl.getBoundingClientRect();
  const { free } = freeArea(canvasEl);
  return [free[0] - r.left, free[1] - r.top, r.right - free[2], r.bottom - free[3]];
}

/** Walks in from each edge of `base` to the deepest covered point (see
 *  `freeArea`). */
function walkInsets(
  canvasEl: Element,
  r: { left: number; top: number; right: number; bottom: number },
  skip: readonly Element[],
): [number, number, number, number] {
  const width = r.right - r.left;
  const height = r.bottom - r.top;
  if (width <= 0 || height <= 0) return [0, 0, 0, 0];
  const STEP = 6;
  // Walk in from the edge along `dir` across a band (25 % of the side) and
  // return how far the deepest covered point reaches. Not the first free
  // point: bars stack with gaps of bare canvas between them (the tab strip,
  // then a floating toolbar a few px below it). A band with nothing free at
  // all is something filling the canvas, not a bar: count it as 0.
  const walk = (x0: number, y0: number, dx: number, dy: number, limit: number): number => {
    let deepest = 0;
    let free = false;
    for (let d = 0; d <= limit; d += STEP) {
      if (isFreeAt(canvasEl, x0 + dx * d, y0 + dy * d, skip)) free = true;
      else deepest = d + STEP;
    }
    return free ? deepest : 0;
  };
  const along = (fracs: number[], len: number, start: number): number[] => fracs.map((f) => start + f * len);
  const left = Math.max(...along([0.3, 0.5, 0.7], height, r.top).map((y) => walk(r.left + 1, y, 1, 0, width * 0.25)));
  const right = Math.max(...along([0.3, 0.5, 0.7], height, r.top).map((y) => walk(r.right - 1, y, -1, 0, width * 0.25)));
  const top = Math.max(...along([0.06, 0.3, 0.5, 0.7, 0.94], width, r.left).map((x) => walk(x, r.top + 1, 0, 1, height * 0.25)));
  const bottom = Math.max(...along([0.06, 0.3, 0.5, 0.7, 0.94], width, r.left).map((x) => walk(x, r.bottom - 1, 0, -1, height * 0.25)));
  return [left, top, right, bottom];
}

/** The open dock as a box to keep bookmarks out from under, relative to the
 *  canvas element. */
function dockBoxes(c: CanvasLike): ScreenBox[] {
  const dock = document.querySelector<HTMLElement>('[data-test="bm-dock"]');
  const el = c.canvas;
  if (!dock || !el) return [];
  const d = dock.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (d.width <= 0 || d.height <= 0) return [];
  return [[d.left - r.left, d.top - r.top, d.right - r.left, d.bottom - r.top]];
}

function currentView(c: CanvasLike): View {
  return { graph: c.graph, offset: [c.ds?.offset[0] ?? 0, c.ds?.offset[1] ?? 0], scale: c.ds?.scale ?? 1 };
}

/** Show `graph` on the canvas, then run `then` once ComfyUI has restored
 *  the viewport it keeps for that graph (a tick later), or the restore
 *  would pan straight back. */
function showGraph(c: CanvasLike, graph: LiteGraphLike | null | undefined, then: () => void): void {
  if (!graph || c.graph === graph || typeof c.setGraph !== "function") {
    then();
    return;
  }
  c.setGraph(graph);
  setTimeout(then, 50);
}

function nodeRect(node: BookmarkNode): [number, number, number, number] {
  const b = node.boundingRect;
  if (b && b.length >= 4) return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
  const [x = 0, y = 0] = node.pos;
  const [w = 0, h = 0] = node.size;
  return [x, y - TITLE_H, w, h + TITLE_H];
}

/** Jump to a bookmark: open its graph, then move it to its anchor at its
 *  zoom. The view before the jump goes on the Back stack. */
export function jumpTo(node: BookmarkNode): void {
  const c = canvasOf();
  if (!c?.ds) return;
  history.push(currentView(c));
  if (history.length > HISTORY_MAX) history.shift();
  lastJumped = node;
  showGraph(c, node.graph, () => {
    if (!c.ds) return;
    const config = readConfig(node);
    const scale = jumpScale(config, c.ds.scale);
    const cr = c.canvas?.getBoundingClientRect();
    const area = freeArea(c.canvas);
    const rel = (b: ScreenBox): ScreenBox => [b[0] - (cr?.left ?? 0), b[1] - (cr?.top ?? 0), b[2] - (cr?.left ?? 0), b[3] - (cr?.top ?? 0)];
    const [vw, vh] = viewportSize(c);
    const free = rel(area.free);
    const offset = jumpOffset({
      rect: nodeRect(node),
      viewport: viewportSize(c),
      anchor: config.anchor,
      scale,
      margin: BOOKMARK_MARGIN,
      inset: [free[0], free[1], Math.max(0, vw - free[2]), Math.max(0, vh - free[3])],
      avoid: [...area.avoid.map(rel), ...(readDockPrefs().clearDock ? dockBoxes(c) : [])],
      view: config.view,
    });
    animateView(c, offset, scale);
  });
  notify();
}

/** Back to the view before the last jump. */
export function jumpBack(): boolean {
  const c = canvasOf();
  const view = history.pop();
  if (!c || !view) return false;
  showGraph(c, view.graph, () => animateView(c, view.offset, view.scale));
  return true;
}

export function canGoBack(): boolean {
  return history.length > 0;
}

/** Step through the bookmarks that are on, in dock order. */
export function jumpStep(dir: 1 | -1): void {
  const list = listBookmarks().filter((b) => !b.disabled);
  if (!list.length) return;
  const at = list.findIndex((b) => b.node === lastJumped);
  const next = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
  const target = list[next];
  if (target) jumpTo(target.node);
}

export function lastJumpedNode(): BookmarkNode | null {
  return lastJumped;
}

// ── hidden bookmarks ──────────────────────────────────────────────────

export function isHiddenBookmark(node: unknown): boolean {
  return isBookmark(node) && readConfig(node).hidden;
}

let hiddenStyle: HTMLStyleElement | null = null;
let hiddenCss = "";

/** The Vue node renderer draws nodes as DOM; hide those by id. Only the
 *  graph on screen is rendered, so its ids are enough. */
function syncHiddenStyle(nodes: readonly unknown[]): void {
  const ids = nodes.filter(isHiddenBookmark).map((n) => String((n as BookmarkNode).id));
  // A quoted attribute value only needs its backslashes and quotes escaped.
  const css = ids
    .map((id) => `[data-node-id="${id.replace(/["\\]/g, "\\$&")}"]{display:none!important}`)
    .join("\n");
  if (css === hiddenCss) return;
  hiddenCss = css;
  if (!hiddenStyle) {
    hiddenStyle = document.createElement("style");
    hiddenStyle.id = "wp-bookmark-hidden";
    document.head.appendChild(hiddenStyle);
  }
  hiddenStyle.textContent = css;
}

/**
 * Leaves hidden bookmarks out of the nodes the canvas draws. LiteGraph also
 * hit-tests against that list, so a hidden bookmark can't be clicked,
 * dragged or hovered either; its DOM widget hides because ComfyUI shows a
 * node's widgets only while the node is in the list. Wraps the prototype
 * method and calls the original, so other extensions' wraps still run.
 */
export function installHiddenFilter(): void {
  const c = canvasOf() as unknown as { constructor?: { prototype?: Record<string, unknown> } } | undefined;
  const proto = c?.constructor?.prototype as
    | { computeVisibleNodes?: (...a: unknown[]) => unknown[] }
    | undefined;
  const original = proto?.computeVisibleNodes;
  if (!proto || typeof original !== "function" || hiddenFilterInstalled.has(proto)) return;
  hiddenFilterInstalled.add(proto);
  proto.computeVisibleNodes = function (this: { graph?: LiteGraphLike }, ...args: unknown[]) {
    const out = original.apply(this, args);
    if (Array.isArray(out)) {
      let w = 0;
      for (const n of out) if (!isHiddenBookmark(n)) out[w++] = n;
      out.length = w;
    }
    syncHiddenStyle(this.graph?._nodes ?? []);
    return out;
  };
}
const hiddenFilterInstalled = new WeakSet<object>();

/** Show or hide a bookmark on the canvas (the dock's eye button). */
export function setHidden(node: BookmarkNode, hidden: boolean): void {
  // A note is there to be read: it never hides.
  if (isNoteBookmark(node)) return;
  writeConfig(node, { ...readConfig(node), hidden });
  if (hidden) canvasOf()?.deselect?.(node);
  canvasOf()?.setDirty?.(true, true);
}

/** Save a new dock order (the dock's drag). */
export function setOrder(nodes: readonly BookmarkNode[]): void {
  nodes.forEach((n, i) => {
    const cfg = readConfig(n);
    if (cfg.order !== i) writeConfig(n, { ...cfg, order: i });
  });
}

// ── shortcuts ─────────────────────────────────────────────────────────

/** True while a bookmark's shortcut field is recording a key. */
let recording = 0;
export function setRecording(on: boolean): void {
  recording = Math.max(0, recording + (on ? 1 : -1));
}

const warnedCombos = new Set<string>();

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="dialog"], .graphdialog');
}

function bookmarkForKey(e: KeyboardEvent): { combo: string; hit: BookmarkEntry } | null {
  if (e.repeat || recording > 0 || isProbeEvent(e) || isTyping(e.target)) return null;
  const combo = comboFromEvent(e);
  if (!combo) return null;
  const hit = listBookmarks().find((b) => !b.disabled && b.config.shortcut === combo);
  return hit ? { combo, hit } : null;
}

function warnTaken(combo: string, title: string): void {
  rememberTaken(combo);
  if (warnedCombos.has(combo)) return;
  warnedCombos.add(combo);
  pushToast(`${combo} is also used by another shortcut, so "${title}" didn't jump. Give the bookmark another key.`, {
    severity: "warning",
    singletonKey: `wp-bookmark-clash-${combo}`,
  });
}

/** The press seen on the way down (capture), until the bubble phase
 *  reaches the window. */
let pending: KeyboardEvent | null = null;

function onKeyDownCapture(e: KeyboardEvent): void {
  const found = bookmarkForKey(e);
  if (!found) return;
  pending = e;
  // Still pending after this event: someone stopped it on the way up.
  setTimeout(() => {
    if (pending !== e) return;
    pending = null;
    warnTaken(found.combo, found.hit.title);
  }, 0);
}

/**
 * One listener for every bookmark. Runs on `window` in the bubble phase, so
 * ComfyUI's keybindings and any extension listening earlier get the key
 * first. When one of them already used it (`defaultPrevented`, or stopped
 * it before it got here, which the capture listener notices), the bookmark
 * stands down, says once which combo collided and remembers it as taken:
 * that is how a clash with an extension the keymap can't see shows up.
 */
function onKeyDown(e: KeyboardEvent): void {
  if (pending === e) pending = null;
  const found = bookmarkForKey(e);
  if (!found) return;
  if (e.defaultPrevented) {
    warnTaken(found.combo, found.hit.title);
    return;
  }
  e.preventDefault();
  jumpTo(found.hit.node);
}

let keysInstalled = false;
export function installBookmarkKeys(): void {
  if (keysInstalled || typeof window === "undefined") return;
  keysInstalled = true;
  window.addEventListener("keydown", onKeyDownCapture, true);
  window.addEventListener("keydown", onKeyDown);
}

// ── creating ──────────────────────────────────────────────────────────

interface LiteGraphStatic {
  NO_TITLE?: number;
  LGraphNode?: new (title?: string) => BookmarkNode;
  registerNodeType?: (type: string, ctor: unknown) => void;
  createNode?: (type: string) => BookmarkNode | null;
}

function liteGraph(): LiteGraphStatic | undefined {
  return (globalThis as { LiteGraph?: LiteGraphStatic }).LiteGraph;
}

/** Jump settings for a WP Note whose Bookmark switch just went on: last in
 *  the dock, a free shortcut. */
export function freshJump(node: object): BookmarkJump {
  return jumpFields(freshConfig(node as BookmarkNode));
}

/** A note's Bookmark switch went on: the dock may open itself. */
export function noteBookmarkAdded(): void {
  notify();
  bookmarkAdded?.();
}

/** Fresh config for a new bookmark: last in the dock, a free shortcut. */
function freshConfig(node: BookmarkNode, scale?: number): BookmarkConfig {
  const others = listBookmarks().filter((b) => b.node !== node);
  return {
    ...defaultBookmarkConfig(),
    order: others.reduce((m, b) => Math.max(m, b.config.order + 1), 0),
    shortcut: suggestShortcut(node),
    ...(scale ? { zoom: Math.round(scale * 100) / 100 } : {}),
  };
}

/**
 * Bookmark the current view: a new bookmark at the top-left of the screen
 * with today's zoom, so jumping to it brings this exact view back. With
 * `at` (a right-click on the canvas) it goes there instead.
 */
export function addBookmarkHere(at?: readonly number[]): void {
  const c = canvasOf();
  const graph = c?.graph as (LiteGraphLike & { add?: (n: unknown) => void }) | undefined;
  const node = liteGraph()?.createNode?.(BOOKMARK_NODE_TYPE);
  if (!c?.ds || !graph?.add || !node) return;
  const s = c.ds.scale;
  const x = at?.[0] ?? -(c.ds.offset[0] ?? 0) + BOOKMARK_MARGIN / s;
  const y = at?.[1] ?? -(c.ds.offset[1] ?? 0) + BOOKMARK_MARGIN / s + TITLE_H;
  node.pos = [Math.round(x), Math.round(y)];
  graph.add(node);
  writeConfig(node, freshConfig(node, s));
  c.setDirty?.(true, true);
}

// ── the widget ────────────────────────────────────────────────────────

/** Called once a bookmark joins a graph (added or loaded), so the dock can
 *  open itself. ComfyUI's `nodeCreated` hook doesn't fire for node types
 *  registered straight with LiteGraph, so the node reports it. */
let bookmarkAdded: (() => void) | null = null;
/** Opens or closes a bookmark's form (double-click on the node). */
const bookmarkEditors = new WeakMap<object, (on: boolean) => void>();
export function onBookmarkAdded(fn: () => void): void {
  bookmarkAdded = fn;
}

/** The canvas point in the middle of the free screen now: what "Use this
 *  view" stores and a jump to it centres again. */
export function currentViewPoint(): { x: number; y: number } {
  const c = canvasOf();
  if (!c?.ds) return { x: 0, y: 0 };
  const [vw, vh] = viewportSize(c);
  const [il, it, ir, ib] = freeInsets(c.canvas);
  const s = c.ds.scale;
  const cx = il + (vw - il - ir) / 2;
  const cy = it + (vh - it - ib) / 2;
  return { x: Math.round(cx / s - (c.ds.offset[0] ?? 0)), y: Math.round(cy / s - (c.ds.offset[1] ?? 0)) };
}

/** The narrowest the editor card gets. */
const FORM_WIDTH = 340;

// Double-click in Nodes 2.0: the pill lets the pointer through, so the node
// never gets LiteGraph's onDblClick there; hit-test the pills instead.
interface EditTarget { panel(): HTMLElement | null; edit(): void }
const editTargets = new Set<EditTarget>();
let dblWired = false;
function wireDblClick(): void {
  if (dblWired || typeof document === "undefined") return;
  dblWired = true;
  document.addEventListener("dblclick", (e) => {
    if (!isVueNodes()) return;
    const hit = panelAt(editTargets, e.clientX, e.clientY);
    if (!hit) return;
    e.stopPropagation();
    hit.edit();
  }, true);
}

/** Mounts the bookmark's one widget. Its value is the JSON BookmarkConfig. */
export function mountBookmark(node: BookmarkNode & FramelessNode) {
  const config = ref<BookmarkConfig>(defaultBookmarkConfig());
  // A saved bookmark shows its read view; a brand-new one opens the form.
  const editing = ref(false);
  let restored = false;
  bookmarkEditors.set(node, (on) => setEditing(on));

  function apply(next: BookmarkConfig): void {
    config.value = next;
    host.setValue(serializeWidgetJson(next));
    node.setDirtyCanvas?.(true, true);
    fit();
    notify();
  }
  bookmarkCells.set(node, { get: () => config.value, set: (next) => apply(next as BookmarkConfig) });

  const wrapper: Component = {
    setup() {
      const graphNode = node as unknown as Parameters<typeof reactiveFromGraph>[0];
      const title = reactiveFromGraph(graphNode, () => node.title, Object.is);
      const disabled = reactiveFromGraph(graphNode, () => isDisabled(node), Object.is);
      const pinned = reactiveFromGraph(graphNode, () => node.flags?.pinned === true, Object.is);
      const selected = reactiveFromGraph(graphNode, () => (node as { selected?: boolean }).selected === true, Object.is, 150);
      function onTitle(next: string): void {
        node.title = next;
        title.value = next;
        node.setDirtyCanvas?.(true, true);
        fit();
        notify();
      }
      function onPinned(next: boolean): void {
        setPinned(node, next);
        pinned.value = next;
      }
      return () => h(BookmarkWidget, {
        config: config.value,
        title: title.value,
        disabled: disabled.value,
        nested: !!node.graph && node.graph !== rootGraph(),
        pinned: pinned.value,
        selected: selected.value,
        getKeymap: () => keymapFor(node),
        getZoom: currentZoom,
        getView: currentViewPoint,
        editing: editing.value,
        "onUpdate:editing": setEditing,
        "onUpdate:config": apply,
        "onUpdate:title": onTitle,
        "onUpdate:pinned": onPinned,
        onRecording: setRecording,
        onJump: () => jumpTo(node),
      });
    },
  };

  const host = createDomWidgetHost(node, WIDGET_NAME, wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 30,
    minWidth: () => (editing.value ? FORM_WIDTH : 60),
    ownSize: true,
    margin: 0,
    onValueRestored: (raw: string) => {
      restored = true;
      config.value = parseBookmarkConfig(raw);
      setEditing(false);
      notify();
    },
  });
  // The node is exactly its panel: the pill's own width, or the card at the
  // user's width (never under the form's).
  const fit = sizeToPanel(
    node,
    host,
    () => host.element.querySelector<HTMLElement>(editing.value ? ".wp-bm__form" : ".wp-bm__pill"),
    () => (editing.value ? FORM_WIDTH : 60),
    () => !editing.value,
  );
  keepPassThrough(node, host);
  wireDblClick();
  const editTarget: EditTarget = {
    panel: () => (editing.value ? null : host.element.querySelector<HTMLElement>(".wp-bm__pill")),
    edit: () => setEditing(true),
  };
  editTargets.add(editTarget);
  host.onCleanup(() => editTargets.delete(editTarget));

  function setEditing(on: boolean): void {
    editing.value = on;
    fit();
  }

  // Nothing restored by the next tick: the user just added this bookmark.
  setTimeout(() => {
    if (!restored && node.graph) {
      apply(freshConfig(node));
      setEditing(true);
    }
    if (node.graph) bookmarkAdded?.();
  }, 0);
  return host;
}

/**
 * Registers WP Bookmark: a frontend-only node like ComfyUI's Note. Virtual,
 * so it never runs and is left out of the prompt; its settings are saved
 * with the workflow. Frameless like WP Note: no title bar or node box, the
 * node is its pill (or, while editing, its editor card).
 */
export function registerBookmarkNode(): void {
  publishTitleHeight();
  const lg = liteGraph();
  const Base = lg?.LGraphNode;
  if (!lg?.registerNodeType || !Base) return;

  class WPBookmarkNode extends Base {
    static title = "WP Bookmark";
    static category = "wildcard-pipeline";
    // No title bar and no node box: the bookmark draws its own panel.
    static title_mode = lg?.NO_TITLE ?? 1;
    // The widget starts at the node's top edge, not 2 px under it.
    widgets_start_y = 0;
    isVirtualNode = true;
    serialize_widgets = true;
    collapsable = false;

    get renderingBgColor(): string {
      return "transparent";
    }

    // The bookmark sizes itself to its pill or form: no resize handles,
    // ever (LiteGraph turns `resizable` back on when a node is unpinned).
    get resizable(): boolean {
      return false;
    }
    set resizable(_on: boolean) {}

    // ComfyUI's source badge would float over the panel.
    drawBadges(): void {}

    // The panel is the whole node: a press on it drags, selects or
    // double-clicks the node rather than going to the widget.
    getWidgetOnPos(): undefined {
      return undefined;
    }

    constructor(title?: string) {
      super(title ?? DEFAULT_TITLE);
      mountBookmark(this as unknown as BookmarkNode & FramelessNode);
      this.size = [FORM_WIDTH, 40];
    }

    // A hidden bookmark can still get caught by Select all or a box
    // select; drop it again so Delete can't remove what nobody sees.
    onSelected(): void {
      if (readConfig(this).hidden) canvasOf()?.deselect?.(this);
    }

    // Double-click anywhere on the node opens its form (Classic; Nodes 2.0
    // goes through wireDblClick).
    onDblClick(): void {
      bookmarkEditors.get(this)?.(true);
    }

    onRemoved(): void {
      if (lastJumped === this) lastJumped = null;
      notify();
    }
  }
  lg.registerNodeType(BOOKMARK_NODE_TYPE, WPBookmarkNode);
}

// ── dock preferences ──────────────────────────────────────────────────

export interface DockPrefs {
  /** null: open by itself when the workflow has bookmarks. */
  open: boolean | null;
  collapsed: boolean;
  /** Which of the 3×3 spots of the free canvas it sits in (it snaps to the
   *  nearest one when dragged), so it moves with the side and bottom
   *  panels. */
  spot: DockSpot;
  /** Jumps keep bookmarks out from under the open dock (on), or land where
   *  they would without it, behind the dock (off). */
  clearDock: boolean;
}

const DOCK_KEY = "wp.bookmarkDock";

/** Per-viewer convenience, so browser storage (and fine when it's gone). */
export function readDockPrefs(): DockPrefs {
  const base: DockPrefs = { open: null, collapsed: false, spot: "tl", clearDock: true };
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_KEY) ?? "null") as (Partial<DockPrefs> & { side?: unknown }) | null;
    if (!raw || typeof raw !== "object") return base;
    // Before spots it had a side.
    const spot = BOOKMARK_ANCHORS.find((a) => a.id === raw.spot)?.id ?? (raw.side === "right" ? "tr" : "tl");
    return {
      open: typeof raw.open === "boolean" ? raw.open : null,
      collapsed: raw.collapsed === true,
      spot,
      clearDock: raw.clearDock !== false,
    };
  } catch {
    return base;
  }
}

/** What moves the dock when it changes: the canvas pane's box and the
 *  floating pieces in it (the minimap shown or hidden). Cheap: no
 *  `elementsFromPoint`. */
export function dockLayoutKey(): string {
  const pane = document.querySelector(CANVAS_PANEL);
  if (!pane) return `${window.innerWidth}x${window.innerHeight}`;
  const rect = (el: Element): string => {
    const b = el.getBoundingClientRect();
    return [b.left, b.top, b.right, b.bottom].map(Math.round).join(",");
  };
  return [rect(pane), ...paneOverlays(pane).map(rect)].join(";");
}

export function writeDockPrefs(next: DockPrefs): void {
  try {
    localStorage.setItem(DOCK_KEY, JSON.stringify(next));
  } catch {
    // Private window or blocked storage: the dock just forgets.
  }
}

/** Should the dock show itself now (a workflow with bookmarks loaded)? */
export function dockWantsAutoOpen(): boolean {
  return readDockPrefs().open !== false && listBookmarks().length > 0;
}
