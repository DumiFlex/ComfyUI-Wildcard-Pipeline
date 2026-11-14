import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real widget mounts on the node (with a bare host), so the test sees
// what it does on the next tick to a bookmark that "Bookmark this view" set up.
vi.mock("./_shared", () => ({
  serializeWidgetJson: (v: unknown) => JSON.stringify(v),
  createDomWidgetHost: () => ({ element: document.createElement("div"), setValue: vi.fn(), onCleanup: vi.fn() }),
}));
vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });

import { app } from "#comfyui/app";
import { addBookmarkHere, listBookmarks, mountBookmark, BOOKMARK_NODE_TYPE } from "./bookmark";

type Graph = { _nodes: unknown[]; add: (n: unknown) => void };
type Node = Parameters<typeof mountBookmark>[0];

let root: Graph;
beforeEach(() => {
  vi.useFakeTimers();
  root = { _nodes: [], add: (n) => { (n as { graph: Graph }).graph = root; root._nodes.push(n); } };
  const canvas = {
    graph: root,
    ds: { offset: [-500, -200], scale: 1.5, getViewportSize: () => [1000, 800] as [number, number] },
    setDirty: vi.fn(),
  };
  Object.assign(app as object, { graph: root, canvas });
  (globalThis as { LiteGraph?: unknown }).LiteGraph = {
    createNode: () => {
      const node = {
        id: 7, title: "WP Bookmark", type: BOOKMARK_NODE_TYPE, pos: [0, 0], size: [160, 30], widgets: [],
        boundingRect: [0, 0, 0, 0], setDirtyCanvas: vi.fn(), setSize: vi.fn(),
      } as unknown as Node;
      // Like LiteGraph: the node's widget is made with the node, before it
      // joins the graph.
      mountBookmark(node);
      return node;
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { LiteGraph?: unknown }).LiteGraph;
  localStorage.removeItem("wp.bookmarkDock");
});

describe("Bookmark this view with the real widget", () => {
  it("keeps the spot, zoom and shortcut it was given once the widget settles", () => {
    addBookmarkHere(undefined, "c");
    const before = listBookmarks()[0]?.config;
    vi.runAllTimers();
    const after = listBookmarks()[0]?.config;
    expect(after?.anchor).toBe("c");
    expect(after?.zoomMode).toBe("fixed");
    expect(after?.zoom).toBe(1.5);
    expect(after?.shortcut).toBe(before?.shortcut);
  });
});
