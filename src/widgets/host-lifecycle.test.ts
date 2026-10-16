/**
 * Regression: DOM widget hosts tear down on node removal (review H1/H2).
 * Before, `unmount` was never called, so every removed node kept its Vue app,
 * its `reactiveFromGraph` polls, its theme observer and its api listeners.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, ref, watch } from "vue";
import { app } from "#comfyui/app";
import { buildInScope, createDomWidgetHost, listenApi, type DomWidget } from "./_shared";
import { reactiveFromGraph } from "../extension/reactive";

interface FakeNode {
  id: number;
  mode: number;
  onRemoved?: (...a: unknown[]) => unknown;
  onConnectionsChange?: (...a: unknown[]) => void;
  addDOMWidget: (name: string, type: string, el: HTMLElement, opts?: Record<string, unknown>) => DomWidget;
}

function makeNode(): FakeNode {
  return {
    id: 1,
    mode: 0,
    addDOMWidget: (_n, _t, el, opts) => ({ element: el, options: opts }),
  };
}

const Leaf = defineComponent({ setup: () => () => h("span", "leaf") });

/** Component that runs `reactiveFromGraph` in its own setup(), as the
 *  Context / Injector / Debug glue does. */
function polledComponent(node: FakeNode) {
  return defineComponent({
    setup() {
      const mode = reactiveFromGraph(node, () => node.mode);
      return () => h("span", String(mode.value));
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (app as unknown as { api?: unknown }).api;
});

describe("createDomWidgetHost lifecycle", () => {
  it("node.onRemoved unmounts, runs cleanups, clears polls and still calls the original", () => {
    const setSpy = vi.spyOn(window, "setInterval");
    const clearSpy = vi.spyOn(window, "clearInterval");
    const node = makeNode();
    const calls: unknown[] = [];
    node.onRemoved = function (this: unknown) { calls.push(this); };

    const host = createDomWidgetHost(node, "w", polledComponent(node));
    const cleanup = vi.fn();
    host.onCleanup(cleanup);
    expect(host.element.textContent).toBe("0");
    const started = setSpy.mock.results.map((r) => r.value as number);
    expect(started.length).toBe(1);

    node.onRemoved?.call(node);

    expect(calls).toEqual([node]);           // original ran, `this` preserved
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(host.element.textContent).toBe(""); // Vue app unmounted
    const cleared = clearSpy.mock.calls.map((c) => c[0]);
    for (const id of started) expect(cleared).toContain(id);
  });

  it("is idempotent and restores the original onRemoved after a direct unmount", () => {
    const node = makeNode();
    const orig = vi.fn();
    node.onRemoved = orig;
    const host = createDomWidgetHost(node, "w", Leaf);
    const cleanup = vi.fn();
    host.onCleanup(cleanup);

    host.unmount();
    host.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(node.onRemoved).toBe(orig);
    node.onRemoved?.();
    expect(orig).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);

    // A cleanup registered after teardown runs immediately.
    const late = vi.fn();
    host.onCleanup(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("leaves a wrapper installed on top alone and drops its own own-property when it had none", () => {
    const node = makeNode();
    const host = createDomWidgetHost(node, "w", Leaf);
    host.unmount();
    expect(Object.prototype.hasOwnProperty.call(node, "onRemoved")).toBe(false);

    const node2 = makeNode();
    const host2 = createDomWidgetHost(node2, "w", Leaf);
    const ours = node2.onRemoved;
    const outer = function (this: unknown, ...a: unknown[]) { ours?.apply(this, a); };
    node2.onRemoved = outer;
    host2.unmount();
    expect(node2.onRemoved).toBe(outer);
    expect(() => node2.onRemoved?.call(node2)).not.toThrow();
  });

  it("two hosts on one node both tear down on removal", () => {
    const node = makeNode();
    const a = createDomWidgetHost(node, "a", Leaf);
    const b = createDomWidgetHost(node, "b", Leaf);
    const ca = vi.fn();
    const cb = vi.fn();
    a.onCleanup(ca);
    b.onCleanup(cb);
    node.onRemoved?.call(node);
    expect(ca).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a failing cleanup does not strand the rest of the teardown", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const node = makeNode();
    const host = createDomWidgetHost(node, "w", Leaf);
    const after = vi.fn();
    host.onCleanup(after);
    host.onCleanup(() => { throw new Error("boom"); });
    node.onRemoved?.call(node);
    expect(after).toHaveBeenCalledTimes(1);
    expect(host.element.textContent).toBe("");
    expect(err).toHaveBeenCalled();
  });
});

describe("buildInScope (glue-level reactive setup)", () => {
  it("polls and watchers created outside setup() stop with the host", () => {
    const setSpy = vi.spyOn(window, "setInterval");
    const clearSpy = vi.spyOn(window, "clearInterval");
    const node = makeNode();
    const seen: number[] = [];
    const host = buildInScope((scope) => {
      const mode = reactiveFromGraph(node, () => node.mode);
      const other = ref(0);
      watch(other, (v) => seen.push(v), { flush: "sync" });
      const hst = createDomWidgetHost(node, "w", Leaf, { scope });
      hst.onCleanup(() => { other.value = 99; });
      void mode;
      return hst;
    });
    const started = setSpy.mock.results.map((r) => r.value as number);
    expect(started.length).toBe(1);
    expect(host.scope.active).toBe(true);

    node.onRemoved?.call(node);

    expect(host.scope.active).toBe(false);
    expect(clearSpy.mock.calls.map((c) => c[0])).toContain(started[0]);
    // Scope stopped before cleanups ran → the watcher no longer fires.
    expect(seen).toEqual([]);
    // The connections wrapper was removed with the last subscriber.
    expect(node.onConnectionsChange).toBeUndefined();
  });
});

describe("listenApi", () => {
  it("removes the api listener on unmount", () => {
    const api = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    (app as unknown as { api?: unknown }).api = api;
    const node = makeNode();
    const host = createDomWidgetHost(node, "w", Leaf);
    const fn = (): void => {};
    listenApi(host, "executed", fn);
    expect(api.addEventListener).toHaveBeenCalledWith("executed", fn);
    node.onRemoved?.call(node);
    expect(api.removeEventListener).toHaveBeenCalledWith("executed", fn);
  });

  it("is a no-op without an api", () => {
    const host = createDomWidgetHost(makeNode(), "w", Leaf);
    expect(() => listenApi(host, "executed", () => {})).not.toThrow();
  });
});
