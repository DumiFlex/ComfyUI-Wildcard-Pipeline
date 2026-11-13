/**
 * Mirrors: one node's panel drawn on another node (Show on subgraph node).
 */
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { buildMirror, createDomWidgetHost, isMirrorBuild, primaryValue, type DomWidget, type MirrorMount } from "./_shared";

interface FakeNode {
  id: number;
  added: Array<{ name: string; opts?: Record<string, unknown> }>;
  addDOMWidget: (name: string, type: string, el: HTMLElement, opts?: Record<string, unknown>) => DomWidget;
}

function makeNode(id: number): FakeNode {
  const node: FakeNode = {
    id,
    added: [],
    addDOMWidget: (name, _t, el, opts) => {
      node.added.push({ name, ...(opts ? { opts } : {}) });
      return { element: el, options: opts } as unknown as DomWidget;
    },
  };
  return node;
}

const Leaf = defineComponent({ setup: () => () => h("span", "leaf") });
const tick = () => new Promise((r) => setTimeout(r, 0));

function mountFor(inner: FakeNode, host: FakeNode, extra: Partial<MirrorMount> = {}): MirrorMount {
  return {
    dataNode: inner,
    hostNode: host,
    widgetName: "wp_show:1:w",
    title: () => "WP Toggles",
    onHide: vi.fn(),
    onOrphan: vi.fn(),
    ...extra,
  };
}

describe("mirror hosts", () => {
  it("mounts on the host node under its own name and is never saved", () => {
    const inner = makeNode(1);
    const outer = makeNode(5);
    createDomWidgetHost(inner, "w", Leaf, { initialValue: "a" });
    let during = false;
    buildMirror(mountFor(inner, outer), () => {
      during = isMirrorBuild(inner);
      return createDomWidgetHost(inner, "w", Leaf);
    });
    expect(during).toBe(true);
    expect(isMirrorBuild(inner)).toBe(false);
    expect(inner.added.map((a) => a.name)).toEqual(["w"]);
    expect(outer.added.map((a) => a.name)).toEqual(["wp_show:1:w"]);
    expect(outer.added[0].opts?.serialize).toBe(false);
  });

  it("takes the node's value and shares changes both ways", async () => {
    const inner = makeNode(1);
    const outer = makeNode(5);
    const seenInner: string[] = [];
    const seenCopy: string[] = [];
    const primary = createDomWidgetHost(inner, "w", Leaf, { initialValue: "saved", onValueRestored: (v) => seenInner.push(v) });
    const copy = buildMirror(mountFor(inner, outer), () =>
      createDomWidgetHost(inner, "w", Leaf, { initialValue: "default", onValueRestored: (v) => seenCopy.push(v) }),
    );
    // A default the copy writes before it is seeded never reaches the node.
    copy.setValue("default");
    expect(primary.getValue()).toBe("saved");
    await tick();
    expect(copy.getValue()).toBe("saved");
    expect(seenCopy).toEqual(["saved"]);

    copy.setValue("from copy");
    expect(primary.getValue()).toBe("from copy");
    expect(seenInner).toEqual(["from copy"]);

    primary.setValue("from node");
    expect(copy.getValue()).toBe("from node");
    expect(primaryValue(inner, "w")).toBe("from node");
  });

  it("drops the copy when the node's own panel goes", () => {
    const inner = makeNode(1);
    const outer = makeNode(5);
    const primary = createDomWidgetHost(inner, "w", Leaf);
    const mount = mountFor(inner, outer);
    buildMirror(mount, () => createDomWidgetHost(inner, "w", Leaf));
    primary.unmount();
    expect(mount.onOrphan).toHaveBeenCalledTimes(1);
    expect(mount.onHide).not.toHaveBeenCalled();
    expect(primaryValue(inner, "w")).toBeUndefined();
  });

  it("frames the panel with the node's title and a Hide button", async () => {
    const inner = makeNode(1);
    const outer = makeNode(5);
    createDomWidgetHost(inner, "w", Leaf);
    const mount = mountFor(inner, outer);
    const copy = buildMirror(mount, () => createDomWidgetHost(inner, "w", Leaf));
    await vi.waitFor(() => expect(copy.element.querySelector('button[aria-label="Hide from subgraph node"]')).not.toBeNull(), { timeout: 5000 });
    expect(copy.element.textContent).toContain("WP Toggles");
    expect(copy.element.textContent).toContain("leaf");
    copy.element.querySelector<HTMLButtonElement>('button[aria-label="Hide from subgraph node"]')?.click();
    expect(mount.onHide).toHaveBeenCalledTimes(1);
  });
});
