import { describe, it, expect } from "vitest";
import {
  buildCrossNodeBundleInsertion,
  type CrossNodeBundlePayload,
} from "./cross-node-nested";
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

let counter = 0;
function deterministicUid(): string {
  counter += 1;
  return `fresh-${counter.toString(16).padStart(4, "0")}`;
}

function emptyBundle(libId: string): BundleInstance {
  return {
    _uid: deterministicUid(),
    library_id: libId,
    start_idx: 0,
    end_idx: -1,
    enabled: true,
    collapsed: false,
    inserted_at_hash: `h-${libId}`,
    name: "",
    color: null,
  };
}

function mod(id: string, opts: { bundle_origin?: string } = {}): ModuleEntry {
  return {
    id, _uid: `src-${id}`, type: "wildcard", enabled: true, collapsed: false,
    meta: { name: id }, entries: [], payload: {}, instance: {}, payload_hash: `h-${id}`,
    ...(opts.bundle_origin ? { bundle_origin: opts.bundle_origin } : {}),
  } as ModuleEntry;
}

function sourceInner(uid: string, parent: string): BundleInstance {
  return {
    _uid: uid, library_id: "lib-inner",
    start_idx: 0, end_idx: 0, enabled: true, collapsed: false,
    inserted_at_hash: "h-inner", name: "inner", color: "#ff0", parent_uid: parent,
  };
}

describe("buildCrossNodeBundleInsertion", () => {
  it("mints fresh outer + carries forward name/color/collapsed/enabled", () => {
    counter = 0;
    const ds: CrossNodeBundlePayload = {
      bundleUid: "src-outer",
      libraryId: "lib-A",
      bundleName: "Outer",
      bundleColor: "#abc",
      bundleCollapsed: true,
      bundleEnabled: false,
      children: [mod("a", { bundle_origin: "src-outer" })],
      innerInstances: [],
    };
    const { newBundle } = buildCrossNodeBundleInsertion(ds, 5, deterministicUid, emptyBundle);
    expect(newBundle._uid).not.toBe("src-outer");
    expect(newBundle.library_id).toBe("lib-A");
    expect(newBundle.name).toBe("Outer");
    expect(newBundle.color).toBe("#abc");
    expect(newBundle.collapsed).toBe(true);
    expect(newBundle.enabled).toBe(false);
    expect(newBundle.start_idx).toBe(5);
    expect(newBundle.end_idx).toBe(5); // 1 child → end = start + 0
  });

  it("flat bundle: stamps every child's bundle_origin to new outer uid", () => {
    counter = 0;
    const ds: CrossNodeBundlePayload = {
      bundleUid: "src-outer",
      libraryId: "lib-A",
      bundleName: "Outer", bundleColor: null,
      bundleCollapsed: false, bundleEnabled: true,
      children: [
        mod("a", { bundle_origin: "src-outer" }),
        mod("b", { bundle_origin: "src-outer" }),
      ],
      innerInstances: [],
    };
    const { newBundle, freshInners, newChildren } = buildCrossNodeBundleInsertion(
      ds, 0, deterministicUid, emptyBundle,
    );
    expect(freshInners).toEqual([]);
    expect(newChildren).toHaveLength(2);
    for (const c of newChildren) {
      const origin = (c as ModuleEntry & { bundle_origin?: string }).bundle_origin;
      expect(origin).toBe(newBundle._uid);
      expect(c._uid).not.toBe("src-a");
    }
  });

  it("nested bundle: inner gets fresh uid + parent_uid points at new outer", () => {
    counter = 0;
    const ds: CrossNodeBundlePayload = {
      bundleUid: "src-outer",
      libraryId: "lib-A",
      bundleName: "Outer", bundleColor: null,
      bundleCollapsed: false, bundleEnabled: true,
      children: [
        mod("outer-leaf-1", { bundle_origin: "src-outer" }),
        mod("inner-leaf-1", { bundle_origin: "src-inner" }),
        mod("inner-leaf-2", { bundle_origin: "src-inner" }),
        mod("outer-leaf-2", { bundle_origin: "src-outer" }),
      ],
      innerInstances: [sourceInner("src-inner", "src-outer")],
    };
    const { newBundle, freshInners, newChildren } = buildCrossNodeBundleInsertion(
      ds, 10, deterministicUid, emptyBundle,
    );
    expect(freshInners).toHaveLength(1);
    const inner = freshInners[0];
    expect(inner._uid).not.toBe("src-inner");
    expect(inner.parent_uid).toBe(newBundle._uid);
    expect(inner.library_id).toBe("lib-inner");
    expect(inner.color).toBe("#ff0"); // carried through
    // outer-leaf children → new outer uid
    expect((newChildren[0] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBe(newBundle._uid);
    expect((newChildren[3] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBe(newBundle._uid);
    // inner-leaf children → fresh inner uid
    expect((newChildren[1] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBe(inner._uid);
    expect((newChildren[2] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBe(inner._uid);
  });

  it("multiple inner bundles: each gets distinct fresh uid + correct child remap", () => {
    counter = 0;
    const ds: CrossNodeBundlePayload = {
      bundleUid: "src-outer",
      libraryId: "lib-A",
      bundleName: "Outer", bundleColor: null,
      bundleCollapsed: false, bundleEnabled: true,
      children: [
        mod("ia-1", { bundle_origin: "src-inner-A" }),
        mod("ib-1", { bundle_origin: "src-inner-B" }),
      ],
      innerInstances: [
        sourceInner("src-inner-A", "src-outer"),
        sourceInner("src-inner-B", "src-outer"),
      ],
    };
    const { newBundle, freshInners, newChildren } = buildCrossNodeBundleInsertion(
      ds, 0, deterministicUid, emptyBundle,
    );
    expect(freshInners).toHaveLength(2);
    expect(freshInners[0]._uid).not.toBe(freshInners[1]._uid);
    expect(freshInners[0].parent_uid).toBe(newBundle._uid);
    expect(freshInners[1].parent_uid).toBe(newBundle._uid);
    expect((newChildren[0] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBe(freshInners[0]._uid);
    expect((newChildren[1] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBe(freshInners[1]._uid);
  });

  it("orphan child (bundle_origin not in innerInstances) falls back to new outer", () => {
    counter = 0;
    const ds: CrossNodeBundlePayload = {
      bundleUid: "src-outer",
      libraryId: "lib-A",
      bundleName: "Outer", bundleColor: null,
      bundleCollapsed: false, bundleEnabled: true,
      children: [
        mod("orphan", { bundle_origin: "src-vanished" }),
      ],
      innerInstances: [],
    };
    const { newBundle, newChildren } = buildCrossNodeBundleInsertion(
      ds, 0, deterministicUid, emptyBundle,
    );
    expect((newChildren[0] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBe(newBundle._uid);
  });

  it("every child gets a fresh _uid", () => {
    counter = 0;
    const ds: CrossNodeBundlePayload = {
      bundleUid: "src-outer",
      libraryId: "lib-A",
      bundleName: "Outer", bundleColor: null,
      bundleCollapsed: false, bundleEnabled: true,
      children: [mod("a"), mod("b"), mod("c")],
      innerInstances: [],
    };
    const { newChildren } = buildCrossNodeBundleInsertion(
      ds, 0, deterministicUid, emptyBundle,
    );
    const uids = new Set(newChildren.map((c) => c._uid));
    expect(uids.size).toBe(3); // all distinct, all fresh
    for (const c of newChildren) {
      expect(c._uid).not.toMatch(/^src-/); // not the source uid
    }
  });
});
