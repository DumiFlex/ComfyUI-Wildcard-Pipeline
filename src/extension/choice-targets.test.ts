import { describe, expect, it } from "vitest";
import { describeChoiceTargets, fallbackChoices, findChoiceTargets, FIRST_OPTION } from "./choice-targets";
import type { LiteGraphLike, LiteLink, LiteNodeLike } from "./graph";

function graphOf(nodes: LiteNodeLike[], links: LiteLink[]): LiteGraphLike {
  return {
    _nodes: nodes,
    links: Object.fromEntries(links.map((l) => [l.id, l])),
    getNodeById: (id: number) => nodes.find((n) => n.id === id) ?? null,
  };
}

const choice: LiteNodeLike = { id: 1, type: "WP_VarToChoice", outputs: [{ name: "choice", links: [10] }] };
const widgets: { name: string; value: unknown; options: { values: string[] } }[] = [
  { name: "ckpt_name", value: "a", options: { values: ["a", "b", "c"] } },
];
const loader: LiteNodeLike = {
  id: 2,
  type: "CheckpointLoaderSimple",
  title: "Load Checkpoint",
  inputs: [{ name: "ckpt_name", link: 10 }],
  widgets,
};

describe("findChoiceTargets", () => {
  it("names the dropdown input and counts its options", () => {
    const g = graphOf([choice, loader], [{ id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 }]);
    const targets = findChoiceTargets(g, choice);
    expect(targets).toEqual([{ title: "Load Checkpoint", input: "ckpt_name", options: 3, values: ["a", "b", "c"] }]);
    expect(describeChoiceTargets(targets)).toBe("Load Checkpoint › ckpt_name · 3 options");
  });

  it("follows a legacy Reroute node", () => {
    const src: LiteNodeLike = { id: 1, type: "WP_VarToChoice", outputs: [{ name: "choice", links: [11] }] };
    const reroute: LiteNodeLike = { id: 5, type: "Reroute", outputs: [{ name: "", links: [10] }] };
    const g = graphOf(
      [src, reroute, loader],
      [
        { id: 11, origin_id: 1, origin_slot: 0, target_id: 5, target_slot: 0 },
        { id: 10, origin_id: 5, origin_slot: 0, target_id: 2, target_slot: 0 },
      ],
    );
    expect(findChoiceTargets(g, src)[0]?.title).toBe("Load Checkpoint");
  });

  it("reports an input without options, more targets, and nothing wired", () => {
    const sw: LiteNodeLike = { id: 3, type: "AnySwitch", inputs: [{ name: "any_01", link: 12 }] };
    const src: LiteNodeLike = { id: 1, type: "WP_VarToChoice", outputs: [{ name: "choice", links: [12, 10] }] };
    const g = graphOf(
      [src, sw, loader],
      [
        { id: 12, origin_id: 1, origin_slot: 0, target_id: 3, target_slot: 0 },
        { id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
      ],
    );
    // The loader (second) is what the run matches against; the switch has no list.
    expect(describeChoiceTargets(findChoiceTargets(g, src))).toBe("Load Checkpoint › ckpt_name · 3 options");
    expect(describeChoiceTargets([{ title: "AnySwitch", input: "any_01", options: null, values: null }])).toBe("AnySwitch › any_01 · no option list");
    expect(describeChoiceTargets([
      { title: "A", input: "x", options: 2, values: ["p", "q"] }, { title: "B", input: "y", options: 4, values: ["r", "s", "t", "u"] },
    ])).toBe("A › x · 2 options (+1 more)");
    expect(describeChoiceTargets([])).toBe("not wired: connect choice to a dropdown input");
    expect(findChoiceTargets(null, src)).toEqual([]);
  });

  it("fills the fallback dropdown from the first input with a list", () => {
    const sw = { title: "AnySwitch", input: "any_01", options: null, values: null };
    const ck = { title: "Load Checkpoint", input: "ckpt_name", options: 2, values: ["a", "b"] };
    expect(fallbackChoices([sw, ck])).toEqual([FIRST_OPTION, "a", "b"]);
    expect(fallbackChoices([sw])).toEqual([FIRST_OPTION]);
    expect(fallbackChoices([])).toEqual([FIRST_OPTION]);
  });
});
