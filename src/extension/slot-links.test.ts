import { describe, expect, it, vi } from "vitest";
import { inputLinkId, isInputWired, outputLinkIds } from "./slot-links";

describe("slot-links on plain data slots", () => {
  it("reads input.link and output.links as data", () => {
    expect(inputLinkId({ link: 7 })).toBe(7);
    expect(inputLinkId({ link: null })).toBeNull();
    expect(inputLinkId({})).toBeNull();
    expect(inputLinkId(null)).toBeNull();
    expect(isInputWired({ link: 3 })).toBe(true);
    expect(isInputWired({ link: null })).toBe(false);
    expect(outputLinkIds({ links: [4, 2] })).toEqual([4, 2]);
    expect(outputLinkIds({ links: null })).toEqual([]);
    expect(outputLinkIds(undefined)).toEqual([]);
  });
});

/** A 1.58-style slot: `link` / `links` are getters that warn. */
function makeGraph(links: unknown) {
  const warn = vi.fn();
  class InputSlot {
    constructor(public node: unknown) {}
    get link(): number | null {
      warn("link");
      return 999;
    }
  }
  class OutputSlot {
    constructor(public node: unknown) {}
    get links(): number[] | null {
      warn("links");
      return [999];
    }
  }
  const node: {
    id: number;
    graph: { links: unknown };
    inputs: InputSlot[];
    outputs: OutputSlot[];
    getInputLink: (slot: number) => { id: number } | null;
  } = {
    id: 5,
    graph: { links },
    inputs: [],
    outputs: [],
    getInputLink: (slot) => (slot === 1 ? { id: 11 } : null),
  };
  node.inputs = [new InputSlot(node), new InputSlot(node)];
  node.outputs = [new OutputSlot(node), new OutputSlot(node)];
  return { node, warn };
}

const records = [
  { id: 30, origin_id: 5, origin_slot: 0 },
  { id: 12, origin_id: "5", origin_slot: 0 },
  { id: 40, origin_id: 5, origin_slot: 1 },
  { id: 50, origin_id: 6, origin_slot: 0 },
];

describe("slot-links on getter slots (frontend 1.58)", () => {
  it("reads inputs through node.getInputLink without touching the getter", () => {
    const { node, warn } = makeGraph(new Map());
    expect(inputLinkId(node.inputs[1])).toBe(11);
    expect(inputLinkId(node.inputs[0])).toBeNull();
    expect(isInputWired(node.inputs[1])).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads outputs from a Map of links, sorted, matching node and slot", () => {
    const { node, warn } = makeGraph(new Map(records.map((r) => [r.id, r])));
    expect(outputLinkIds(node.outputs[0])).toEqual([12, 30]);
    expect(outputLinkIds(node.outputs[1])).toEqual([40]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads outputs from an object of links", () => {
    const { node } = makeGraph(Object.fromEntries(records.map((r) => [r.id, r])));
    expect(outputLinkIds(node.outputs[0])).toEqual([12, 30]);
  });

  it("returns nothing when the node has no graph or getInputLink throws", () => {
    const { node } = makeGraph(new Map());
    node.getInputLink = () => {
      throw new Error("detached");
    };
    expect(inputLinkId(node.inputs[1])).toBeNull();
    (node as { graph: unknown }).graph = null;
    expect(outputLinkIds(node.outputs[0])).toEqual([]);
  });
});
