import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyCollapsedLabels,
  attachCollapsableConnections,
  countMatching,
  firstMatchingIndex,
  isCollapsed,
  readSlotLabel,
  relabelSlotIf,
  setCollapsed,
} from "./collapse-connections";
import { slotLabelStashed, slotOrigLabel } from "./_stashes";

type MockSlot = {
  name?: string;
  label?: string;
  type?: string;
  link?: number | null;
};

interface MockNode {
  inputs: MockSlot[];
  outputs: MockSlot[];
  properties: Record<string, unknown>;
  size?: [number, number];
  setDirtyCanvas?: ReturnType<typeof vi.fn>;
  setSize?: ReturnType<typeof vi.fn>;
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
    size: [size[0], size[1]],
    setDirtyCanvas: vi.fn(),
    setSize: vi.fn(),
    __origPositions: { input: inputPositions, output: outputPositions },
    __origSize: [size[0], size[1]],
  };
  // Wire setSize to update size in place (mirrors litegraph behavior).
  node.setSize!.mockImplementation((s: [number, number]) => {
    node.size = [s[0], s[1]];
  });

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

describe("collapse-connections — unified label + resize side effects", () => {
  // setCollapsed animates the height tween via rAF. Force the
  // no-motion path so setSize is called synchronously and tests can
  // assert against it without flushing animation frames.
  beforeEach(() => {
    document.body.classList.add("wp-a11y-no-motion");
  });
  afterEach(() => {
    document.body.classList.remove("wp-a11y-no-motion");
  });

  function makeInjectorLike() {
    return makeNode({
      inputs: [
        { name: "context_in", label: "context" },
        { name: "input_0", label: "input_0" },
        { name: "input_1", label: "input_1" },
        { name: "input_2", label: "input_2" },
      ],
      inputPositions: [[0, 0], [0, 20], [0, 40], [0, 60]],
      size: [240, 80],
    });
  }

  const matchInput = (s: MockSlot) => /^input_\d+$/.test(s.name ?? "");

  it("setCollapsed(true) swaps first matched label to configured + blanks the rest", () => {
    const node = makeInjectorLike();
    attachCollapsableConnections(node, {
      matchInput,
      collapsedInputLabel: "inputs",
    });
    setCollapsed(node, true);
    expect(node.inputs[0].label).toBe("context");  // non-matched untouched
    expect(node.inputs[1].label).toBe("inputs");   // first matched → unified
    expect(node.inputs[2].label).toBe(" ");        // rest blanked
    expect(node.inputs[3].label).toBe(" ");
  });

  it("setCollapsed(false) restores original labels from the slotOrigLabel stash", () => {
    const node = makeInjectorLike();
    attachCollapsableConnections(node, {
      matchInput,
      collapsedInputLabel: "inputs",
    });
    setCollapsed(node, true);
    setCollapsed(node, false);
    expect(node.inputs[1].label).toBe("input_0");
    expect(node.inputs[2].label).toBe("input_1");
    expect(node.inputs[3].label).toBe("input_2");
    // Stash cleaned up so a future collapse re-snapshots fresh labels.
    expect(slotLabelStashed.has(node.inputs[1])).toBe(false);
  });

  it("collapsedInputLabel undefined keeps the first slot's original label", () => {
    const node = makeInjectorLike();
    attachCollapsableConnections(node, { matchInput });
    setCollapsed(node, true);
    expect(node.inputs[1].label).toBe("input_0");  // original kept
    expect(node.inputs[2].label).toBe(" ");
  });

  it("collapsedInputLabel function receives the node and computes per-state", () => {
    const node = makeInjectorLike();
    attachCollapsableConnections(node, {
      matchInput,
      collapsedInputLabel: (n) => `${countMatching(n.inputs, matchInput)} inputs`,
    });
    setCollapsed(node, true);
    expect(node.inputs[1].label).toBe("3 inputs");
  });

  it("setCollapsed calls setSize with shrunk height when collapsed", () => {
    const node = makeInjectorLike();
    attachCollapsableConnections(node, { matchInput });
    setCollapsed(node, true);
    expect(node.setSize).toHaveBeenCalled();
    const lastCall = node.setSize!.mock.calls[node.setSize!.mock.calls.length - 1];
    expect(lastCall[0][1]).toBe(80 - 2 * 20);  // shrunk by 2 hidden slots
  });

  it("setCollapsed preserves the current width (no width snap-back)", () => {
    const node = makeInjectorLike();
    node.size = [400, 80];  // user widened past computeSize's 240
    attachCollapsableConnections(node, { matchInput });
    setCollapsed(node, true);
    const lastCall = node.setSize!.mock.calls[node.setSize!.mock.calls.length - 1];
    expect(lastCall[0][0]).toBe(400);  // width unchanged
  });

  it("workflow loaded with collapsed=true applies labels + resize on attach", () => {
    const node = makeInjectorLike();
    node.properties.collapse_connections = true;
    attachCollapsableConnections(node, {
      matchInput,
      collapsedInputLabel: "inputs",
    });
    expect(node.inputs[1].label).toBe("inputs");
    expect(node.setSize).toHaveBeenCalled();
  });

  it("applyCollapsedLabels exported for manual re-sync after runtime slot mutation", () => {
    const node = makeInjectorLike();
    attachCollapsableConnections(node, {
      matchInput,
      collapsedInputLabel: "inputs",
    });
    setCollapsed(node, true);
    // Simulate runtime mutation: new input_3 appended after collapse.
    node.inputs.push({ name: "input_3", label: "input_3" });
    applyCollapsedLabels(node);
    expect(node.inputs[4].label).toBe(" ");  // newly added matched slot gets blank
  });

  it("setCollapsed without prior attach skips label/size side effects", () => {
    const node = makeInjectorLike();
    setCollapsed(node, true);
    expect(node.inputs[1].label).toBe("input_0");  // unchanged
    expect(node.setSize).not.toHaveBeenCalled();
  });

  it("slots with no explicit .label restore to undefined (name-fallback) on expand", () => {
    // Regression: slots created via litegraph addInput often have
    // .label === undefined and rely on .name fallback. The old code
    // used `=== undefined` to detect "never stashed", which collided
    // with "stashed as undefined" and broke restore.
    const node = makeNode({
      inputs: [
        { name: "input_0" },  // NO explicit label
        { name: "input_1" },
        { name: "input_2" },
      ],
      inputPositions: [[0, 0], [0, 20], [0, 40]],
      size: [200, 60],
    });
    attachCollapsableConnections(node, {
      matchInput,
      collapsedInputLabel: "inputs",
    });
    setCollapsed(node, true);
    expect(node.inputs[0].label).toBe("inputs");
    expect(node.inputs[1].label).toBe(" ");

    setCollapsed(node, false);
    // After restore, .label property should be DELETED so litegraph
    // re-uses .name for display.
    expect("label" in node.inputs[0]).toBe(false);
    expect("label" in node.inputs[1]).toBe(false);
    // Stash cleaned up via the WeakMap+WeakSet so next collapse re-snapshots.
    expect(slotLabelStashed.has(node.inputs[0])).toBe(false);
    expect(slotLabelStashed.has(node.inputs[1])).toBe(false);
    expect(slotOrigLabel.has(node.inputs[0])).toBe(false);
  });

  it("user modifies a label between collapse cycles — second expand restores the new value", () => {
    // Regression: stash is cleared on every expand, so the next
    // collapse re-snapshots fresh — preserving any label edits the
    // user made while expanded.
    const node = makeInjectorLike();
    attachCollapsableConnections(node, { matchInput, collapsedInputLabel: "inputs" });

    // Cycle 1: collapse + expand. Labels restored to originals.
    setCollapsed(node, true);
    setCollapsed(node, false);
    expect(node.inputs[1].label).toBe("input_0");

    // User renames a slot's label while expanded.
    node.inputs[1].label = "renamed_by_user";

    // Cycle 2: collapse + expand. The user's edit must survive.
    setCollapsed(node, true);
    setCollapsed(node, false);
    expect(node.inputs[1].label).toBe("renamed_by_user");
  });

  it("repeated collapse calls don't overwrite the stash with the placeholder", () => {
    // Regression: calling applyCollapsedLabels multiple times while
    // collapsed (e.g. from normalizeSlots) must not re-stash the
    // current label (" " placeholder), or expand would restore to
    // blank instead of the user's original.
    const node = makeInjectorLike();
    attachCollapsableConnections(node, { matchInput, collapsedInputLabel: "inputs" });
    setCollapsed(node, true);
    // Simulate normalizeSlots running again while collapsed.
    applyCollapsedLabels(node);
    applyCollapsedLabels(node);
    setCollapsed(node, false);
    expect(node.inputs[1].label).toBe("input_0");
    expect(node.inputs[2].label).toBe("input_1");
  });
});

describe("collapse-connections — relabelSlotIf", () => {
  it("updates live label when predicate matches", () => {
    const slot: MockSlot = { name: "input_3", label: "input_3" };
    relabelSlotIf(slot, "input_2", (cur) => cur === "input_3");
    expect(slot.label).toBe("input_2");
  });

  it("leaves label alone when predicate fails (user-customized)", () => {
    const slot: MockSlot = { name: "input_3", label: "renamed_by_user" };
    relabelSlotIf(slot, "input_2", (cur) => cur === "input_3");
    expect(slot.label).toBe("renamed_by_user");
  });

  it("updates stashed label instead of live label when collapsed", () => {
    // Simulate the collapsed state by populating the stash WeakMaps
    // directly — bypasses the full attach/setCollapsed dance so the
    // test stays focused on relabelSlotIf's contract.
    const slot: MockSlot = { name: "input_3", label: " " };
    slotOrigLabel.set(slot, "input_3");
    slotLabelStashed.add(slot);
    relabelSlotIf(slot, "input_2", (cur) => cur === "input_3");
    expect(slotOrigLabel.get(slot)).toBe("input_2");
    expect(slot.label).toBe(" ");  // live placeholder untouched
  });

  it("undefined newLabel deletes .label (re-enable name-fallback)", () => {
    const slot: MockSlot = { name: "input_3", label: "input_3" };
    relabelSlotIf(slot, undefined, (cur) => cur === "input_3");
    expect("label" in slot).toBe(false);
  });

  it("undefined newLabel sets stash to undefined when collapsed", () => {
    const slot: MockSlot = { name: "input_3", label: " " };
    slotOrigLabel.set(slot, "input_3");
    slotLabelStashed.add(slot);
    relabelSlotIf(slot, undefined, (cur) => cur === "input_3");
    expect(slotOrigLabel.get(slot)).toBeUndefined();
    expect(slotLabelStashed.has(slot)).toBe(true);  // marker still set
  });
});

describe("collapse-connections — readSlotLabel", () => {
  it("returns live .label when no stash present", () => {
    const slot: MockSlot = { name: "input_0", label: "my_wire" };
    expect(readSlotLabel(slot)).toBe("my_wire");
  });

  it("returns stashed label when collapsed (live label is placeholder)", () => {
    const slot: MockSlot = { name: "input_0", label: " " };
    slotOrigLabel.set(slot, "user_set");
    slotLabelStashed.add(slot);
    expect(readSlotLabel(slot)).toBe("user_set");
  });

  it("returns undefined when neither stash nor live label is set", () => {
    const slot: MockSlot = { name: "input_0" };
    expect(readSlotLabel(slot)).toBeUndefined();
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
