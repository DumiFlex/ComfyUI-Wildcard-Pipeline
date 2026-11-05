import { describe, expect, it } from "vitest";
import { isMergeable, mergeIntoToggles, mergedConfig } from "./toggles-merge";

function Boolean_(): void {}
Boolean_.title = "Boolean";
function boolNode(id: number, title: string, value: boolean, y: number, links: number[] = []) {
  const n = Object.assign(Object.create({ constructor: Boolean_ }) as object, {
    id, type: "PrimitiveBoolean", title, pos: [0, y],
    inputs: [], outputs: [{ type: "BOOLEAN", links }],
    widgets: [{ name: "value", type: "toggle", value }],
  });
  return n as unknown as Parameters<typeof isMergeable>[0];
}

describe("merge into WP Toggles", () => {
  it("picks nodes by shape, not type", () => {
    expect(isMergeable(boolNode(1, "A", true, 0))).toBe(true);
    const wired = boolNode(2, "B", true, 0);
    wired.inputs = [{ link: 5 }];
    expect(isMergeable(wired)).toBe(false);
    const two = boolNode(3, "C", true, 0);
    two.widgets = [...(two.widgets ?? []), { name: "x", value: false }];
    expect(isMergeable(two)).toBe(false);
    const img = boolNode(4, "D", true, 0);
    img.outputs = [{ type: "IMAGE" }];
    expect(isMergeable(img)).toBe(false);
  });

  it("names toggles after titles and keeps values", () => {
    const cfg = mergedConfig([boolNode(1, "Use subject LoRA?", true, 0), boolNode(2, "Boolean", false, 10)]);
    expect(cfg.rows.map((r) => r.kind === "toggle" && [r.name, r.var, r.on, r.out])).toEqual([
      ["Use subject LoRA?", "use_subject_lora", true, 1],
      ["Toggle 2", "toggle_2", false, 2],
    ]);
  });

  it("moves wires and removes the old nodes in one change", () => {
    const a = boolNode(1, "Second", false, 50, [10]);
    const b = boolNode(2, "First", true, 0, [11]);
    const other = { ...boolNode(3, "Img", true, 0), outputs: [{ type: "IMAGE" }], title: "Img" };
    const target = boolNode(9, "T", true, 0);
    const calls: string[] = [];
    const made = { ...boolNode(20, "WP Toggles", false, 0), type: "WP_Toggles", outputs: [], widgets: [{ name: "wp_toggles", value: "" }],
      connect: (slot: number, t: { id: unknown }, ts: number) => calls.push(`connect ${slot}->${String(t.id)}:${ts}`) };
    const graph = {
      links: new Map([[10, { target_id: 9, target_slot: 0 }], [11, { target_id: 9, target_slot: 1 }]]),
      add: () => calls.push("add"),
      remove: (n: { id: unknown }) => calls.push(`remove ${String(n.id)}`),
      getNodeById: (id: number | string) => (id === 9 ? target : null),
      beforeChange: () => calls.push("before"),
      afterChange: () => calls.push("after"),
    };
    const res = mergeIntoToggles(graph, [a, b, other], () => made);
    expect(res).toEqual({ merged: 2, skipped: ["Img"] });
    expect(calls).toEqual(["before", "add", "remove 2", "connect 1->9:1", "remove 1", "connect 2->9:0", "after"]);
    expect(JSON.parse(made.widgets[0].value as string).rows.map((r: { name: string }) => r.name)).toEqual(["First", "Second"]);
  });
});
