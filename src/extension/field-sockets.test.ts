import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachFieldSockets, type FieldSocketNode } from "./field-sockets";

type G = { LiteGraph?: { vueNodesMode?: boolean; NODE_SLOT_HEIGHT?: number }; app?: unknown };
const g = globalThis as G;

/** Give `el` a laid-out box at `top` with `height` (jsdom lays out nothing). */
function place(el: HTMLElement, top: number, height: number, left = 0, width = 100): void {
  const rect = { top, height, left, width, bottom: top + height, right: left + width, x: left, y: top, toJSON: () => ({}) };
  el.getBoundingClientRect = () => rect as DOMRect;
  el.getClientRects = () => [rect] as unknown as DOMRectList;
}

function flushFrames(): void {
  vi.runOnlyPendingTimers();
  vi.runOnlyPendingTimers();
}

function panel(): { root: HTMLElement; title: HTMLElement } {
  const root = document.createElement("div");
  const title = document.createElement("div");
  title.dataset.wpSocket = "title";
  root.appendChild(title);
  place(root, 100, 300);
  place(title, 200, 20);
  return { root, title };
}

const ins = (n: FieldSocketNode): NonNullable<FieldSocketNode["inputs"]> => n.inputs ?? [];
const teardowns: (() => void)[] = [];
function attach(...args: Parameters<typeof attachFieldSockets>): () => void {
  const off = attachFieldSockets(...args);
  teardowns.push(off);
  return off;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  g.LiteGraph = { vueNodesMode: false, NODE_SLOT_HEIGHT: 20 };
  g.app = { canvas: { ds: { scale: 1 } } };
});

afterEach(async () => {
  for (const off of teardowns.splice(0)) off();
  document.body.innerHTML = "";
  // Let the observer's queued frame run so the next test starts clean.
  await Promise.resolve();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete g.LiteGraph;
  delete g.app;
  document.body.innerHTML = "";
});

describe("attachFieldSockets — legacy canvas", () => {
  it("binds a socket-only input to a stand-in widget level with its field", () => {
    const { root } = panel();
    document.body.appendChild(root);
    const node: FieldSocketNode = {
      graph: {},
      inputs: [{ name: "images", link: null }, { name: "title", link: null }],
      widgets: [{ name: "wp_label_grid", y: 40, margin: 10 }],
    };
    attach(node, root, "wp_label_grid", ["title"]);
    flushFrames();
    const slot = ins(node)[1];
    expect(slot.widget).toEqual({ name: "title" });
    // field centre 110 below the panel top; widget y 40 + margin 10; minus half a slot.
    expect((slot._widget as { y: number }).y).toBe(40 + 10 + 110 - 10);
    expect(ins(node)[0].widget).toBeUndefined();
  });

  it("stacks an input whose field is not on screen at the panel top", () => {
    const root = document.createElement("div");
    place(root, 100, 300);
    document.body.appendChild(root);
    const node: FieldSocketNode = {
      graph: {},
      inputs: [{ name: "a", link: null }, { name: "b", link: null }],
      widgets: [{ name: "w", y: 0, margin: 10 }],
    };
    attach(node, root, "w", ["a", "b"]);
    flushFrames();
    expect((ins(node)[0]._widget as { y: number }).y).toBe(10);
    expect((ins(node)[1]._widget as { y: number }).y).toBe(30);
  });

  it("keeps a widget's own input bound to it and hands it back when its field goes", async () => {
    const root = document.createElement("div");
    root.dataset.wpSocket = "template";
    place(root, 100, 80);
    document.body.appendChild(root);
    const node: FieldSocketNode = {
      graph: {},
      inputs: [{ name: "template", link: null, widget: { name: "template" } }],
      widgets: [{ name: "template", y: 20, margin: 10 }],
    };
    attach(node, root, "template", ["template"]);
    flushFrames();
    const slot = ins(node)[0];
    expect((slot._widget as { y: number }).y).toBe(20 + 10 + 40 - 10);
    // Linked: the widget gives way to the wire and its field is gone.
    delete root.dataset.wpSocket;
    document.body.appendChild(document.createElement("span"));
    await Promise.resolve();
    flushFrames();
    expect(slot._widget).toBeUndefined();
    expect(slot.widget).toEqual({ name: "template" });
  });

  it("drops the binding from the saved workflow, but not a widget's own", () => {
    const { root } = panel();
    document.body.appendChild(root);
    const prev = vi.fn();
    const node: FieldSocketNode = {
      graph: {},
      inputs: [{ name: "title", link: null }],
      widgets: [{ name: "wp_label_grid", y: 0 }, { name: "template", y: 0 }],
      onSerialize: prev,
    };
    attach(node, root, "wp_label_grid", ["title", "template"]);
    const o = { inputs: [
      { name: "title", widget: { name: "title" }, alwaysVisible: true },
      { name: "template", widget: { name: "template" } },
    ] };
    node.onSerialize?.(o);
    expect(o.inputs[0]).toEqual({ name: "title" });
    expect(o.inputs[1]).toEqual({ name: "template", widget: { name: "template" } });
    expect(prev).toHaveBeenCalledWith(o);
  });

  it("shows the dot while its field is hovered and cleans up", async () => {
    const { root, title } = panel();
    document.body.appendChild(root);
    const dirty = vi.fn();
    const node: FieldSocketNode = {
      graph: {},
      inputs: [{ name: "title", link: null }],
      widgets: [{ name: "wp_label_grid", y: 0 }],
      setDirtyCanvas: dirty,
    };
    // jsdom never matches :hover; say which field is under the mouse.
    let hovered: HTMLElement[] = [];
    const all = root.querySelectorAll.bind(root);
    vi.spyOn(root, "querySelectorAll").mockImplementation(((sel: string) =>
      sel.includes(":hover") ? hovered : all(sel)) as typeof root.querySelectorAll);
    const off = attach(node, root, "wp_label_grid", ["title"]);
    flushFrames();
    hovered = [title];
    title.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(ins(node)[0].alwaysVisible).toBe(true);
    expect(dirty).toHaveBeenCalled();
    // A missed pointerout: the next frame still reads the real hover state.
    hovered = [];
    document.body.appendChild(document.createElement("span"));
    await Promise.resolve();
    flushFrames();
    expect(ins(node)[0].alwaysVisible).toBeUndefined();
    off();
    expect(ins(node)[0].widget).toBeUndefined();
    expect(ins(node)[0]._widget).toBeUndefined();
  });
});

describe("attachFieldSockets — Nodes 2.0", () => {
  function vueNode(): { nodeEl: HTMLElement; row: HTMLElement; root: HTMLElement; grid: HTMLElement } {
    const nodeEl = document.createElement("div");
    nodeEl.dataset.nodeId = "7";
    Object.defineProperty(nodeEl, "offsetWidth", { value: 400 });
    place(nodeEl, 50, 500, 10, 400);
    const row = document.createElement("div");
    row.className = "lg-slot lg-slot--input";
    const dot = document.createElement("div");
    dot.dataset.slotKey = "7-in-1";
    row.appendChild(dot);
    Object.defineProperty(row, "offsetParent", { value: nodeEl });
    Object.defineProperty(row, "offsetHeight", { value: 20 });
    const grid = document.createElement("div");
    grid.dataset.testid = "node-widgets";
    const { root } = panel();
    grid.appendChild(root);
    nodeEl.append(row, grid);
    document.body.appendChild(nodeEl);
    return { nodeEl, row, root, grid };
  }

  it("moves the input's row level with its field and re-measures", () => {
    g.LiteGraph = { vueNodesMode: true, NODE_SLOT_HEIGHT: 20 };
    const { row, root, grid } = vueNode();
    const node: FieldSocketNode = {
      id: 7,
      graph: {},
      inputs: [{ name: "images", link: null }, { name: "title", link: null }],
      widgets: [{ name: "wp_label_grid" }],
    };
    attach(node, root, "wp_label_grid", ["title"]);
    vi.runOnlyPendingTimers();
    expect(row.classList.contains("wp-field-socket")).toBe(true);
    // field centre 210, node top 50, half a row 10.
    expect(row.style.top).toBe("150px");
    expect(row.style.left).toBe("0px");
    expect(grid.style.marginBottom).toBe("-1px");
    flushFrames();
    expect(grid.style.marginBottom).toBe("");
  });

  it("releases a widget's own dot when its field is not on screen", async () => {
    g.LiteGraph = { vueNodesMode: true, NODE_SLOT_HEIGHT: 20 };
    const { row, root } = vueNode();
    const holder = document.createElement("div");
    holder.dataset.widgetName = "template";
    const wrap = document.createElement("div");
    row.replaceWith(holder);
    holder.appendChild(wrap);
    wrap.appendChild(row);
    root.dataset.wpSocket = "template";
    const node: FieldSocketNode = {
      id: 7,
      graph: {},
      inputs: [{ name: "context", link: null }, { name: "template", link: null, widget: { name: "template" } }],
      widgets: [{ name: "template" }],
    };
    attach(node, root, "template", ["template"]);
    vi.runOnlyPendingTimers();
    expect(row.classList.contains("wp-field-socket")).toBe(true);
    expect(wrap.classList.contains("wp-field-socket-host")).toBe(true);
    expect(ins(node)[1].widget).toEqual({ name: "template" });

    root.getClientRects = () => [] as unknown as DOMRectList;
    document.body.appendChild(document.createElement("span"));
    await Promise.resolve();
    flushFrames();
    expect(row.classList.contains("wp-field-socket")).toBe(false);
    expect(wrap.classList.contains("wp-field-socket-host")).toBe(false);
    expect(row.style.top).toBe("");
  });
});
