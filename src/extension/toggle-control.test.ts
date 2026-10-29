import { describe, expect, it } from "vitest";
import {
  applyControl,
  controlSummary,
  ctlInputName,
  groupTitles,
  releaseTargets,
  setMode,
  stripControlInputs,
  toggleTargets,
  wantedCtlInputs,
  type CtlGraph,
  type CtlNode,
} from "./toggle-control";
import { members, nextInputName, setMembersMode, stabilizeInputs, type GroupHostNode } from "./node-group";
import type { ToggleRow, TogglesConfig } from "./toggles";

/** A tiny graph: nodes by id, links by id, groups. */
function makeGraph() {
  const nodes = new Map<number | string, CtlNode>();
  const links = new Map<number, { origin_id: number | string; origin_slot: number }>();
  const graph: CtlGraph & { groups: NonNullable<CtlGraph["groups"]> } = {
    links,
    getNodeById: (id) => nodes.get(id),
    groups: [],
  };
  let nextLink = 1;
  function add(id: number | string, extra: Partial<CtlNode> = {}): CtlNode {
    const n: CtlNode = { id, mode: 0, title: `Node ${id}`, inputs: [], graph, ...extra };
    nodes.set(id, n);
    return n;
  }
  function wire(from: CtlNode, to: CtlNode, inputName: string): void {
    const id = nextLink++;
    links.set(id, { origin_id: from.id, origin_slot: 0 });
    const inp = (to.inputs ??= []).find((i) => i.name === inputName);
    if (inp) inp.link = id;
    else (to.inputs ??= []).push({ name: inputName, link: id });
  }
  function unwire(to: CtlNode, inputName: string): void {
    const inp = (to.inputs ??= []).find((i) => i.name === inputName);
    if (inp) inp.link = null;
  }
  return { graph, add, wire, unwire };
}

function tog(id: string, extra: Partial<ToggleRow> = {}): ToggleRow {
  return { id, kind: "toggle", name: id, var: id, on: true, pin: false, out: 0, style: "switch", ...extra };
}
function cfg(rows: ToggleRow[], mode: TogglesConfig["mode"] = "any"): TogglesConfig {
  return { version: 1, mode, group_var: "", rows };
}

describe("toggle control", () => {
  it("drives a wired node: on runs, off mutes or bypasses", () => {
    const g = makeGraph();
    const toggles = g.add(1, { type: "WP_Toggles" });
    const lora = g.add(2);
    g.wire(lora, toggles, ctlInputName("a"));
    expect(toggleTargets(toggles, "a")).toEqual([lora]);

    applyControl(toggles, cfg([tog("a", { on: false, control: "bypass" })]));
    expect(lora.mode).toBe(4);
    applyControl(toggles, cfg([tog("a", { on: false, control: "mute" })]));
    expect(lora.mode).toBe(2);
    applyControl(toggles, cfg([tog("a", { on: true, control: "mute" })]));
    expect(lora.mode).toBe(0);
  });

  it("follows needs and Pick one, and only touches the toggles asked", () => {
    const g = makeGraph();
    const toggles = g.add(1);
    const a = g.add(2);
    const b = g.add(3);
    g.wire(a, toggles, ctlInputName("a"));
    g.wire(b, toggles, ctlInputName("b"));
    const c = cfg([tog("a", { on: false, control: "bypass" }), tog("b", { needs: "a", control: "bypass" })]);
    applyControl(toggles, c, new Set(["a"]));
    expect([a.mode, b.mode]).toEqual([4, 0]);
    applyControl(toggles, c);
    expect([a.mode, b.mode]).toEqual([4, 4]); // b is off: it needs a
    applyControl(toggles, cfg([tog("a", { control: "mute" }), tog("b", { control: "mute" })], "one"));
    expect([a.mode, b.mode]).toEqual([0, 2]); // Pick one: only the first runs
  });

  it("goes through a WP Node Group (nested, reroutes) and canvas groups", () => {
    const g = makeGraph();
    const toggles = g.add(1);
    const group = g.add(2, { type: "WP_NodeGroup" });
    const inner = g.add(3, { type: "WP_NodeGroup" });
    const reroute = g.add(4, { type: "Reroute" });
    const [x, y, z, w] = [g.add(5), g.add(6), g.add(7), g.add(8)];
    g.wire(x, group, "node_1");
    g.wire(inner, group, "node_2");
    g.wire(y, inner, "node_1");
    g.wire(reroute, inner, "node_2");
    g.wire(z, reroute, "in");
    g.wire(group, toggles, ctlInputName("a"));
    g.graph.groups.push({ title: "Detailers", _children: new Set([w, toggles]) });
    const found = toggleTargets(toggles, "a", ["Detailers"]);
    expect(new Set(found)).toEqual(new Set([x, y, z, w])); // never the toggles node
    expect(groupTitles(g.graph)).toEqual(["Detailers"]);
  });

  it("cuts a loop of groups", () => {
    const g = makeGraph();
    const a = g.add(1, { type: "WP_NodeGroup" });
    const b = g.add(2, { type: "WP_NodeGroup" });
    g.wire(a, b, "node_1");
    g.wire(b, a, "node_1");
    expect(members(a as GroupHostNode)).toEqual([]);
  });

  it("sets a subgraph node's inner nodes too", () => {
    const innerNode: CtlNode = { id: 9, mode: 0 };
    const sub: CtlNode = { id: 1, mode: 0, subgraph: { nodes: [innerNode] } };
    expect(setMode(sub, 4)).toBe(2);
    expect(innerNode.mode).toBe(4);
    const viaChange: CtlNode = { id: 2, mode: 0, changeMode(m) { this.mode = m * 1; } };
    setMode(viaChange, 2);
    expect(viaChange.mode).toBe(2);
  });

  it("releases only nodes still in the mode it gave them", () => {
    const a: CtlNode = { id: 1, mode: 4 };
    const b: CtlNode = { id: 2, mode: 2 };
    expect(releaseTargets([a, b], "bypass")).toBe(1);
    expect([a.mode, b.mode]).toEqual([0, 2]);
  });

  it("lists the control inputs and strips them from the prompt", () => {
    expect(wantedCtlInputs(cfg([tog("a", { control: "mute" }), tog("b"), tog("c", { control: "bypass" })])))
      .toEqual(["ctl_a", "ctl_c"]);
    const output = {
      "1": { class_type: "WP_Toggles", inputs: { wp_toggles: "{}", ctl_a: ["5", 0], upstream: ["2", 0] } },
      "5": { class_type: "LoraLoader", inputs: { ctl_x: 1 } },
    };
    stripControlInputs(output);
    expect(output["1"].inputs).toEqual({ wp_toggles: "{}", upstream: ["2", 0] });
    expect(output["5"].inputs).toEqual({ ctl_x: 1 });
    stripControlInputs(undefined);
  });

  it("says what a toggle drives", () => {
    expect(controlSummary(0, "mute", [])).toBe("mutes: wire nodes in");
    expect(controlSummary(1, "bypass", [])).toBe("off bypasses 1 node");
    expect(controlSummary(3, "mute", ["A"])).toBe("off mutes 3 nodes + group A");
    expect(controlSummary(0, "bypass", ["A", "B"])).toBe("off bypasses 2 groups");
  });
});

describe("WP Node Group inputs", () => {
  function groupNode() {
    const g = makeGraph();
    const n = g.add(1, { type: "WP_NodeGroup" }) as GroupHostNode;
    n.addInput = (name) => (n.inputs ??= []).push({ name, link: null });
    n.removeInput = (i) => (n.inputs ??= []).splice(i, 1);
    return { g, n };
  }

  it("keeps one free input at the end and labels wired ones", () => {
    const { g, n } = groupNode();
    expect(stabilizeInputs(n)).toBe(true);
    expect((n.inputs ??= []).map((i) => i.name)).toEqual(["node_1"]);
    const ksampler = g.add(2, { title: "KSampler" });
    g.wire(ksampler, n, "node_1");
    stabilizeInputs(n);
    expect((n.inputs ??= []).map((i) => [i.name, i.label ?? null])).toEqual([["node_1", "KSampler"], ["node_2", null]]);
    const vae = g.add(3, { title: "" });
    g.wire(vae, n, "node_2");
    stabilizeInputs(n);
    g.unwire(n, "node_1");
    stabilizeInputs(n);
    expect((n.inputs ??= []).map((i) => [i.name, i.label ?? null])).toEqual([["node_2", "#3"], ["node_3", null]]);
    expect(stabilizeInputs(n)).toBe(false);
    expect(nextInputName(n)).toBe("node_1");
  });

  it("sets every member at once", () => {
    const { g, n } = groupNode();
    const a = g.add(2);
    g.wire(a, n, "node_1");
    expect(setMembersMode(n, 2)).toBe(1);
    expect(a.mode).toBe(2);
  });
});
