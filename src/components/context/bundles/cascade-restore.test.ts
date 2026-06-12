import { describe, it, expect, vi, afterEach } from "vitest";
import { cascadeRestoreForBundle, rewriteChildId } from "./cascade-restore";
import {
  emptyBundleInstance,
  type BundleInstance,
  type ModuleEntry,
} from "../../../widgets/_shared";

/**
 * #2 regression: cascade-restore must remap references INSIDE a child's
 * payload (constraint source/target, @{} refs), not just the child's own id.
 * When Phase 1 re-creates a missing module under a fresh uuid, a sibling
 * constraint that points at the old uuid must be re-pointed too, or the
 * pushed bundle ships a dead source/target.
 */
describe("cascade-restore rewriteChildId — payload ref remap (#2)", () => {
  it("remaps a constraint child's source/target uuids to the restored module ids", () => {
    const moduleMap = new Map([
      ["aaaaaaaa", "bbbbbbbb"],
      ["cccccccc", "dddddddd"],
    ]);
    const child = {
      id: "cn000001",
      type: "constraint",
      payload: { source_wildcard_id: "aaaaaaaa", target_wildcard_id: "cccccccc", matrix: {} },
    };
    const out = rewriteChildId(child, moduleMap, new Map());
    const p = out.payload as Record<string, unknown>;
    expect(p.source_wildcard_id).toBe("bbbbbbbb");
    expect(p.target_wildcard_id).toBe("dddddddd");
  });

  it("remaps embedded @{uuid} refs in a child's payload (preserving #name)", () => {
    const moduleMap = new Map([["aabbccdd", "11223344"]]);
    const child = {
      id: "wc000001",
      type: "wildcard",
      payload: { options: [{ id: "o1", value: "see @{aabbccdd#color} here" }] },
    };
    const out = rewriteChildId(child, moduleMap, new Map());
    expect(JSON.stringify(out.payload)).toContain("@{11223344#color}");
  });

  it("remaps refs found in a child's instance overrides too", () => {
    const moduleMap = new Map([["aaaaaaaa", "bbbbbbbb"]]);
    const child = {
      id: "cn000002",
      type: "constraint",
      payload: { source_wildcard_id: "aaaaaaaa" },
      instance: { target_select: { picks: [{ carrier_uid: "aaaaaaaa", option_id: "r1:0" }] } },
    };
    const out = rewriteChildId(child, moduleMap, new Map());
    expect(JSON.stringify(out.instance)).toContain("bbbbbbbb");
    expect(JSON.stringify(out.instance)).not.toContain("aaaaaaaa");
  });

  it("leaves refs to non-restored (external) uuids untouched", () => {
    const child = {
      id: "cn000003",
      type: "constraint",
      payload: { source_wildcard_id: "eeeeeeee", target_wildcard_id: "ffffffff" },
    };
    const out = rewriteChildId(child, new Map([["aaaaaaaa", "bbbbbbbb"]]), new Map());
    const p = out.payload as Record<string, unknown>;
    expect(p.source_wildcard_id).toBe("eeeeeeee");
    expect(p.target_wildcard_id).toBe("ffffffff");
  });

  it("still rewrites the child's own top-level id (module + bundle)", () => {
    const moduleMap = new Map([["aaaaaaaa", "bbbbbbbb"]]);
    const innerBundleMap = new Map([["bndl1111", "bndl2222"]]);
    const mod = rewriteChildId({ id: "aaaaaaaa", type: "wildcard", payload: {} }, moduleMap, innerBundleMap);
    expect(mod.id).toBe("bbbbbbbb");
    const bun = rewriteChildId({ id: "bndl1111", type: "bundle" }, moduleMap, innerBundleMap);
    expect(bun.id).toBe("bndl2222");
  });
});

/**
 * #2 end-to-end: the headline claim is a CHAIN — push → cascade restore
 * re-creates the missing wildcard under a fresh uuid → a sibling
 * constraint pointing at the dead uuid is repointed in the children the
 * outer ships. The pure `rewriteChildId` tests above lock the rewrite
 * primitive; this exercises `cascadeRestoreForBundle` itself (Phase 1
 * POST → Phase 3 children rebuild → Phase 4 workflow rebind) with the
 * module POST mocked. Also re-asserts the #2 invariant inside the live
 * flow: an embedded `@{uuid}` ref in the constraint follows the repoint
 * too, not just the bare source/target fields.
 */
describe("cascadeRestoreForBundle — end-to-end ref repoint (#2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mkModule(
    over: Partial<ModuleEntry> & { bundle_origin?: string },
  ): ModuleEntry & { bundle_origin?: string } {
    return {
      id: "00000000",
      type: "wildcard",
      enabled: true,
      collapsed: false,
      meta: { name: "" },
      entries: [],
      payload: {},
      instance: {},
      payload_hash: "h",
      _uid: "u",
      ...over,
    } as ModuleEntry & { bundle_origin?: string };
  }

  it("restores a missing wildcard and repoints its sibling constraint's source + embedded @{} ref", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ id: "beef0001" }),
          text: async () => "",
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    // deadbeef = the wildcard whose library row was deleted upstream.
    const wildcard = mkModule({
      id: "deadbeef",
      type: "wildcard",
      _uid: "u-w",
      meta: { name: "Palette" },
      payload: { options: [] },
      bundle_origin: "outer-uid",
    });
    // A sibling constraint sources from deadbeef + carries an embedded
    // @{deadbeef#palette} ref inside an exception value. facade00 is an
    // EXTERNAL target (not restored) — it must survive untouched.
    const constraint = mkModule({
      id: "ca000001",
      type: "constraint",
      _uid: "u-c",
      meta: { name: "Pairing" },
      payload: {
        source_wildcard_id: "deadbeef",
        target_wildcard_id: "facade00",
        matrix: {},
        exceptions: [{ source_value: "see @{deadbeef#palette}", target_value: "sky" }],
      },
      bundle_origin: "outer-uid",
    });
    const outer: BundleInstance = {
      ...emptyBundleInstance("bndllib0"),
      _uid: "outer-uid",
      start_idx: 0,
      end_idx: 1,
      name: "Kit",
    };
    const modules = [wildcard, constraint];

    const result = await cascadeRestoreForBundle({
      outer,
      modules,
      bundles: [outer],
      isModuleMissing: (m) => m.id === "deadbeef",
      isBundleMissing: () => false,
    });

    // Only the wildcard was missing → exactly one module POST.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.restoredModuleCount).toBe(1);

    const cn = result.rewrittenChildren.find((c) => c.type === "constraint");
    const p = cn?.payload as Record<string, unknown>;
    expect(p.source_wildcard_id).toBe("beef0001"); // repointed to the restored id
    expect(p.target_wildcard_id).toBe("facade00"); // external ref left alone
    // #2 invariant re-asserted in the live flow: embedded @{} ref follows too,
    // preserving its #name segment.
    expect(JSON.stringify(cn?.payload)).toContain("@{beef0001#palette}");
    expect(JSON.stringify(cn?.payload)).not.toContain("deadbeef");

    // Workflow rebind swaps the dead id while preserving the per-instance _uid.
    const w = result.newModules.find((m) => m._uid === "u-w");
    expect(w?.id).toBe("beef0001");
  });
});
