import { describe, expect, it } from "vitest";
import { reconcileBundleRanges } from "./drag";
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

function row(id: string, overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id,
    _uid: `uid-${id}`,
    type: "wildcard",
    enabled: true,
    meta: { name: id },
    entries: [],
    ...overrides,
  };
}

function bundle(uid: string, start: number, end: number): BundleInstance {
  return {
    _uid: uid,
    library_id: "lib",
    start_idx: start,
    end_idx: end,
    enabled: true,
    collapsed: false,
    inserted_at_hash: "",
    name: "b",
    color: null,
  };
}

describe("reconcileBundleRanges", () => {
  it("updates start/end when bundle members are contiguous", () => {
    const a = row("a", { bundle_origin: "bX" } as Partial<ModuleEntry>);
    const b = row("b", { bundle_origin: "bX" } as Partial<ModuleEntry>);
    const c = row("c");
    const next = reconcileBundleRanges([c, a, b], [bundle("bX", 99, 99)]);
    expect(next).toHaveLength(1);
    expect(next[0].start_idx).toBe(1);
    expect(next[0].end_idx).toBe(2);
  });

  it("dissolves bundle when members are non-contiguous", () => {
    const a = row("a", { bundle_origin: "bX" } as Partial<ModuleEntry>);
    const middle = row("m");
    const b = row("b", { bundle_origin: "bX" } as Partial<ModuleEntry>);
    const modules: ModuleEntry[] = [a, middle, b];
    const next = reconcileBundleRanges(modules, [bundle("bX", 0, 1)]);
    expect(next).toEqual([]);
    expect((modules[0] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBeUndefined();
    expect((modules[2] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBeUndefined();
  });

  it("dissolves bundle when no members remain", () => {
    const c = row("c");
    const next = reconcileBundleRanges([c], [bundle("bX", 0, 0)]);
    expect(next).toEqual([]);
  });
});
