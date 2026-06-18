import { describe, expect, it } from "vitest";
import {
  findInvalidIds,
  planRemapUpdates,
  runLibraryRepair,
  type RepairableEntry,
  type RepairDeps,
} from "./uuid-repair";

describe("findInvalidIds", () => {
  it("returns the ids that fail the 8-hex shape", () => {
    expect(
      findInvalidIds([{ id: "coloruni" }, { id: "ed1bccf8" }, { id: "mybundle" }]),
    ).toEqual(["coloruni", "mybundle"]);
  });
});

describe("planRemapUpdates", () => {
  it("rewrites nested @{} (suffix kept) + whole-string axes; skips unchanged rows", () => {
    const updates = planRemapUpdates(
      [
        { id: "aabbccdd", payload: { options: [{ id: "o1", value: "a @{coloruni#color:light or muted}" }] } },
        { id: "ccddee11", payload: { source_wildcard_id: "coloruni", matrix: {} } },
        { id: "ffff0000", payload: { options: [{ id: "o2", value: "plain text" }] } },
      ],
      { coloruni: "c0000001" },
    );
    expect((updates.find((u) => u.id === "aabbccdd")?.payload?.options as Array<{ value: string }>)[0].value).toBe(
      "a @{c0000001#color:light or muted}",
    );
    expect(updates.find((u) => u.id === "ccddee11")?.payload?.source_wildcard_id).toBe("c0000001");
    expect(updates.find((u) => u.id === "ffff0000")).toBeUndefined();
  });

  it("an empty rename map yields no updates", () => {
    expect(planRemapUpdates([{ id: "x", payload: {} }], {})).toEqual([]);
  });
});

describe("runLibraryRepair", () => {
  function mockDeps(modules: RepairableEntry[], bundles: RepairableEntry[] = []) {
    const calls: string[] = [];
    let n = 0;
    const deps: RepairDeps = {
      listModules: async () => modules,
      listBundles: async () => bundles,
      createModule: async (e) => { calls.push(`create:${e.id}`); return { id: `aaaa000${++n}` }; },
      createBundle: async (e) => { calls.push(`createB:${e.id}`); return { id: `bbbb000${++n}` }; },
      updateModule: async (id) => { calls.push(`update:${id}`); },
      updateBundle: async (id) => { calls.push(`updateB:${id}`); },
      deleteModule: async (id) => { calls.push(`delete:${id}`); },
      deleteBundle: async (id) => { calls.push(`deleteB:${id}`); },
    };
    return { deps, calls: () => calls };
  }

  it("rekeys an invalid module + remaps its referrer in create→update→delete order", async () => {
    const { deps, calls } = mockDeps([
      { id: "coloruni", type: "wildcard", payload: { options: [] } },
      { id: "aabbccdd", type: "wildcard", payload: { options: [{ id: "o1", value: "@{coloruni}" }] } },
    ]);
    const res = await runLibraryRepair(deps);
    expect(res.repaired).toBe(1);
    // create the new color row → update the referrer (now @{aaaa0001}) → delete old color.
    // The created color's own payload has no refs, so it isn't re-updated.
    expect(calls()).toEqual(["create:coloruni", "update:aabbccdd", "delete:coloruni"]);
  });

  it("is a no-op on a clean library", async () => {
    const { deps, calls } = mockDeps([{ id: "ed1bccf8", type: "wildcard", payload: { options: [] } }]);
    const res = await runLibraryRepair(deps);
    expect(res.repaired).toBe(0);
    expect(calls()).toEqual([]);
  });
});
