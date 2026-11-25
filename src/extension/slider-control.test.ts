import { describe, it, expect } from "vitest";
import { ctlInputName, stripControlInputs, type CtlGraph, type CtlNode } from "./toggle-control";
import {
  applySliderControl,
  releaseSliderTargets,
  sliderControlState,
  sliderWiring,
  wantedSliderCtlInputs,
} from "./slider-control";
import { levelFor, parseSlidersConfig, type SliderRow, type SlidersConfig } from "./sliders";

function makeGraph() {
  const nodes = new Map<number | string, CtlNode>();
  const links = new Map<number, { origin_id: number | string; origin_slot: number }>();
  const graph: CtlGraph & { groups: NonNullable<CtlGraph["groups"]> } = { links, getNodeById: (id) => nodes.get(id), groups: [] };
  let nextLink = 1;
  function add(id: number | string, extra: Partial<CtlNode> = {}): CtlNode {
    const n: CtlNode = { id, mode: 0, title: `Node ${id}`, inputs: [], graph, ...extra };
    nodes.set(id, n);
    return n;
  }
  function wire(from: CtlNode, to: CtlNode, inputName: string): void {
    const id = nextLink++;
    links.set(id, { origin_id: from.id, origin_slot: 0 });
    (to.inputs ??= []).push({ name: inputName, link: id });
  }
  return { graph, add, wire };
}

function row(extra: Partial<SliderRow> = {}): SliderRow {
  return { id: "s1", kind: "slider", name: "Detail", var: "detail", value: 0.2, min: 0, max: 1, step: 0.05, decimals: 2, mode: "number", pin: false, out: 0, style: "row", ...extra };
}
const cfg = (...rows: SliderRow[]): SlidersConfig => ({ version: 1, rows });

describe("slider levels", () => {
  it("parses levels and the dot flag, keeping only known modes", () => {
    const c = parseSlidersConfig({ rows: [{ id: "a", kind: "slider", var: "a", levels: [{ upto: 0.5, mode: "mute", groups: ["G", "G", ""] }, { mode: "nope" }], hide_dot: true }] });
    const s = c.rows[0] as SliderRow;
    expect(s.levels).toEqual([{ upto: 0.5, mode: "mute", groups: ["G"] }, { mode: "run" }]);
    expect(s.hide_dot).toBe(true);
  });

  it("finds the level the value is in, like a Words range", () => {
    const levels = [{ upto: 0.3, mode: "run" as const }, { upto: 0.7, mode: "mute" as const }, { mode: "bypass" as const }];
    expect(levelFor(row({ value: 0.3, levels }))?.mode).toBe("run");
    expect(levelFor(row({ value: 0.5, levels }))?.mode).toBe("mute");
    expect(levelFor(row({ value: 0.9, levels }))?.mode).toBe("bypass");
    expect(levelFor(row())).toBeUndefined();
  });

  it("drives the wired node by the value's level, through one dot", () => {
    const g = makeGraph();
    const node = g.add(1, { type: "WP_Slider" });
    const lora = g.add(2);
    g.wire(lora, node, ctlInputName("s1"));
    const levels = [{ upto: 0.5, mode: "run" as const }, { mode: "bypass" as const }];
    expect(wantedSliderCtlInputs(cfg(row({ levels })))).toEqual(["ctl_s1"]);
    applySliderControl(node, cfg(row({ value: 0.2, levels })));
    expect(lora.mode).toBe(0);
    applySliderControl(node, cfg(row({ value: 0.8, levels })));
    expect(lora.mode).toBe(4);
    expect(sliderControlState(node, row({ value: 0.8, levels }))).toMatchObject({ control: "bypass", active: true });
    expect(sliderControlState(node, row({ value: 0.2, levels }))).toMatchObject({ control: "bypass", active: false });
    // A groups-only slider drops the wire: no dot, nothing wired counts.
    expect(wantedSliderCtlInputs(cfg(row({ levels, hide_dot: true })))).toEqual([]);
    expect(sliderWiring(node, cfg(row({ levels, hide_dot: true }))).size).toBe(0);
  });

  it("gives each range's groups that range's mode and runs the other ranges' groups", () => {
    const g = makeGraph();
    const node = g.add(1, { type: "WP_Slider" });
    const a = g.add(2);
    const b = g.add(3);
    g.graph.groups.push({ title: "Low", _children: new Set([a]) }, { title: "High", _children: new Set([b]) });
    const levels = [{ upto: 0.5, mode: "bypass" as const, groups: ["Low"] }, { mode: "mute" as const, groups: ["High"] }];
    applySliderControl(node, cfg(row({ value: 0.2, levels })));
    expect([a.mode, b.mode]).toEqual([4, 0]);
    applySliderControl(node, cfg(row({ value: 0.9, levels })));
    expect([a.mode, b.mode]).toEqual([0, 2]);
    // A node two sliders drive keeps the stronger mode.
    applySliderControl(node, cfg(row({ value: 0.9, levels }), row({ id: "s2", var: "x", value: 0.2, levels })));
    expect([a.mode, b.mode]).toEqual([4, 2]);
  });

  it("lets go of nodes it no longer drives, and drops its links from the prompt", () => {
    const n = { id: 5, mode: 4 } as CtlNode;
    const hand = { id: 6, mode: 1 } as CtlNode;
    expect(releaseSliderTargets([n, hand])).toBe(1);
    expect([n.mode, hand.mode]).toEqual([0, 1]);
    const out = { "1": { class_type: "WP_Slider", inputs: { wp_sliders: "{}", ctl_s1: ["2", 0] } } };
    stripControlInputs(out);
    expect(out["1"].inputs).toEqual({ wp_sliders: "{}" });
  });
});
