import { describe, it, expect } from "vitest";
import { groupModulesAndBundles } from "./group";
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

// Tiny module fixture — only the fields the grouping helper needs.
function m(id: string): ModuleEntry {
  return {
    id,
    _uid: id + "-uid",
    type: "wildcard",
    enabled: true,
    meta: { name: id },
    entries: [],
  };
}

function b(uid: string, start_idx: number, end_idx: number): BundleInstance {
  return {
    _uid: uid,
    library_id: `lib-${uid}`,
    start_idx,
    end_idx,
    enabled: true,
    collapsed: false,
    inserted_at_hash: "",
    name: uid,
    color: null,
  };
}

describe("groupModulesAndBundles", () => {
  it("returns a flat list of module groups when no bundles", () => {
    const modules = [m("a"), m("b"), m("c")];
    const groups = groupModulesAndBundles(modules, []);
    expect(groups).toHaveLength(3);
    expect(groups.every((g: { type: string }) => g.type === "module")).toBe(true);
  });

  it("wraps contiguous range into a single bundle group", () => {
    // modules[0..2]: top-level + bundle(start=1,end=2) + top-level after
    const modules = [m("a"), m("b"), m("c"), m("d")];
    const bundles = [b("bun1", 1, 2)];
    const groups = groupModulesAndBundles(modules, bundles);
    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe("module");
    expect(groups[1].type).toBe("bundle");
    expect(groups[2].type).toBe("module");
    if (groups[1].type !== "bundle") throw new Error();
    expect(groups[1].children).toHaveLength(2);
    expect(groups[1].children[0].entry.id).toBe("b");
    expect(groups[1].children[1].entry.id).toBe("c");
  });

  it("preserves absolute module indices on children", () => {
    const modules = [m("a"), m("b"), m("c"), m("d")];
    const bundles = [b("bun1", 1, 2)];
    const groups = groupModulesAndBundles(modules, bundles);
    if (groups[1].type !== "bundle") throw new Error();
    expect(groups[1].children[0].idx).toBe(1);
    expect(groups[1].children[1].idx).toBe(2);
    if (groups[2].type !== "module") throw new Error();
    expect(groups[2].idx).toBe(3);
  });

  it("handles bundle at start of modules list", () => {
    const modules = [m("a"), m("b"), m("c")];
    const bundles = [b("bun1", 0, 1)];
    const groups = groupModulesAndBundles(modules, bundles);
    expect(groups[0].type).toBe("bundle");
    expect(groups[1].type).toBe("module");
    if (groups[1].type !== "module") throw new Error();
    expect(groups[1].entry.id).toBe("c");
  });

  it("handles bundle at end of modules list", () => {
    const modules = [m("a"), m("b"), m("c")];
    const bundles = [b("bun1", 1, 2)];
    const groups = groupModulesAndBundles(modules, bundles);
    expect(groups[0].type).toBe("module");
    expect(groups[1].type).toBe("bundle");
    if (groups[1].type !== "bundle") throw new Error();
    expect(groups[1].children.map((c: { entry: { id: string } }) => c.entry.id)).toEqual(["b", "c"]);
  });

  it("handles multiple non-overlapping bundles", () => {
    const modules = [m("a"), m("b"), m("c"), m("d"), m("e")];
    const bundles = [b("bun1", 0, 1), b("bun2", 3, 4)];
    const groups = groupModulesAndBundles(modules, bundles);
    expect(groups).toHaveLength(3);
    expect(groups[0].type).toBe("bundle");
    expect(groups[1].type).toBe("module");
    expect(groups[2].type).toBe("bundle");
    if (groups[1].type !== "module") throw new Error();
    expect(groups[1].entry.id).toBe("c");
  });

  it("ignores bundles with invalid range (end < start)", () => {
    // Empty-bundle case — frontend should dissolve the frame next
    // interaction. Until then, groupingsilently skips it.
    const modules = [m("a"), m("b")];
    const bundles = [b("bun1", 1, 0)];
    const groups = groupModulesAndBundles(modules, bundles);
    expect(groups).toHaveLength(2);
    expect(groups.every((g: { type: string }) => g.type === "module")).toBe(true);
  });

  it("ignores bundles with out-of-bounds range", () => {
    const modules = [m("a"), m("b")];
    const bundles = [b("bun1", 5, 7)];
    const groups = groupModulesAndBundles(modules, bundles);
    expect(groups).toHaveLength(2);
    expect(groups.every((g: { type: string }) => g.type === "module")).toBe(true);
  });

  it("sorts bundles by start_idx when inputs are out of order", () => {
    const modules = [m("a"), m("b"), m("c"), m("d")];
    // Input bundles in reverse order — grouping must still produce
    // [bundle0_1, bundle2_3] in module order.
    const bundles = [b("bun2", 2, 3), b("bun1", 0, 1)];
    const groups = groupModulesAndBundles(modules, bundles);
    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe("bundle");
    expect(groups[1].type).toBe("bundle");
    if (groups[0].type !== "bundle") throw new Error();
    expect(groups[0].instance._uid).toBe("bun1");  // by start_idx ascending
  });
});
