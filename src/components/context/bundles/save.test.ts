import { describe, it, expect } from "vitest";
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";
import { buildLibraryChildren, buildLibraryChildrenWithIntegrity, toChildSnapshot } from "./save";

function mod(
  id: string,
  bundle_origin: string,
  type: ModuleEntry["type"] = "wildcard",
): ModuleEntry & { _uid: string; bundle_origin: string } {
  return {
    id,
    _uid: `uid-${id}`,
    type,
    enabled: true,
    collapsed: false,
    meta: { name: id },
    entries: [],
    payload: { var_binding: id },
    instance: {},
    payload_hash: `h-${id}`,
    bundle_origin,
  } as ModuleEntry & { _uid: string; bundle_origin: string };
}

function bundle(
  uid: string,
  library_id: string,
  start_idx: number,
  end_idx: number,
  parent_uid: string | null = null,
  extras: Partial<BundleInstance> = {},
): BundleInstance {
  return {
    _uid: uid,
    library_id,
    start_idx,
    end_idx,
    enabled: true,
    collapsed: false,
    inserted_at_hash: `h-${library_id}`,
    name: `Bundle ${library_id}`,
    color: null,
    parent_uid,
    ...extras,
  };
}

describe("buildLibraryChildren", () => {
  it("non-nested bundle round-trips every leaf as a full snapshot", () => {
    const outer = bundle("outer-u", "lib-outer", 0, 1);
    const modules = [mod("a", "outer-u"), mod("b", "outer-u")];
    const out = buildLibraryChildren(outer, modules, [outer]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "a", type: "wildcard" });
    expect(out[1]).toMatchObject({ id: "b", type: "wildcard" });
    // bundle_origin is per-instance state — must NOT leak to the library
    // shape (the server stores library entries id-only via children[]).
    for (const c of out) expect(c).not.toHaveProperty("bundle_origin");
  });

  it("nested inner emits a single bundle reference at the inner's leading index", () => {
    const outer = bundle("outer-u", "lib-outer", 0, 3);
    const inner = bundle("inner-u", "lib-inner", 1, 2, "outer-u", {
      name: "the inner",
      color: "#abcdef",
    });
    const modules = [
      mod("d1", "outer-u"),   // direct
      mod("i1", "inner-u"),   // owned by inner
      mod("i2", "inner-u"),   // owned by inner
      mod("d2", "outer-u"),   // direct
    ];
    const out = buildLibraryChildren(outer, modules, [outer, inner]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: "d1", type: "wildcard" });
    expect(out[1]).toEqual({
      id: "lib-inner",
      type: "bundle",
      name: "the inner",
      color: "#abcdef",
    });
    expect(out[2]).toMatchObject({ id: "d2", type: "wildcard" });
  });

  it("multiple inner bundles each emit one reference", () => {
    const outer = bundle("outer-u", "lib-outer", 0, 4);
    const innerA = bundle("ia-u", "lib-a", 0, 1, "outer-u", { name: "A" });
    const innerB = bundle("ib-u", "lib-b", 3, 4, "outer-u", { name: "B" });
    const modules = [
      mod("a1", "ia-u"),
      mod("a2", "ia-u"),
      mod("d1", "outer-u"),
      mod("b1", "ib-u"),
      mod("b2", "ib-u"),
    ];
    const out = buildLibraryChildren(outer, modules, [outer, innerA, innerB]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: "lib-a", type: "bundle", name: "A" });
    expect(out[1]).toMatchObject({ id: "d1", type: "wildcard" });
    expect(out[2]).toMatchObject({ id: "lib-b", type: "bundle", name: "B" });
  });

  it("ignores BundleInstances whose parent_uid points elsewhere", () => {
    // Sibling bundle in the same Context — must not bleed into this
    // outer's children[].
    const outer = bundle("outer-u", "lib-outer", 0, 1);
    const sibling = bundle("sib-u", "lib-sib", 5, 6);
    const modules = [mod("a", "outer-u"), mod("b", "outer-u")];
    const out = buildLibraryChildren(outer, modules, [outer, sibling]);
    expect(out).toHaveLength(2);
    for (const c of out) expect(c.type).not.toBe("bundle");
  });

  it("emits null name/color when inner instance has them absent", () => {
    const outer = bundle("outer-u", "lib-outer", 0, 1);
    const inner: BundleInstance = {
      _uid: "inner-u",
      library_id: "lib-inner",
      start_idx: 0,
      end_idx: 1,
      enabled: true,
      collapsed: false,
      inserted_at_hash: "h-lib-inner",
      name: "",
      color: undefined,
      parent_uid: "outer-u",
    };
    const modules = [mod("i1", "inner-u"), mod("i2", "inner-u")];
    const out = buildLibraryChildren(outer, modules, [outer, inner]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: "lib-inner",
      type: "bundle",
      name: "",
      color: null,
    });
  });

  it("skips holes (no module at a position in target range)", () => {
    // Defensive: if modules[] is shorter than target.end_idx (shouldn't
    // happen post-reconcile, but a corrupt save shouldn't crash the
    // save path).
    const outer = bundle("outer-u", "lib-outer", 0, 2);
    const modules = [mod("a", "outer-u")];  // only one leaf, range claims 3
    const out = buildLibraryChildren(outer, modules, [outer]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a" });
  });
});

describe("buildLibraryChildrenWithIntegrity — orphan detection", () => {
  it("happy path: no orphans reported", () => {
    const outer = bundle("outer-u", "lib-outer", 0, 1);
    const modules = [mod("a", "outer-u"), mod("b", "outer-u")];
    const result = buildLibraryChildrenWithIntegrity(outer, modules, [outer]);
    expect(result.orphanedInnerUids).toEqual([]);
    expect(result.children).toHaveLength(2);
  });

  it("nested happy path: inner detected via parent_uid, no orphans", () => {
    const outer = bundle("outer-u", "lib-outer", 0, 2);
    const inner = bundle("inner-u", "lib-inner", 1, 2, "outer-u");
    const modules = [
      mod("a", "outer-u"),
      mod("b", "inner-u"),
      mod("c", "inner-u"),
    ];
    const result = buildLibraryChildrenWithIntegrity(outer, modules, [outer, inner]);
    expect(result.orphanedInnerUids).toEqual([]);
    expect(result.children).toHaveLength(2); // 1 leaf + 1 bundle ref
  });

  it("orphan: child's bundle_origin points at a bundle whose parent_uid is NOT target", () => {
    // Simulate corruption: inner exists, but its parent_uid is wrong.
    // The child claims membership but the inner won't be detected.
    const outer = bundle("outer-u", "lib-outer", 0, 1);
    const orphan = bundle("orphan-u", "lib-orphan", 0, 1, "WRONG-PARENT");
    const modules = [
      mod("a", "outer-u"),
      mod("b", "orphan-u"),
    ];
    const result = buildLibraryChildrenWithIntegrity(outer, modules, [outer, orphan]);
    expect(result.orphanedInnerUids).toEqual(["orphan-u"]);
    // Children still serialised — leaf data not lost, just flattened.
    expect(result.children).toHaveLength(2);
  });

  it("orphan: child's bundle_origin points at a bundle that doesn't exist at all", () => {
    const outer = bundle("outer-u", "lib-outer", 0, 1);
    const modules = [
      mod("a", "outer-u"),
      mod("b", "ghost-uid"),
    ];
    const result = buildLibraryChildrenWithIntegrity(outer, modules, [outer]);
    expect(result.orphanedInnerUids).toEqual(["ghost-uid"]);
  });

  it("multiple orphans from the same broken inner deduplicate", () => {
    const outer = bundle("outer-u", "lib-outer", 0, 2);
    const orphan = bundle("orphan-u", "lib-orphan", 0, 1, null); // wrong parent
    const modules = [
      mod("a", "orphan-u"),
      mod("b", "orphan-u"),
      mod("c", "outer-u"),
    ];
    const result = buildLibraryChildrenWithIntegrity(outer, modules, [outer, orphan]);
    expect(result.orphanedInnerUids).toEqual(["orphan-u"]);
  });
});

describe("toChildSnapshot", () => {
  it("drops per-instance fields (_uid, bundle_origin)", () => {
    const m = mod("x", "outer-u");
    const snap = toChildSnapshot(m);
    expect(snap).not.toHaveProperty("_uid");
    expect(snap).not.toHaveProperty("bundle_origin");
    expect(snap).toMatchObject({ id: "x", type: "wildcard" });
  });
});
