import { describe, it, expect } from "vitest";
import { buildTopLevelItems } from "./top-level-items";
import { emptyBundleInstance, type BundleInstance, type ModuleEntry } from "../../../widgets/_shared";

function mod(uid: string, origin?: string): ModuleEntry {
  return {
    id: `id-${uid}`, _uid: uid, type: "wildcard", enabled: true,
    meta: { name: uid }, entries: [],
    ...(origin ? { bundle_origin: origin } : {}),
  } as ModuleEntry;
}

function bundle(uid: string, start: number, end: number, parent?: string): BundleInstance {
  return { ...emptyBundleInstance("lib"), _uid: uid, start_idx: start, end_idx: end, parent_uid: parent ?? null };
}

describe("buildTopLevelItems", () => {
  it("walks standalone rows and top-level bundles in document order", () => {
    const modules = [mod("a"), mod("b", "B1"), mod("c", "B1"), mod("d")];
    const items = buildTopLevelItems(modules, [bundle("B1", 1, 2)]);
    expect(items.map((i) => i.key)).toEqual(["a", "b-B1", "d"]);
    expect(items[1].children?.map((c) => c.key)).toEqual(["b", "c"]);
    expect(items[2].idx).toBe(3);
  });

  it("nests an inner bundle inside its parent's children", () => {
    const modules = [mod("a", "OUT"), mod("b", "IN"), mod("c", "IN"), mod("d", "OUT")];
    const items = buildTopLevelItems(modules, [bundle("OUT", 0, 3), bundle("IN", 1, 2, "OUT")]);
    expect(items).toHaveLength(1);
    const kids = items[0].children ?? [];
    expect(kids.map((c) => c.key)).toEqual(["a", "b-IN", "d"]);
    const inner = kids[1];
    expect(inner.kind === "bundle" && inner.children.map((c) => c.key)).toEqual(["b", "c"]);
  });

  it("falls back to an index key for rows without a _uid", () => {
    const m = mod("x");
    delete m._uid;
    expect(buildTopLevelItems([m], [])[0].key).toBe("m-0");
  });
});
