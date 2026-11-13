import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPromotedHost,
  installPromotedHosts,
  needsOurHost,
  promotedSource,
  refreshAllPromotedHosts,
  refreshPromotedHosts,
  registerPromotedHost,
  type PromotedHostContext,
  type SubgraphHostNode,
} from "./subgraph-promote";

interface Input {
  name: string;
  link?: number | null;
  widgetId?: string;
  _widget?: unknown;
  _subgraphSlot?: { linkIds: number[] };
}

/** A source widget with its own element, as `addDOMWidget` makes. */
function sourceWidget(name = "template") {
  return { name, type: "wp-dom", element: document.createElement("div") };
}

/** A subgraph node class shaped like ComfyUI's: a per-subgraph class whose
 *  prototype carries `createPromotedHostWidget`, a store-backed projection and
 *  `_extraWidgets` that `addDOMWidget` fills. */
function makeSubgraphNode(opts: {
  inner: { widgets: { name: string; element?: unknown; type?: string }[]; isSubgraphNode?: () => boolean; inputs?: Input[]; subgraph?: unknown };
  innerInput?: string;
  hostInput?: string;
  settled?: boolean;
}) {
  const store = new Map<string, unknown>();
  const original = vi.fn(() => undefined);
  class Host {
    id = 7;
    inputs: Input[] = [];
    _extraWidgets: unknown[] = [];
    properties: Record<string, unknown> = {};
    graph: { getNodeById: (id: number | string) => unknown };
    subgraph: { getLink: (id: number | string) => unknown };
    constructor() {
      const self = this;
      this.graph = { getNodeById: (id) => (opts.settled === false ? null : id === 7 ? self : null) };
      const target = { name: opts.innerInput ?? "template" };
      this.subgraph = {
        getLink: (id) => (id === 1 ? { resolve: () => ({ inputNode: innerNode, input: target }) } : null),
      };
    }
    get widgets(): unknown[] {
      return [...this.inputs.flatMap((i) => (i._widget ? [i._widget] : [])), ...this._extraWidgets];
    }
    isSubgraphNode() {
      return true;
    }
    addDOMWidget(name: string, type: string, element: HTMLElement) {
      const w = { name, type, element, onRemove: vi.fn() };
      this._extraWidgets.push(w);
      return w;
    }
    _projectPromotedWidget(input: Input) {
      const id = input.widgetId ?? input.name;
      return {
        get value() {
          return store.get(id);
        },
        set value(v: unknown) {
          store.set(id, v);
        },
      };
    }
    rebuildInputWidgetBindings = vi.fn(() => {
      for (const input of this.inputs) {
        const source = promotedSource(this as unknown as SubgraphHostNode, input as never);
        if (source) input._widget = (this as unknown as { createPromotedHostWidget: (...a: unknown[]) => unknown }).createPromotedHostWidget(input, input.widgetId, source) ?? { projection: true };
      }
    });
  }
  (Host.prototype as unknown as { createPromotedHostWidget: unknown }).createPromotedHostWidget = original;
  const innerNode = {
    isSubgraphNode: opts.inner.isSubgraphNode ?? (() => false),
    inputs: opts.inner.inputs,
    subgraph: opts.inner.subgraph,
    getWidgetFromSlot: (slot: { name: string }) => opts.inner.widgets.find((w) => w.name === slot.name),
  };
  const node = new Host();
  node.inputs.push({ name: opts.hostInput ?? "template", widgetId: "g:7:template", _subgraphSlot: { linkIds: [1] } });
  return { node, store, original, innerNode };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("promotedSource", () => {
  it("follows the subgraph input's link to the inner widget", () => {
    const w = sourceWidget();
    const { node } = makeSubgraphNode({ inner: { widgets: [w] } });
    expect(promotedSource(node as unknown as SubgraphHostNode, node.inputs[0] as never)).toBe(w);
  });

  it("is undefined for an input with no link", () => {
    const { node } = makeSubgraphNode({ inner: { widgets: [] } });
    expect(promotedSource(node as unknown as SubgraphHostNode, { name: "x" } as never)).toBeUndefined();
  });

  it("follows a nested subgraph node down to the real widget", () => {
    const deep = sourceWidget();
    // The inner subgraph node forwards its own `template` input to `deep`.
    const nested = makeSubgraphNode({ inner: { widgets: [deep] } }).node;
    const { node } = makeSubgraphNode({ inner: { widgets: [] } });
    const nestedAsInner = Object.assign(nested, { getWidgetFromSlot: () => ({ name: "template", type: "wp-dom" }) });
    node.subgraph = { getLink: () => ({ resolve: () => ({ inputNode: nestedAsInner, input: { name: "template" } }) }) };
    expect(promotedSource(node as unknown as SubgraphHostNode, node.inputs[0] as never)).toBe(deep);
  });
});

describe("buildPromotedHost", () => {
  it("leaves widgets with no factory to ComfyUI", () => {
    const w = sourceWidget();
    const { node } = makeSubgraphNode({ inner: { widgets: [w] } });
    expect(buildPromotedHost(node as unknown as SubgraphHostNode, node.inputs[0] as never, w)).toBeNull();
  });

  it("builds ours, bridged to ComfyUI's stored value, and takes it out of the extra widgets", () => {
    const w = sourceWidget();
    let seen: PromotedHostContext | null = null;
    registerPromotedHost(w, (ctx) => {
      seen = ctx;
      return (ctx.subgraphNode as unknown as { addDOMWidget: (n: string, t: string, e: HTMLElement) => { element: HTMLElement } }).addDOMWidget(ctx.inputName, "wp-dom", document.createElement("div"));
    });
    const { node, store } = makeSubgraphNode({ inner: { widgets: [w] }, hostInput: "my_prompt" });
    store.set("g:7:template", "a $style cat");
    const built = buildPromotedHost(node as unknown as SubgraphHostNode, node.inputs[0] as never, w);
    expect(built).not.toBeNull();
    expect(node._extraWidgets).toEqual([]);
    expect(seen).not.toBeNull();
    const ctx = seen as unknown as PromotedHostContext;
    expect(ctx.inputName).toBe("my_prompt");
    expect(ctx.value.get()).toBe("a $style cat");
    ctx.value.set("a dog");
    expect(store.get("g:7:template")).toBe("a dog");
  });

  it("waits until the node is settled in its graph", () => {
    const w = sourceWidget();
    const factory = vi.fn(() => null);
    registerPromotedHost(w, factory);
    const { node } = makeSubgraphNode({ inner: { widgets: [w] }, settled: false });
    expect(buildPromotedHost(node as unknown as SubgraphHostNode, node.inputs[0] as never, w)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it("falls back when the factory throws", () => {
    const w = sourceWidget();
    registerPromotedHost(w, () => {
      throw new Error("boom");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { node } = makeSubgraphNode({ inner: { widgets: [w] } });
    expect(buildPromotedHost(node as unknown as SubgraphHostNode, node.inputs[0] as never, w)).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("gives up (and removes its widget) when extra widgets can't be found", () => {
    const w = sourceWidget();
    const made = { element: document.createElement("div"), onRemove: vi.fn() };
    registerPromotedHost(w, () => made);
    const { node } = makeSubgraphNode({ inner: { widgets: [w] } });
    (node as unknown as { _extraWidgets?: unknown })._extraWidgets = undefined;
    expect(buildPromotedHost(node as unknown as SubgraphHostNode, node.inputs[0] as never, w)).toBeNull();
    expect(made.onRemove).toHaveBeenCalled();
  });
});

describe("hooking a subgraph node class", () => {
  it("routes ours through the factory and the rest to ComfyUI's hook", () => {
    const ours = sourceWidget("template");
    const theirs = sourceWidget("other");
    registerPromotedHost(ours, (ctx) =>
      (ctx.subgraphNode as unknown as { addDOMWidget: (n: string, t: string, e: HTMLElement) => { element: HTMLElement } }).addDOMWidget(ctx.inputName, "wp-dom", document.createElement("div")),
    );
    const { node, original } = makeSubgraphNode({ inner: { widgets: [ours, theirs] } });
    refreshPromotedHosts(node as unknown as SubgraphHostNode);
    const hook = (node as unknown as { createPromotedHostWidget: (...a: unknown[]) => unknown }).createPromotedHostWidget;
    expect(hook(node.inputs[0], "id", theirs)).toBeUndefined();
    expect(original).toHaveBeenCalledTimes(1);
    expect(hook.call(node, node.inputs[0], "id", ours)).toMatchObject({ type: "wp-dom" });
  });

  it("re-binds a node still showing ComfyUI's stand-in, and only then", () => {
    const w = sourceWidget();
    registerPromotedHost(w, (ctx) =>
      (ctx.subgraphNode as unknown as { addDOMWidget: (n: string, t: string, e: HTMLElement) => { element: HTMLElement } }).addDOMWidget(ctx.inputName, "wp-dom", document.createElement("div")),
    );
    const { node } = makeSubgraphNode({ inner: { widgets: [w] } });
    node.inputs[0]._widget = { projection: true };
    expect(needsOurHost(node as unknown as SubgraphHostNode)).toBe(true);
    refreshPromotedHosts(node as unknown as SubgraphHostNode);
    expect(node.rebuildInputWidgetBindings).toHaveBeenCalledTimes(1);
    expect(needsOurHost(node as unknown as SubgraphHostNode)).toBe(false);
    refreshPromotedHosts(node as unknown as SubgraphHostNode);
    expect(node.rebuildInputWidgetBindings).toHaveBeenCalledTimes(1);
  });

  it("installPromotedHosts re-binds after the current task", () => {
    vi.useFakeTimers();
    const w = sourceWidget();
    registerPromotedHost(w, (ctx) =>
      (ctx.subgraphNode as unknown as { addDOMWidget: (n: string, t: string, e: HTMLElement) => { element: HTMLElement } }).addDOMWidget(ctx.inputName, "wp-dom", document.createElement("div")),
    );
    const { node } = makeSubgraphNode({ inner: { widgets: [w] } });
    installPromotedHosts(node);
    expect(node.rebuildInputWidgetBindings).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(node.rebuildInputWidgetBindings).toHaveBeenCalledTimes(1);
  });

  it("ignores ordinary nodes", () => {
    const plain = { isSubgraphNode: () => false, rebuildInputWidgetBindings: vi.fn() };
    installPromotedHosts(plain);
    refreshPromotedHosts(plain as unknown as SubgraphHostNode);
    expect(plain.rebuildInputWidgetBindings).not.toHaveBeenCalled();
  });

  it("refreshAllPromotedHosts walks nested subgraphs", () => {
    const w = sourceWidget();
    registerPromotedHost(w, (ctx) =>
      (ctx.subgraphNode as unknown as { addDOMWidget: (n: string, t: string, e: HTMLElement) => { element: HTMLElement } }).addDOMWidget(ctx.inputName, "wp-dom", document.createElement("div")),
    );
    const inner = makeSubgraphNode({ inner: { widgets: [w] } }).node;
    inner.inputs[0]._widget = { projection: true };
    const outer = makeSubgraphNode({ inner: { widgets: [] } }).node;
    (outer as unknown as { subgraph: { _nodes: unknown[]; getLink: () => null } }).subgraph = { _nodes: [inner], getLink: () => null };
    refreshAllPromotedHosts({ _nodes: [outer, { isSubgraphNode: () => false }] });
    expect(inner.rebuildInputWidgetBindings).toHaveBeenCalledTimes(1);
    expect(outer.rebuildInputWidgetBindings).not.toHaveBeenCalled();
  });
});
