import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  attachCollapsableConnections,
  countMatching,
  firstMatchingIndex,
  isCollapsed,
  setCollapsed,
} from "./collapse-connections";

type MockSlot = { name?: string; type?: string; link?: number | null };

interface MockNode {
  inputs: MockSlot[];
  outputs: MockSlot[];
  properties: Record<string, unknown>;
  setDirtyCanvas?: ReturnType<typeof vi.fn>;
  graph?: { setDirtyCanvas?: ReturnType<typeof vi.fn> };
  getInputPos?: (slot: number) => [number, number];
  getOutputPos?: (slot: number) => [number, number];
  getConnectionPos?: (isInput: boolean, slot: number) => [number, number];
  computeSize?: () => [number, number];
  // Track original returns so tests can stub deterministic positions.
  __origPositions?: { input: [number, number][]; output: [number, number][] };
  __origSize?: [number, number];
}

function makeNode(opts: {
  inputs?: MockSlot[];
  outputs?: MockSlot[];
  size?: [number, number];
  inputPositions?: [number, number][];
  outputPositions?: [number, number][];
}): MockNode {
  const inputs = opts.inputs ?? [];
  const outputs = opts.outputs ?? [];
  const inputPositions = opts.inputPositions ?? inputs.map((_, i) => [0, i * 20] as [number, number]);
  const outputPositions = opts.outputPositions ?? outputs.map((_, i) => [100, i * 20] as [number, number]);
  const size = opts.size ?? [200, Math.max(inputs.length, outputs.length) * 20];

  const node: MockNode = {
    inputs,
    outputs,
    properties: {},
    setDirtyCanvas: vi.fn(),
    __origPositions: { input: inputPositions, output: outputPositions },
    __origSize: [size[0], size[1]],
  };

  node.getInputPos = (slot: number) => inputPositions[slot] ?? [0, 0];
  node.getOutputPos = (slot: number) => outputPositions[slot] ?? [0, 0];
  node.getConnectionPos = (isInput: boolean, slot: number) =>
    isInput ? (inputPositions[slot] ?? [0, 0]) : (outputPositions[slot] ?? [0, 0]);
  node.computeSize = () => [size[0], size[1]];
  return node;
}

describe("collapse-connections — helpers", () => {
  it("firstMatchingIndex returns -1 when no slot matches", () => {
    const slots = [{ name: "a" }, { name: "b" }];
    expect(firstMatchingIndex(slots, () => false)).toBe(-1);
  });

  it("firstMatchingIndex returns the first matching slot's index, not the lowest", () => {
    const slots = [{ name: "ctx" }, { name: "input_0" }, { name: "input_1" }];
    const match = (s: MockSlot) => /^input_/.test(s.name ?? "");
    expect(firstMatchingIndex(slots, match)).toBe(1);
  });

  it("firstMatchingIndex skips null/undefined entries", () => {
    const slots = [null, undefined, { name: "input_0" }];
    const match = (s: MockSlot) => /^input_/.test(s.name ?? "");
    expect(firstMatchingIndex(slots as MockSlot[], match)).toBe(2);
  });

  it("countMatching counts matched slots only", () => {
    const slots = [{ name: "ctx" }, { name: "input_0" }, { name: "input_1" }];
    const match = (s: MockSlot) => /^input_/.test(s.name ?? "");
    expect(countMatching(slots, match)).toBe(2);
  });
});

describe("collapse-connections — state api", () => {
  it("isCollapsed false by default, true once setCollapsed(true) runs", () => {
    const node = makeNode({});
    expect(isCollapsed(node)).toBe(false);
    setCollapsed(node, true);
    expect(isCollapsed(node)).toBe(true);
  });

  it("setCollapsed with no arg toggles", () => {
    const node = makeNode({});
    expect(setCollapsed(node)).toBe(true);
    expect(setCollapsed(node)).toBe(false);
    expect(setCollapsed(node)).toBe(true);
  });

  it("setCollapsed writes to node.properties at the configured key", () => {
    const node = makeNode({});
    setCollapsed(node, true, "fold_inputs");
    expect(node.properties.fold_inputs).toBe(true);
    expect(node.properties.collapse_connections).toBeUndefined();
  });

  it("setCollapsed prefers graph.setDirtyCanvas when present", () => {
    const node = makeNode({});
    const graphRepaint = vi.fn();
    node.graph = { setDirtyCanvas: graphRepaint };
    setCollapsed(node, true);
    expect(graphRepaint).toHaveBeenCalledWith(true, true);
    expect(node.setDirtyCanvas).not.toHaveBeenCalled();
  });

  it("setCollapsed falls back to node.setDirtyCanvas when no graph", () => {
    const node = makeNode({});
    setCollapsed(node, true);
    expect(node.setDirtyCanvas).toHaveBeenCalledWith(true, true);
  });
});

describe("collapse-connections — position patch", () => {
  function setupInjectorLikeNode() {
    // Layout: 1 fixed input (context_in) + 3 dynamic input_* + 1 output.
    // Only dynamic input_* should collapse; the fixed input keeps its
    // own Y so the upstream Context wire reads correctly.
    return makeNode({
      inputs: [
        { name: "context_in" },
        { name: "input_0" },
        { name: "input_1" },
        { name: "input_2" },
      ],
      outputs: [{ name: "context_out" }],
      inputPositions: [
        [0, 0],   // context_in at y=0
        [0, 20],  // input_0
        [0, 40],
        [0, 60],
      ],
    });
  }

  const matchInput = (s: MockSlot) => /^input_\d+$/.test(s.name ?? "");

  it("expanded: matched and non-matched inputs return original positions", () => {
    const node = setupInjectorLikeNode();
    attachCollapsableConnections(node, { matchInput });
    expect(node.getInputPos!(0)).toEqual([0, 0]);
    expect(node.getInputPos!(1)).toEqual([0, 20]);
    expect(node.getInputPos!(3)).toEqual([0, 60]);
  });

  it("collapsed: matched inputs all return first-matched position; non-matched untouched", () => {
    const node = setupInjectorLikeNode();
    attachCollapsableConnections(node, { matchInput });
    setCollapsed(node, true);
    // context_in untouched at y=0.
    expect(node.getInputPos!(0)).toEqual([0, 0]);
    // All three input_* now report input_0's y=20.
    expect(node.getInputPos!(1)).toEqual([0, 20]);
    expect(node.getInputPos!(2)).toEqual([0, 20]);
    expect(node.getInputPos!(3)).toEqual([0, 20]);
  });

  it("getConnectionPos legacy method routes through the same logic", () => {
    const node = setupInjectorLikeNode();
    attachCollapsableConnections(node, { matchInput });
    setCollapsed(node, true);
    expect(node.getConnectionPos!(true, 2)).toEqual([0, 20]);
    expect(node.getConnectionPos!(true, 0)).toEqual([0, 0]);
  });

  it("outputs untouched when only matchInput supplied", () => {
    const node = setupInjectorLikeNode();
    attachCollapsableConnections(node, { matchInput });
    setCollapsed(node, true);
    expect(node.getOutputPos!(0)).toEqual([100, 0]);
  });

  it("matchOutput predicate collapses outputs independently", () => {
    const node = makeNode({
      inputs: [],
      outputs: [{ name: "passthrough" }, { name: "fold_0" }, { name: "fold_1" }],
      outputPositions: [[100, 0], [100, 20], [100, 40]],
    });
    attachCollapsableConnections(node, {
      matchOutput: (s) => /^fold_/.test(s.name ?? ""),
    });
    setCollapsed(node, true);
    expect(node.getOutputPos!(0)).toEqual([100, 0]);   // passthrough untouched
    expect(node.getOutputPos!(1)).toEqual([100, 20]);  // first fold — anchor
    expect(node.getOutputPos!(2)).toEqual([100, 20]);  // fold_1 → fold_0's y
  });

  it("computeSize shrinks by (matchedInputs - 1) * slotHeight when collapsed", () => {
    const node = setupInjectorLikeNode();
    const before = node.computeSize!();
    attachCollapsableConnections(node, { matchInput });
    setCollapsed(node, true);
    const after = node.computeSize!();
    // 3 matched inputs → hide 2 rows. Default fallback NODE_SLOT_HEIGHT = 20.
    expect(after[1]).toBe(before[1] - 2 * 20);
  });

  it("computeSize untouched when collapse is off", () => {
    const node = setupInjectorLikeNode();
    const before = node.computeSize!();
    attachCollapsableConnections(node, { matchInput });
    const after = node.computeSize!();
    expect(after[1]).toBe(before[1]);
  });

  it("attachCollapsableConnections is idempotent — second call no-ops", () => {
    const node = setupInjectorLikeNode();
    attachCollapsableConnections(node, { matchInput });
    const patched = node.getInputPos;
    attachCollapsableConnections(node, { matchInput });
    expect(node.getInputPos).toBe(patched);
  });

  it("custom propertyKey isolates state from default", () => {
    const node = setupInjectorLikeNode();
    attachCollapsableConnections(node, { matchInput, propertyKey: "wp_fold_inputs" });
    setCollapsed(node, true, "wp_fold_inputs");
    expect(node.getInputPos!(2)).toEqual([0, 20]);  // collapsed
    // The default key is still false — verify reading the wrong key
    // yields the un-collapsed pos to confirm isolation.
    expect(isCollapsed(node)).toBe(false);
    expect(isCollapsed(node, "wp_fold_inputs")).toBe(true);
  });
});

describe("collapse-connections — uses LiteGraph.NODE_SLOT_HEIGHT when present", () => {
  type LGGlobal = typeof globalThis & { LiteGraph?: { NODE_SLOT_HEIGHT?: number } };

  beforeEach(() => {
    (globalThis as LGGlobal).LiteGraph = { NODE_SLOT_HEIGHT: 32 };
  });
  afterEach(() => {
    delete (globalThis as LGGlobal).LiteGraph;
  });

  it("shrinks by configured slot height instead of fallback", () => {
    const node = makeNode({
      inputs: [{ name: "input_0" }, { name: "input_1" }],
      inputPositions: [[0, 0], [0, 32]],
      size: [200, 64],
    });
    attachCollapsableConnections(node, {
      matchInput: (s) => /^input_/.test(s.name ?? ""),
    });
    setCollapsed(node, true);
    expect(node.computeSize!()[1]).toBe(64 - 32);
  });
});
