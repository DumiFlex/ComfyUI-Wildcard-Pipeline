import { describe, it, expect, vi } from "vitest";
import { reindexInjectorSlots, type ReindexSurface } from "./injector";

type MockInput = { name?: string; type?: string; link?: number | null };

function makeNode(inputs: MockInput[]): ReindexSurface & { __inputs: MockInput[]; setDirtyCanvas: ReturnType<typeof vi.fn> } {
  const arr: MockInput[] = [...inputs];
  return {
    inputs: arr,
    __inputs: arr,
    addInput: (name: string, type: string): MockInput => {
      const inp: MockInput = { name, type, link: null };
      arr.push(inp);
      return inp;
    },
    removeInput: (slot: number): void => {
      arr.splice(slot, 1);
    },
    setDirtyCanvas: vi.fn(),
  };
}

describe("reindexInjectorSlots", () => {
  it("disconnect input_0 — input_1 renames to input_0 + trailing empty added", () => {
    const node = makeNode([
      { name: "input_0", type: "*", link: null },   // just disconnected
      { name: "input_1", type: "*", link: 43 },     // still connected
      { name: "input_2", type: "*", link: null },   // existing trailing empty
    ]);

    const { renames, removed } = reindexInjectorSlots(node);

    // Disconnected slots gone, the surviving connected becomes input_0,
    // one trailing empty named input_1 appended.
    expect(node.__inputs.map((i) => i.name)).toEqual(["input_0", "input_1"]);
    expect(node.__inputs[0].link).toBe(43);
    expect(node.__inputs[1].link).toBeNull();

    // Rename map records the input_1 → input_0 migration.
    expect(renames.get("input_1")).toBe("input_0");
    // input_0 was a disconnected slot — it's in removed, NOT in renames.
    // The orphan-row check uses `removed` to drop rows whose original
    // socket vanished entirely.
    expect(removed.has("input_0")).toBe(true);
    expect(removed.has("input_2")).toBe(true);
    expect(renames.has("input_0")).toBe(false);
  });

  it("disconnect middle slot — surviving slots shift contiguously", () => {
    const node = makeNode([
      { name: "input_0", type: "*", link: 100 },  // connected
      { name: "input_1", type: "*", link: null }, // just disconnected
      { name: "input_2", type: "*", link: 102 },  // still connected
      { name: "input_3", type: "*", link: null }, // trailing empty
    ]);

    const { renames, removed } = reindexInjectorSlots(node);

    expect(node.__inputs.map((i) => i.name)).toEqual(["input_0", "input_1", "input_2"]);
    expect(node.__inputs[0].link).toBe(100);
    expect(node.__inputs[1].link).toBe(102);
    expect(node.__inputs[2].link).toBeNull();
    expect(renames.get("input_2")).toBe("input_1");
    expect(renames.has("input_0")).toBe(false);  // no change
    expect(removed.has("input_1")).toBe(true);
    expect(removed.has("input_3")).toBe(true);
  });

  it("non-contiguous workflow load normalizes to contiguous run", () => {
    // Simulates a workflow saved before this fix — slots numbered
    // 5/2/9 (out of order, gaps). On load, normalizeSlots runs once
    // and produces input_0..input_2 + trailing input_3.
    const node = makeNode([
      { name: "input_5", type: "*", link: 50 },
      { name: "input_2", type: "*", link: 20 },
      { name: "input_9", type: "*", link: 90 },
    ]);

    const { renames, removed } = reindexInjectorSlots(node);

    expect(node.__inputs.map((i) => i.name)).toEqual(["input_0", "input_1", "input_2", "input_3"]);
    expect(node.__inputs[0].link).toBe(50);  // was input_5, still first in array
    expect(node.__inputs[1].link).toBe(20);  // was input_2
    expect(node.__inputs[2].link).toBe(90);  // was input_9
    expect(node.__inputs[3].link).toBeNull();
    expect(renames.get("input_5")).toBe("input_0");
    expect(renames.get("input_2")).toBe("input_1");
    expect(renames.get("input_9")).toBe("input_2");
    // Nothing removed — all three slots were connected.
    expect(removed.size).toBe(0);
  });

  it("calls setDirtyCanvas(true, true) after rename", () => {
    const node = makeNode([
      { name: "input_0", type: "*", link: null },
      { name: "input_1", type: "*", link: 43 },
    ]);

    reindexInjectorSlots(node);

    expect(node.setDirtyCanvas).toHaveBeenCalledWith(true, true);
  });

  it("calls setDirtyCanvas even on no-op (idempotent — repaint cheap)", () => {
    // Algorithm always calls setDirtyCanvas after step 4 regardless
    // of whether anything changed. Cheap enough not to gate.
    const node = makeNode([
      { name: "input_0", type: "*", link: 100 },
      { name: "input_1", type: "*", link: null },
    ]);

    reindexInjectorSlots(node);

    expect(node.setDirtyCanvas).toHaveBeenCalledWith(true, true);
  });

  it("idempotent — running on canonical state changes nothing meaningful", () => {
    const node = makeNode([
      { name: "input_0", type: "*", link: 100 },
      { name: "input_1", type: "*", link: null },  // already trailing empty
    ]);

    const { renames, removed } = reindexInjectorSlots(node);

    // Removes the disconnected input_1 then adds a new input_1 — net
    // same state but the trailing empty is a fresh element. input_1
    // counts as removed (the OLD one) even though a new input_1 was
    // immediately added; this is fine because no row had slot_name
    // input_1 in the orphan-row check.
    expect(node.__inputs.map((i) => i.name)).toEqual(["input_0", "input_1"]);
    expect(node.__inputs[0].link).toBe(100);
    expect(node.__inputs[1].link).toBeNull();
    expect(renames.size).toBe(0);
    expect(removed.has("input_1")).toBe(true);  // OLD trailing empty was removed
  });

  it("respects MAX_INJECTOR_SLOTS cap — no trailing empty when at cap", () => {
    // Build a node with 10 connected dynamic slots (the soft cap).
    // After normalize, the array stays at 10 entries — no new empty
    // is appended at input_10.
    const inputs: MockInput[] = [];
    for (let i = 0; i < 10; i++) {
      inputs.push({ name: `input_${i}`, type: "*", link: 1000 + i });
    }
    const node = makeNode(inputs);

    reindexInjectorSlots(node);

    // All 10 connected slots kept (no rename — already contiguous);
    // no new trailing empty added because counter reached MAX.
    expect(node.__inputs.map((i) => i.name)).toEqual([
      "input_0", "input_1", "input_2", "input_3", "input_4",
      "input_5", "input_6", "input_7", "input_8", "input_9",
    ]);
    expect(node.__inputs.every((i) => i.link != null)).toBe(true);
  });

  it("trailing empty appears again when a slot disconnects below cap", () => {
    // 10 connected (at cap) + disconnect one. Now we're at 9 connected
    // and the trailing empty should re-appear at input_9.
    const inputs: MockInput[] = [];
    for (let i = 0; i < 10; i++) {
      inputs.push({ name: `input_${i}`, type: "*", link: i === 5 ? null : 1000 + i });
    }
    const node = makeNode(inputs);

    reindexInjectorSlots(node);

    // 9 connected (input_5 was disconnected, removed during normalize)
    // + 1 trailing empty = 10 entries total.
    expect(node.__inputs.length).toBe(10);
    expect(node.__inputs[9].link).toBeNull();
    expect(node.__inputs.slice(0, 9).every((i) => i.link != null)).toBe(true);
  });

  it("ignores non-input_N slots (e.g. fixed named inputs)", () => {
    const node = makeNode([
      { name: "model", type: "MODEL", link: 1 },     // not dynamic — keep
      { name: "input_0", type: "*", link: 100 },     // dynamic, connected
      { name: "input_1", type: "*", link: null },    // dynamic, empty
    ]);

    reindexInjectorSlots(node);

    // model stays untouched; dynamic slots renumbered + trailing empty added.
    expect(node.__inputs[0].name).toBe("model");
    expect(node.__inputs[0].link).toBe(1);
    expect(node.__inputs.map((i) => i.name)).toEqual(["model", "input_0", "input_1"]);
  });
});
