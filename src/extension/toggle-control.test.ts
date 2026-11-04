import { describe, expect, it } from "vitest";
import {
  applyControl,
  controlState,
  drivesOff,
  canvasGroupOf,
  canvasGroupsOf,
  strongerMode,
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
import { combinedState, parseRelayMap, relay, relayTargets, watched, type RelayNode } from "./mode-relay";
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

  it("inverts: on mutes / bypasses", () => {
    const g = makeGraph();
    const toggles = g.add(1);
    const a = g.add(2);
    g.wire(a, toggles, ctlInputName("a"));
    applyControl(toggles, cfg([tog("a", { on: true, control: "bypass", invert: true })]));
    expect(a.mode).toBe(4);
    applyControl(toggles, cfg([tog("a", { on: false, control: "bypass", invert: true })]));
    expect(a.mode).toBe(0);
    expect([drivesOff(true, true), drivesOff(false, undefined), drivesOff(true, undefined)]).toEqual([true, true, false]);
  });

  it("gives the row icon's state and tooltip", () => {
    const n = (id: number, title = "") => ({ id, title, mode: 0 });
    expect(controlState([], "mute", [], false, undefined)).toBeNull();
    expect(controlState([n(1, "LoRA")], "bypass", [], false, undefined))
      .toEqual({ control: "bypass", active: true, hint: "Bypasses now: LoRA" });
    expect(controlState([n(1, "A"), n(2)], "mute", ["Detail"], true, undefined))
      .toEqual({ control: "mute", active: false, hint: "Mutes when off: A, #2, group Detail" });
    expect(controlState([1, 2, 3, 4, 5, 6].map((i) => n(i, `N${i}`)), "mute", ["X", "Y"], false, true)?.hint)
      .toBe("Mutes when on: N1, N2, N3, N4, 2 more, 2 groups");
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

describe("WP Mode Relay", () => {
  it("combines watched modes", () => {
    expect(combinedState([])).toBeNull();
    expect(combinedState([2, 2])).toBe("muted");
    expect(combinedState([4, 4])).toBe("bypassed");
    expect(combinedState([2, 0, 4])).toBe("on");
    expect(combinedState([2, 4])).toBeNull();
  });

  it("reads its map, defaulting what is missing", () => {
    expect(parseRelayMap(null)).toEqual({ muted: "mute", bypassed: "bypass", on: "run" });
    expect(parseRelayMap({ muted: "bypass", on: "nothing", bypassed: "x" })).toEqual({ muted: "bypass", bypassed: "bypass", on: "nothing" });
  });

  it("drives a node group's members (not the relay), mapped", () => {
    const g = makeGraph();
    const watchedNode = g.add(1, { mode: 2 });
    const relayNode = g.add(2, { type: "WP_ModeRelay", isVirtualNode: true }) as RelayNode;
    const group = g.add(3, { type: "WP_NodeGroup" });
    const member = g.add(4);
    g.wire(watchedNode, relayNode, "node_1");
    g.wire(member, group, "node_1");
    g.wire(relayNode, group, "node_2");
    relayNode.outputs = [{ links: [3] }];
    (g.graph.links as Map<number, { origin_id: number | string; origin_slot: number; target_id?: number }>).set(3, { origin_id: 2, origin_slot: 0, target_id: 3 });
    expect(watched(relayNode)).toEqual([watchedNode]);
    expect(relayTargets(relayNode)).toEqual([member]);
    expect(members(group as GroupHostNode)).toEqual([member]);
    expect(relay(relayNode, "muted", { muted: "bypass", bypassed: "bypass", on: "run" })).toBe(1);
    expect(member.mode).toBe(4);
    expect(relay(relayNode, "on", { muted: "mute", bypassed: "bypass", on: "nothing" })).toBe(0);
    expect(relay(relayNode, null, parseRelayMap(null))).toBe(0);
  });
});

describe("WP Node Group standing for its canvas group", () => {
  it("gathers every node of the canvas group it sits in when nothing is wired in", () => {
    const g = makeGraph();
    const n = g.add(1, { type: "WP_NodeGroup", isVirtualNode: true }) as GroupHostNode;
    const a = g.add(2);
    const b = g.add(3);
    const note = g.add(4, { isVirtualNode: true });
    g.add(5); // outside the group
    g.graph.groups.push({ title: "Upscale", _children: new Set([n, a, b, note]), size: [400, 300] });
    expect(canvasGroupOf(n)?.title).toBe("Upscale");
    expect(members(n)).toEqual([a, b]);
    expect(setMembersMode(n, 4)).toBe(2);
    expect([a.mode, b.mode]).toEqual([4, 4]);
  });

  it("picks the smallest group when groups nest", () => {
    const g = makeGraph();
    const n = g.add(1, { type: "WP_NodeGroup", isVirtualNode: true }) as GroupHostNode;
    const inner = g.add(2);
    const outer = g.add(3);
    g.graph.groups.push({ title: "Outer", _children: new Set([n, inner, outer]), size: [900, 900] });
    g.graph.groups.push({ title: "Inner", _children: new Set([n, inner]), _bounding: [0, 0, 300, 200] });
    expect(canvasGroupOf(n)?.title).toBe("Inner");
    expect(members(n)).toEqual([inner]);
  });

  it("drives only its wired nodes once anything real is wired in", () => {
    const g = makeGraph();
    const n = g.add(1, { type: "WP_NodeGroup", isVirtualNode: true }) as GroupHostNode;
    const a = g.add(2);
    const b = g.add(3);
    g.graph.groups.push({ title: "G", _children: new Set([n, a, b]) });
    g.wire(a, n, "node_1");
    expect(canvasGroupOf(n)).toBeNull();
    expect(members(n)).toEqual([a]);
  });

  it("does nothing outside any group", () => {
    const g = makeGraph();
    const n = g.add(1, { type: "WP_NodeGroup", isVirtualNode: true }) as GroupHostNode;
    g.add(2);
    expect(canvasGroupOf(n)).toBeNull();
    expect(members(n)).toEqual([]);
  });

  it("still stands for the group with only a relay wired in, leaving out what the relay watches", () => {
    const g = makeGraph();
    const n = g.add(1, { type: "WP_NodeGroup", isVirtualNode: true }) as GroupHostNode;
    const relayNode = g.add(2, { type: "WP_ModeRelay", isVirtualNode: true });
    const watchedNode = g.add(3);
    const member = g.add(4);
    g.wire(watchedNode, relayNode, "node_1");
    g.wire(relayNode, n, "node_1");
    g.graph.groups.push({ title: "G", _children: new Set([n, relayNode, watchedNode, member]) });
    expect(canvasGroupOf(n)?.title).toBe("G");
    expect(members(n)).toEqual([member]);
  });

  it("lets a toggle drive the whole group through the group node, never itself", () => {
    const g = makeGraph();
    const toggles = g.add(1, { type: "WP_Toggles" });
    const n = g.add(2, { type: "WP_NodeGroup", isVirtualNode: true });
    const a = g.add(3);
    g.wire(n, toggles, ctlInputName("t1"));
    g.graph.groups.push({ title: "G", _children: new Set([toggles, n, a]) });
    expect(toggleTargets(toggles, "t1")).toEqual([a]);
  });
});

describe("nested canvas groups (Dumi's layout)", () => {
  function layout() {
    const g = makeGraph();
    const toggles = g.add(1, { type: "WP_Toggles" });
    const outerNg = g.add(2, { type: "WP_NodeGroup", isVirtualNode: true });
    const innerNg = g.add(3, { type: "WP_NodeGroup", isVirtualNode: true });
    const outerText = g.add(4);
    const innerText = g.add(5);
    g.graph.groups.push({ title: "Outer", _children: new Set([outerNg, innerNg, outerText, innerText]), size: [900, 600] });
    g.graph.groups.push({ title: "Inner", _children: new Set([innerNg, innerText]), size: [480, 400] });
    g.wire(innerNg, toggles, ctlInputName("t1"));
    g.wire(outerNg, toggles, ctlInputName("t2"));
    return { g, toggles, outerNg, innerNg, outerText, innerText };
  }

  it("each group node takes its smallest group; the outer one includes the inner group", () => {
    const { outerNg, innerNg, outerText, innerText } = layout();
    expect(members(innerNg as GroupHostNode)).toEqual([innerText]);
    expect(new Set(members(outerNg as GroupHostNode))).toEqual(new Set([outerText, innerText]));
  });

  it("'Not inner' leaves out the inner group's nodes", () => {
    const { outerNg, outerText } = layout();
    outerNg.properties = { wp_covers: "own" };
    expect(members(outerNg as GroupHostNode)).toEqual([outerText]);
  });

  it("'Every group' covers outer groups too", () => {
    const { innerNg, outerText, innerText } = layout();
    innerNg.properties = { wp_covers: "all" };
    expect(canvasGroupsOf(innerNg).map((x) => x.title)).toEqual(["Inner", "Outer"]);
    expect(new Set(members(innerNg as GroupHostNode))).toEqual(new Set([innerText, outerText]));
  });

  it("off wins: the inner text stays bypassed while either toggle is off, in any order", () => {
    const { toggles, outerText, innerText } = layout();
    const rows = [tog("t1", { control: "bypass", on: true }), tog("t2", { control: "bypass", on: false })];
    applyControl(toggles, cfg(rows));
    expect([outerText.mode, innerText.mode]).toEqual([4, 4]);
    applyControl(toggles, cfg([...rows].reverse()));
    expect([outerText.mode, innerText.mode]).toEqual([4, 4]);
    applyControl(toggles, cfg(rows), new Set(["t1"]));
    expect(innerText.mode).toBe(4);
    applyControl(toggles, cfg([tog("t1", { control: "bypass", on: true }), tog("t2", { control: "bypass", on: true })]));
    expect([outerText.mode, innerText.mode]).toEqual([0, 0]);
  });

  it("mute beats bypass", () => {
    expect(strongerMode(undefined, 0)).toBe(0);
    expect(strongerMode(0, 4)).toBe(4);
    expect(strongerMode(4, 2)).toBe(2);
    expect(strongerMode(2, 4)).toBe(2);
  });
});
