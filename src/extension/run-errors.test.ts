import { describe, it, expect, beforeEach } from "vitest";
import { toasts } from "../components/shared/toast-store";
import {
  _resetInstalled,
  clearRunError,
  installRunErrors,
  nodeForExecutionId,
  resetRunErrors,
  runErrorOf,
  setRunError,
  stripNodePrefix,
} from "./run-errors";

class FakeApi {
  handlers = new Map<string, ((e: Event) => void)[]>();
  addEventListener(name: string, fn: (e: Event) => void) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
  }
  fire(name: string, detail?: unknown) {
    for (const fn of this.handlers.get(name) ?? []) fn(new CustomEvent(name, { detail }));
  }
}

const MSG = "WP Var → Choice: The variable is empty in KSampler > sampler_name (45 options: euler, …)";

function setup() {
  const api = new FakeApi();
  const choice = { type: "WP_VarToChoice", title: "WP Var → Choice" };
  const ctx = { type: "WP_Context", title: "Characters" };
  const ksampler = { type: "KSampler", title: "KSampler" };
  const nodes: Record<string, object> = { "7": choice, "8": ctx, "9": ksampler };
  installRunErrors(api, (id) => (nodes[id] as never) ?? null);
  return { api, choice, ctx, ksampler };
}

beforeEach(() => {
  _resetInstalled();
  resetRunErrors();
  toasts.value = [];
});

describe("run errors", () => {
  it("stores a WP node's error without its name and pushes one error toast", () => {
    const { api, choice } = setup();
    api.fire("execution_error", { node_id: "7", node_type: "WP_VarToChoice", exception_message: MSG });
    expect(runErrorOf(choice)?.message).toBe("The variable is empty in KSampler > sampler_name (45 options: euler, …)");
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]?.severity).toBe("error");
    expect(toasts.value[0]?.message).toBe(MSG);
  });

  it("puts the node's title in front of a message that lacks it", () => {
    const { api, ctx } = setup();
    api.fire("execution_error", { node_id: 8, node_type: "WP_Context", exception_message: "Invalid modules JSON: x\n" });
    expect(runErrorOf(ctx)?.message).toBe("Invalid modules JSON: x");
    expect(toasts.value[0]?.message).toBe("Characters: Invalid modules JSON: x");
  });

  it("leaves other nodes' errors to ComfyUI", () => {
    const { api, ksampler } = setup();
    api.fire("execution_error", { node_id: "9", node_type: "KSampler", exception_message: "boom" });
    expect(runErrorOf(ksampler)).toBeNull();
    expect(toasts.value).toHaveLength(0);
  });

  it("clears when the next run reaches the node (executing, both detail shapes, or cached)", () => {
    const { api, choice } = setup();
    const fail = () => api.fire("execution_error", { node_id: "7", node_type: "WP_VarToChoice", exception_message: MSG });
    fail();
    api.fire("executing", "8");
    expect(runErrorOf(choice)).not.toBeNull();
    api.fire("executing", "7");
    expect(runErrorOf(choice)).toBeNull();
    fail();
    api.fire("executing", { node: "7", display_node: "7" });
    expect(runErrorOf(choice)).toBeNull();
    fail();
    api.fire("execution_cached", { nodes: ["7"] });
    expect(runErrorOf(choice)).toBeNull();
    api.fire("executing", null);
  });

  it("still toasts when the node can't be found", () => {
    const { api } = setup();
    api.fire("execution_error", { node_id: "99", node_type: "WP_Debug", exception_message: "" });
    expect(toasts.value[0]?.message).toBe("WP_Debug stopped the run.");
  });

  it("set / clear by hand (the strip's close button)", () => {
    const n = {};
    setRunError(n, "  ", "WP Debug");
    expect(runErrorOf(n)?.message).toBe("The node stopped the run.");
    clearRunError(n);
    clearRunError(n);
    expect(runErrorOf(n)).toBeNull();
    expect(runErrorOf(null)).toBeNull();
  });

  it("strips only a WP node-name prefix", () => {
    expect(stripNodePrefix("WP Var → Choice: x")).toBe("x");
    expect(stripNodePrefix("Error: x")).toBe("Error: x");
  });

  it("finds nodes by execution id, inside subgraphs too", () => {
    const inner = { id: 5 };
    const sub = { getNodeById: (id: string | number) => (id === 5 ? inner : null) };
    const outer = { id: 12, subgraph: sub };
    const root = { getNodeById: (id: string | number) => (String(id) === "12" ? outer : null) };
    expect(nodeForExecutionId(root, "12")).toBe(outer);
    expect(nodeForExecutionId(root, "12:5")).toBe(inner);
    expect(nodeForExecutionId(root, "12:6")).toBeNull();
    expect(nodeForExecutionId(root, "3")).toBeNull();
    expect(nodeForExecutionId(null, "3")).toBeNull();
  });
});
