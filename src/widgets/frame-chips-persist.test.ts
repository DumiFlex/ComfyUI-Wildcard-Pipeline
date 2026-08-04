import { describe, it, expect } from "vitest";

/**
 * Collapse persistence contract for the frame grid.
 *
 * The state lives on `node.properties`, which is the workflow-JSON
 * serialization root — a WeakMap would be lost on reload, which is the whole
 * point of persisting it. These pin the read/write shape both widget glues
 * implement, without booting ComfyUI.
 */
const KEY = "wp_frame_chips_collapsed";

/** Mirrors the glue: ref is the render source of truth, properties the store. */
function makeCollapseStore(node: { properties?: Record<string, unknown> }) {
  let value = !!(node.properties ?? {})[KEY];
  return {
    get: () => value,
    sync: () => { value = !!(node.properties ?? {})[KEY]; },
    set: (next: boolean) => {
      value = next;
      node.properties = node.properties ?? {};
      node.properties[KEY] = next;
    },
  };
}

describe("frame chips collapse persistence", () => {
  it("defaults to expanded on a node that has never been touched", () => {
    expect(makeCollapseStore({}).get()).toBe(false);
  });

  it("writes through to node.properties so the workflow save carries it", () => {
    const node: { properties?: Record<string, unknown> } = {};
    makeCollapseStore(node).set(true);
    expect(node.properties?.[KEY]).toBe(true);
  });

  it("reopens collapsed after a reload", () => {
    const node = { properties: { [KEY]: true } };
    expect(makeCollapseStore(node).get()).toBe(true);
  });

  // `create()` runs before ComfyUI applies saved properties, so the first read
  // sees nothing. Without the re-sync a collapsed grid comes back open.
  it("re-syncs once the workflow's properties land after create()", () => {
    const node: { properties?: Record<string, unknown> } = {};
    const store = makeCollapseStore(node);
    expect(store.get()).toBe(false);
    node.properties = { [KEY]: true }; // workflow restore
    store.sync();
    expect(store.get()).toBe(true);
  });

  it("does not clobber other properties on the node", () => {
    const node = { properties: { collapse_connections: true } as Record<string, unknown> };
    makeCollapseStore(node).set(true);
    expect(node.properties.collapse_connections).toBe(true);
    expect(node.properties[KEY]).toBe(true);
  });

  it("uses a wp_-prefixed key, per the extension-isolation convention", () => {
    expect(KEY.startsWith("wp_")).toBe(true);
  });
});
