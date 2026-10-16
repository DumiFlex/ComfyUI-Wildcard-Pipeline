/**
 * Regression: `reactiveFromGraph` disposal (review H2) and LIFO-safe
 * `onConnectionsChange` sharing (review H3).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { effectScope } from "vue";
import { reactiveFromGraph, watchConnections, type ConnectableNode } from "./reactive";

afterEach(() => vi.restoreAllMocks());

describe("reactiveFromGraph disposal", () => {
  it("stopping its effect scope clears the poll interval and the wrapper", () => {
    const setSpy = vi.spyOn(window, "setInterval");
    const clearSpy = vi.spyOn(window, "clearInterval");
    const node: ConnectableNode = { mode: 0 };
    const scope = effectScope();
    scope.run(() => reactiveFromGraph(node, () => node.mode));
    const id = setSpy.mock.results[0]?.value as number;
    expect(typeof node.onConnectionsChange).toBe("function");

    scope.stop();

    expect(clearSpy.mock.calls.map((c) => c[0])).toContain(id);
    expect(node.onConnectionsChange).toBeUndefined();
  });

  it("refreshes on onConnectionsChange while subscribed", () => {
    const node: ConnectableNode & { n: number } = { n: 1 };
    const scope = effectScope();
    const r = scope.run(() => reactiveFromGraph(node, () => node.n));
    node.n = 2;
    node.onConnectionsChange?.();
    expect(r?.value).toBe(2);
    scope.stop();
  });
});

describe("watchConnections", () => {
  function setup() {
    const orig = vi.fn();
    const node: ConnectableNode = { onConnectionsChange: orig };
    const a = vi.fn();
    const b = vi.fn();
    const offA = watchConnections(node, a);
    const offB = watchConnections(node, b);
    return { node, orig, a, b, offA, offB };
  }

  it("disposing the first subscriber keeps the second working", () => {
    const { node, orig, a, b, offA, offB } = setup();
    offA();
    node.onConnectionsChange?.(1, 0, true);
    expect(orig).toHaveBeenCalledWith(1, 0, true);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    offB();
    expect(node.onConnectionsChange).toBe(orig);
  });

  it("disposing the second subscriber first keeps the first working", () => {
    const { node, orig, a, b, offA, offB } = setup();
    offB();
    node.onConnectionsChange?.();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    offA();
    expect(node.onConnectionsChange).toBe(orig);
    offA(); // double dispose is harmless
    expect(node.onConnectionsChange).toBe(orig);
  });

  it("preserves `this` for the original handler", () => {
    const seen: unknown[] = [];
    const node: ConnectableNode = {
      onConnectionsChange(this: unknown) { seen.push(this); },
    };
    const off = watchConnections(node, () => {});
    node.onConnectionsChange?.();
    expect(seen).toEqual([node]);
    off();
  });

  it("leaves a foreign wrapper installed on top in place", () => {
    const { node, orig, a, offA, offB } = setup();
    const ours = node.onConnectionsChange;
    const foreign = vi.fn(function (this: unknown, ...args: unknown[]) { ours?.apply(this, args); });
    node.onConnectionsChange = foreign;
    offA();
    offB();
    expect(node.onConnectionsChange).toBe(foreign);
    node.onConnectionsChange?.();
    expect(orig).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();

    // A fresh subscriber wraps the current handler, chain intact.
    const c = vi.fn();
    const offC = watchConnections(node, c);
    node.onConnectionsChange?.();
    expect(foreign).toHaveBeenCalledTimes(2);
    expect(orig).toHaveBeenCalledTimes(2);
    expect(c).toHaveBeenCalledTimes(1);
    offC();
    expect(node.onConnectionsChange).toBe(foreign);
  });
});
