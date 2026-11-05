import { afterEach, describe, expect, it, vi } from "vitest";
import { mountModeRelay } from "./mode-relay";
import { watchModes } from "../extension/reactive";

type FakeNode = Record<string, unknown> & { id: number; mode: number };

/** watched (1) → relay (2) → target (3), on a graph with two links. */
function makeGraph() {
  const links = new Map<number, { origin_id: number; target_id: number }>([
    [10, { origin_id: 1, target_id: 2 }],
    [11, { origin_id: 2, target_id: 3 }],
  ]);
  const nodes = new Map<number, FakeNode>();
  const graph = { links, getNodeById: (id: number) => nodes.get(id) ?? null };
  const watchedNode: FakeNode = { id: 1, mode: 0, graph };
  const target: FakeNode = { id: 3, mode: 0, graph };
  const relayNode: FakeNode = {
    id: 2,
    mode: 0,
    graph,
    type: "WP_ModeRelay",
    isVirtualNode: true,
    size: [320, 150],
    properties: {},
    inputs: [{ name: "node_1", link: 10 }],
    outputs: [{ name: "drives", links: [11] }],
    setDirtyCanvas: vi.fn(),
    addDOMWidget(_name: string, _type: string, el: HTMLElement, opts?: Record<string, unknown>) {
      document.body.appendChild(el);
      return { element: el, options: opts ?? {} };
    },
  };
  for (const n of [watchedNode, relayNode, target]) nodes.set(n.id, n);
  return { watchedNode, relayNode, target };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("watchModes", () => {
  it("hears each node's mode change at once and follows the set", () => {
    const a = { mode: 0 };
    const b = { mode: 0 };
    let set: object[] = [a];
    const cb = vi.fn();
    const w = watchModes(() => set, cb);
    a.mode = 2;
    expect(cb).toHaveBeenCalledTimes(1);
    b.mode = 4;
    expect(cb).toHaveBeenCalledTimes(1);
    set = [b];
    w.sync();
    a.mode = 0;
    b.mode = 2;
    expect(cb).toHaveBeenCalledTimes(2);
    w.stop();
    b.mode = 0;
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe("WP Mode Relay", () => {
  it("passes a watched node's change on at once, with no poll", () => {
    const { watchedNode, relayNode, target } = makeGraph();
    mountModeRelay(relayNode as unknown as Parameters<typeof mountModeRelay>[0]);
    watchedNode.mode = 4;
    expect(target.mode).toBe(4);
    watchedNode.mode = 2;
    expect(target.mode).toBe(2);
    watchedNode.mode = 0;
    expect(target.mode).toBe(0);
  });

  it("applies a changed rule to what the watched nodes do now", async () => {
    const { watchedNode, relayNode, target } = makeGraph();
    mountModeRelay(relayNode as unknown as Parameters<typeof mountModeRelay>[0]);
    watchedNode.mode = 4;
    expect(target.mode).toBe(4);
    // The panel is a lazy component: wait for it to render.
    const mute = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-test="mr-bypassed-mute"]');
      if (!el) throw new Error("not rendered yet");
      return el;
    }, { timeout: 3000 });
    mute.click();
    expect(target.mode).toBe(2);
  });
});
