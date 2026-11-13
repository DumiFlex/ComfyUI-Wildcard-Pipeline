import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

import { createDomWidgetHost, type DomWidget } from "../widgets/_shared";
import { SHOW_KEY, hidePanel, hostsOf, isShown, menuItems, movePanel, offerPanel, panelsOf, restoreShown, showPanel } from "./show-on-subgraph";
import { handleClick, markRows, targetOf } from "./subgraph-eye";

const Leaf = defineComponent({ setup: () => () => h("span", "leaf") });

interface Graph {
  _nodes: unknown[];
  rootGraph?: Graph;
  getNodeById: (id: number | string) => unknown;
}

function graph(nodes: unknown[]): Graph {
  const g: Graph = { _nodes: nodes, getNodeById: (id) => g._nodes.find((n) => String((n as { id: unknown }).id) === String(id)) };
  return g;
}

function domNode<T extends object>(extra: T) {
  const widgets: Array<{ name: string; widget: DomWidget }> = [];
  return Object.assign(
    {
      widgets,
      addDOMWidget(name: string, _t: string, el: HTMLElement) {
        const widget = { name, element: el } as unknown as DomWidget;
        widgets.push({ name, widget });
        return widget;
      },
    },
    extra,
  );
}

/** A root graph with two subgraph nodes made from one subgraph holding a panel node. */
function scene() {
  const root = graph([]);
  root.rootGraph = root;
  const sub = graph([]);
  sub.rootGraph = root;
  const inner = domNode({ id: 3, title: "WP Toggles", graph: sub });
  sub._nodes.push(inner);
  const makeHost = (id: number) =>
    domNode({
      id,
      graph: root,
      subgraph: sub,
      properties: {} as Record<string, unknown>,
      isSubgraphNode: () => true,
      removeWidget: vi.fn(function (this: { widgets: Array<{ widget: unknown }> }, w: unknown) {
        this.widgets.splice(this.widgets.findIndex((x) => x.widget === w), 1);
      }),
    });
  const a = makeHost(10);
  const b = makeHost(11);
  root._nodes.push(a, b, { id: 12, isSubgraphNode: () => false });
  const build = vi.fn(() => createDomWidgetHost(inner, "wp_toggles", Leaf, { initialValue: "cfg" }));
  offerPanel(inner, "wp_toggles", build);
  return { root, sub, inner, a, b, build };
}

describe("show on subgraph node", () => {
  it("finds every subgraph node made from the node's subgraph", () => {
    const { inner, a, b } = scene();
    expect(hostsOf(inner)).toEqual([a, b]);
    expect(hostsOf({ id: 1, graph: null })).toEqual([]);
  });

  it("offers only panels the node has built", () => {
    const { inner } = scene();
    expect(panelsOf(inner)).toEqual(["wp_toggles"]);
    offerPanel(inner, "other", () => null);
    expect(panelsOf(inner)).toEqual(["wp_toggles"]);
  });

  it("shows on every subgraph node, remembers it, and hides again", () => {
    const { inner, a, b, build } = scene();
    expect(menuItems(inner).filter(Boolean).map((i) => i?.content)).toEqual(["Show on subgraph node"]);
    showPanel(inner, "wp_toggles");
    expect(build).toHaveBeenCalledTimes(3);
    for (const host of [a, b]) {
      expect(host.properties[SHOW_KEY]).toEqual([{ node: "3", widget: "wp_toggles" }]);
      expect(host.widgets.map((w) => w.name)).toEqual(["wp_show:3:wp_toggles"]);
    }
    // Showing twice adds nothing.
    showPanel(inner, "wp_toggles");
    expect(a.widgets).toHaveLength(1);
    expect(menuItems(inner).filter(Boolean).map((i) => i?.content)).toEqual(["Hide from subgraph node"]);

    hidePanel(inner, "wp_toggles");
    for (const host of [a, b]) {
      expect(host.properties[SHOW_KEY]).toBeUndefined();
      expect(host.widgets).toEqual([]);
    }
  });

  it("builds saved copies again, skipping inner nodes that are gone", () => {
    const { a } = scene();
    a.properties[SHOW_KEY] = [{ node: "3", widget: "wp_toggles" }, { node: "99", widget: "x" }, "junk"];
    restoreShown(a);
    restoreShown(a);
    expect(a.widgets.map((w) => w.name)).toEqual(["wp_show:3:wp_toggles"]);
  });

  it("keeps the parts a copy leaves out, and drops junk", () => {
    const { a } = scene();
    a.properties[SHOW_KEY] = [{ node: "3", widget: "wp_toggles", hide: ["font", 4, "rows"] }];
    restoreShown(a);
    expect(a.widgets).toHaveLength(1);
    hidePanel({ id: 3, graph: a.subgraph as never }, "other");
    expect(a.properties[SHOW_KEY]).toEqual([{ node: "3", widget: "wp_toggles", hide: ["font", "rows"] }]);
  });

  it("has nothing to offer outside a subgraph", () => {
    const root = graph([]);
    root.rootGraph = root;
    const plain = domNode({ id: 1, graph: root });
    offerPanel(plain, "w", () => createDomWidgetHost(plain, "w", Leaf));
    expect(menuItems(plain)).toEqual([]);
  });
});

describe("moving copies", () => {
  it("swaps the saved order and builds the copies again in it", () => {
    const { sub, inner, a } = scene();
    const second = domNode({ id: 4, title: "WP Label Grid", graph: sub });
    sub._nodes.push(second);
    offerPanel(second, "wp_label_grid", () => createDomWidgetHost(second, "wp_label_grid", Leaf, { initialValue: "lg" }));
    showPanel(inner, "wp_toggles");
    showPanel(second, "wp_label_grid");
    const order = () => (a.properties[SHOW_KEY] as Array<{ node: string }>).map((p) => p.node);
    const copies = () => a.widgets.map((w) => w.name).filter((n) => n.startsWith("wp_show:"));
    expect(order()).toEqual(["3", "4"]);
    movePanel(a, "4:wp_label_grid", -1);
    expect(order()).toEqual(["4", "3"]);
    expect(copies()).toEqual(["wp_show:4:wp_label_grid", "wp_show:3:wp_toggles"]);
    movePanel(a, "4:wp_label_grid", -1);
    expect(order()).toEqual(["4", "3"]);
  });
});

describe("the Parameters eye", () => {
  function panel(nodeId: number, widget: string): HTMLElement {
    document.body.innerHTML = `<div data-testid="subgraph-editor-hidden-section"><a>Show all</a>
      <div data-testid="subgraph-widget-item" data-nodeid="${nodeId}"><div><div>WP Toggles</div><div>${widget}</div></div>
      <button data-testid="subgraph-widget-toggle"><i class="icon-[lucide--eye-off]"></i></button></div></div>`;
    return document.body;
  }

  it("shows and hides a WP panel from its row and marks the eye", () => {
    const { inner, a } = scene();
    const app = { canvas: { selected_nodes: { 10: a } } };
    const root = panel(3, "wp_toggles");
    const row = root.querySelector('[data-testid="subgraph-widget-item"]') as Element;
    expect(targetOf(row, app)?.widget).toBe("wp_toggles");
    const icon = root.querySelector("i") as Element;
    expect(handleClick(icon, app, root)).toBe(true);
    expect(isShown(inner, "wp_toggles")).toBe(true);
    expect(icon.classList.contains("icon-[lucide--eye]")).toBe(true);
    expect(handleClick(icon, app, root)).toBe(true);
    expect(isShown(inner, "wp_toggles")).toBe(false);
    expect(icon.classList.contains("icon-[lucide--eye-off]")).toBe(true);
  });

  it("leaves other rows and nothing selected to ComfyUI", () => {
    const { a } = scene();
    const root = panel(3, "seed");
    const icon = root.querySelector("i") as Element;
    expect(handleClick(icon, { canvas: { selected_nodes: { 10: a } } }, root)).toBe(false);
    panel(3, "wp_toggles");
    expect(handleClick(document.querySelector("i"), { canvas: { selected_nodes: {} } }, document.body)).toBe(false);
  });

  it("Show all shows the WP panels in the list", () => {
    const { inner, a } = scene();
    const app = { canvas: { selected_nodes: { 10: a } } };
    const root = panel(3, "wp_toggles");
    expect(handleClick(root.querySelector("a"), app, root)).toBe(false);
    expect(isShown(inner, "wp_toggles")).toBe(true);
    markRows(root, app);
    expect(root.querySelector("i")?.classList.contains("icon-[lucide--eye]")).toBe(true);
  });
});

describe("the toolbar eye", () => {
  it("is offered for a panel node in a subgraph and toggles its panel", async () => {
    const { inner, a } = scene();
    const { SHOW_COMMAND, toolboxCommandsFor, toggleShowSelection, anyShown } = await import("./node-toolbar");
    expect(toolboxCommandsFor(inner)).toContain(SHOW_COMMAND);
    expect(toolboxCommandsFor(a)).not.toContain(SHOW_COMMAND);
    const canvas = { selected_nodes: { 3: inner } };
    expect(toggleShowSelection(canvas)).toBe(true);
    expect(anyShown(inner)).toBe(true);
    expect(toggleShowSelection(canvas)).toBe(true);
    expect(anyShown(inner)).toBe(false);
  });
});
