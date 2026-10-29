import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "#comfyui/app";
import { bookmarkCells } from "../extension/_stashes";
import { defaultBookmarkConfig, type BookmarkConfig } from "../extension/bookmarks";
import {
  BOOKMARK_NODE_TYPE,
  installBookmarkKeys,
  installHiddenFilter,
  jumpBack,
  jumpStep,
  jumpTo,
  listBookmarks,
  setHidden,
  titleTint,
  type BookmarkNode,
} from "./bookmark";

type Graph = { _nodes: unknown[] };

function bookmark(id: number, title: string, cfg: Partial<BookmarkConfig>, graph: Graph, mode = 0): BookmarkNode {
  let config: BookmarkConfig = { ...defaultBookmarkConfig(), ...cfg };
  const node = {
    id, title, mode, type: BOOKMARK_NODE_TYPE, graph,
    pos: [id * 1000, 500], size: [300, 200],
    boundingRect: [id * 1000, 470, 300, 230],
    addDOMWidget: vi.fn(),
  } as unknown as BookmarkNode;
  bookmarkCells.set(node, { get: () => config, set: (next) => { config = next as BookmarkConfig; } });
  graph._nodes.push(node);
  return node;
}

class FakeCanvas {
  graph: Graph;
  ds = { offset: [0, 0], scale: 1, getViewportSize: () => [1000, 800] as [number, number] };
  deselect = vi.fn();
  setDirty = vi.fn();
  setGraph = vi.fn((g: Graph) => { this.graph = g; });
  constructor(g: Graph) { this.graph = g; }
  computeVisibleNodes(): unknown[] { return [...this.graph._nodes]; }
}

let root: Graph;
let canvas: FakeCanvas;
const ox = (): number => canvas.ds.offset[0] ?? 0;
const oy = (): number => canvas.ds.offset[1] ?? 0;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.classList.add("wp-a11y-no-motion");
  root = { _nodes: [] };
  canvas = new FakeCanvas(root);
  Object.assign(app as object, { graph: root, canvas });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WP Bookmark runtime", () => {
  it("lists bookmarks in dock order, subgraphs included", () => {
    const sub: Graph = { _nodes: [] };
    root._nodes.push({ id: 9, type: "Other", subgraph: sub });
    bookmark(1, "B", { order: 1 }, root);
    bookmark(2, "A", { order: 1 }, root);
    bookmark(3, "Inner", { order: 0 }, sub);
    const list = listBookmarks();
    expect(list.map((b) => b.title)).toEqual(["Inner", "A", "B"]);
    expect(list[0]?.nested).toBe(true);
  });

  it("jumps to the anchor and zoom, and Back restores the view", () => {
    const b = bookmark(1, "B", { anchor: "tl", zoom: 2 }, root);
    canvas.ds.offset = [5, 6];
    canvas.ds.scale = 0.5;
    jumpTo(b);
    // The bookmark's top-left lands 24 px in at 2×.
    expect(canvas.ds.scale).toBe(2);
    expect((1000 + ox()) * 2).toBeCloseTo(24);
    expect((470 + oy()) * 2).toBeCloseTo(24);
    expect(jumpBack()).toBe(true);
    expect(canvas.ds.offset).toEqual([5, 6]);
    expect(canvas.ds.scale).toBe(0.5);
    expect(jumpBack()).toBe(false);
  });

  it("opens the bookmark's subgraph before jumping", () => {
    const sub: Graph = { _nodes: [] };
    root._nodes.push({ id: 9, type: "Other", subgraph: sub });
    const b = bookmark(3, "Inner", { zoomMode: "keep" }, sub);
    jumpTo(b);
    expect(canvas.setGraph).toHaveBeenCalledWith(sub);
    vi.advanceTimersByTime(60);
    expect(canvas.ds.scale).toBe(1);
    expect((3000 + ox())).toBeCloseTo(24);
  });

  it("steps through the bookmarks that are on, wrapping round", () => {
    const a = bookmark(1, "A", { order: 0 }, root);
    bookmark(2, "Off", { order: 1 }, root, 4);
    const c = bookmark(3, "C", { order: 2 }, root);
    const at = (): number => Math.round(-ox() + 24);
    jumpStep(1);
    expect(at()).toBe(1000);
    jumpStep(1);
    expect(at()).toBe(3000);
    jumpStep(1);
    expect(at()).toBe(1000);
    jumpStep(-1);
    expect(at()).toBe(3000);
    expect([a, c]).toHaveLength(2);
  });

  it("leaves hidden bookmarks out of what the canvas draws and drops their selection", () => {
    const shown = bookmark(1, "Shown", {}, root);
    const hidden = bookmark(2, "Hidden", {}, root);
    root._nodes.push({ id: 7, type: "KSampler" });
    installHiddenFilter();
    setHidden(hidden, true);
    expect(canvas.deselect).toHaveBeenCalledWith(hidden);
    const drawn = canvas.computeVisibleNodes();
    expect(drawn).toContain(shown);
    expect(drawn).not.toContain(hidden);
    expect(drawn).toHaveLength(2);
    expect(document.getElementById("wp-bookmark-hidden")?.textContent).toContain('[data-node-id="2"]');
    setHidden(hidden, false);
    expect(canvas.computeVisibleNodes()).toContain(hidden);
  });
});

describe("WP Bookmark shortcuts", () => {
  installBookmarkKeys();
  const press = (init: KeyboardEventInit, before?: (e: KeyboardEvent) => void): KeyboardEvent => {
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    before?.(e);
    window.dispatchEvent(e);
    return e;
  };

  it("jumps on its combo and ignores typing and switched-off bookmarks", () => {
    bookmark(1, "A", { shortcut: "Alt+1" }, root);
    bookmark(2, "Off", { shortcut: "Alt+2" }, root, 2);
    const e = press({ key: "1", code: "Digit1", altKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(Math.round(-ox() + 24)).toBe(1000);
    expect(press({ key: "2", code: "Digit2", altKey: true }).defaultPrevented).toBe(false);

    const input = document.createElement("input");
    document.body.appendChild(input);
    const typed = new KeyboardEvent("keydown", { key: "1", code: "Digit1", altKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    input.remove();
  });

  it("stands down when another listener already used the key", () => {
    const b = bookmark(1, "A", { shortcut: "Alt+3" }, root);
    canvas.ds.offset = [7, 7];
    press({ key: "3", code: "Digit3", altKey: true }, (e) => e.preventDefault());
    expect(canvas.ds.offset).toEqual([7, 7]);
    expect(b.title).toBe("A");
  });
});

describe("WP Bookmark title tint", () => {
  it("darkens the colour and ignores anything else", () => {
    expect(titleTint("#ffffff")).toBe("#8a8a8a");
    expect(titleTint("#000000")).toBe("#171717");
    expect(titleTint("")).toBeUndefined();
  });
});

describe("WP Note bookmarks", () => {
  function note(id: number, title: string, jump: Partial<BookmarkConfig> | null): BookmarkNode {
    let on: BookmarkConfig | null = jump ? { ...defaultBookmarkConfig(), ...jump } : null;
    const node = {
      id, title, mode: 0, type: "WP_Note", graph: root,
      pos: [id * 1000, 500], size: [300, 120], boundingRect: [id * 1000, 500, 300, 120],
      addDOMWidget: vi.fn(),
    } as unknown as BookmarkNode;
    bookmarkCells.set(node, { kind: "note", get: () => on, set: (next) => { on = next as BookmarkConfig; } });
    root._nodes.push(node);
    return node;
  }

  it("lists a note only while its switch is on, and never hides it", () => {
    const on = note(1, "Read me", { shortcut: "Alt+5", order: 0 });
    note(2, "Just a note", null);
    installHiddenFilter();
    const list = listBookmarks();
    expect(list.map((b) => [b.title, b.kind])).toEqual([["Read me", "note"]]);
    setHidden(on, true);
    expect(listBookmarks()[0]?.config.hidden).toBe(false);
    expect(canvas.computeVisibleNodes()).toContain(on);
  });

  it("jumps on the note's shortcut", () => {
    note(2, "Read me", { shortcut: "Alt+6" });
    installBookmarkKeys();
    const e = new KeyboardEvent("keydown", { key: "6", code: "Digit6", altKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(Math.round(-ox() + 24)).toBe(2000);
  });
});
