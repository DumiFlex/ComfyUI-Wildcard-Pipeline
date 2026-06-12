import { describe, it, expect, vi, afterEach } from "vitest";
import { cascadeRestoreForBundle, rewriteChildId } from "./cascade-restore";
import { api } from "../../../manager/api/client";
import type { ModuleRow } from "../../../manager/api/types";
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

/**
 * QA bug (2026-06-12): bundle push-with-cascade reattached the constraint's
 * TARGET but not its SOURCE — in the WORKFLOW. Root cause: Phase 4's
 * `newModules` swapped each module's own `id` but never rewrote payload refs,
 * so a restored constraint's source/target stayed pointed at the dead uuids
 * on the canvas (the pushed library children, Phase 3, were already correct).
 * This locks the workflow rebind: a restored module's INTERNAL refs follow
 * the restore too, both endpoints.
 */
describe("cascadeRestoreForBundle — Phase 4 workflow rebind rewrites payload refs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mkMod(
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

  it("repoints a restored constraint's source AND target in newModules, not just rewrittenChildren", async () => {
    // Distinct id per POST, in outer-range order: subject, mood, constraint.
    const minted = ["beef0001", "beef0002", "ca110011"];
    let n = 0;
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          // `headers` present because Phase 1 Pass 2's corrective PUT for the
          // restored constraint routes through `api.modules.update` →
          // `request()` → `checkStartupId(resp)`, which reads `resp.headers`.
          headers: { get: () => null },
          json: async () => ({ id: minted[n++] }),
          text: async () => "",
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const subject = mkMod({
      id: "deadbeef",
      type: "wildcard",
      _uid: "u-s",
      meta: { name: "subject" },
      bundle_origin: "outer-uid",
    });
    const mood = mkMod({
      id: "facade00",
      type: "wildcard",
      _uid: "u-m",
      meta: { name: "mood" },
      bundle_origin: "outer-uid",
    });
    const constraint = mkMod({
      id: "ca000001",
      type: "constraint",
      _uid: "u-c",
      meta: { name: "pairing" },
      payload: { source_wildcard_id: "deadbeef", target_wildcard_id: "facade00", matrix: {} },
      bundle_origin: "outer-uid",
    });
    const outer: BundleInstance = {
      ...emptyBundleInstance("bndllib1"),
      _uid: "outer-uid",
      start_idx: 0,
      end_idx: 2,
      name: "Kit",
    };
    const modules = [subject, mood, constraint];

    const result = await cascadeRestoreForBundle({
      outer,
      modules,
      bundles: [outer],
      isModuleMissing: (m) => ["deadbeef", "facade00", "ca000001"].includes(m.id),
      isBundleMissing: () => false,
    });

    // All three restored → ids swapped in the workflow rebind.
    const s = result.newModules.find((m) => m._uid === "u-s");
    const t = result.newModules.find((m) => m._uid === "u-m");
    const c = result.newModules.find((m) => m._uid === "u-c");
    expect(s?.id).toBe("beef0001");
    expect(t?.id).toBe("beef0002");
    // The CANVAS constraint must repoint BOTH endpoints (the SRC-MISSING bug
    // was: only target followed the restore, source stayed dead).
    const p = c?.payload as Record<string, unknown>;
    expect(p.source_wildcard_id).toBe("beef0001");
    expect(p.target_wildcard_id).toBe("beef0002");
  });
});

/**
 * Phase 1 third-output bug (forward-ref): each missing module is POSTed
 * RAW to mint a fresh library id (Pass 1). For a restored constraint, that
 * standalone library entry ships DANGLING source/target — they still point
 * at the OLD (now-deleted) uuids, because the constraint is POSTed BEFORE
 * its target wildcard mints a new id (moduleMap is incomplete mid-loop).
 * Phase 3 (pushed bundle children) + Phase 4 (workflow rebind) both already
 * rewrite refs; Phase 1's standalone library entries did not.
 *
 * The fix is a two-pass Phase 1: Pass 1 mints ids (raw POST); Pass 2 runs
 * AFTER the loop (moduleMap COMPLETE), walkRemaps each restored module's
 * payload and, when refs actually changed, corrects the freshly-created
 * library entry via `api.modules.update`. A pure wildcard with no internal
 * refs must NOT trigger a corrective PUT.
 */
describe("cascadeRestoreForBundle — Phase 1 Pass 2 corrects standalone library refs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mkMod(
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

  it("repoints a forward-ref constraint's source + target via api.modules.update, and skips a ref-free wildcard", async () => {
    // Outer range order is FORWARD-REF: the constraint sits BEFORE its
    // target wildcard, so moduleMap is incomplete when the constraint is
    // POSTed — only a post-loop Pass 2 can repoint target_wildcard_id.
    //   [ subject (deadbeef), constraint (ca000001 → src deadbeef / tgt facade00), mood (facade00) ]
    // POSTs mint, in order: beef0001 (subject), ca110011 (constraint), beef0002 (mood).
    const minted = ["beef0001", "ca110011", "beef0002"];
    let n = 0;
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ id: minted[n++] }),
          text: async () => "",
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    // Capture the corrective PUT(s) without hitting the network.
    const updateSpy = vi
      .spyOn(api.modules, "update")
      .mockImplementation(async (id: string) => ({ id }) as unknown as ModuleRow);

    const subject = mkMod({
      id: "deadbeef",
      type: "wildcard",
      _uid: "u-s",
      meta: { name: "subject" },
      payload: { options: [] }, // no internal refs → must NOT trigger a PUT
      bundle_origin: "outer-uid",
    });
    const constraint = mkMod({
      id: "ca000001",
      type: "constraint",
      _uid: "u-c",
      meta: { name: "pairing" },
      payload: {
        source_wildcard_id: "deadbeef",
        target_wildcard_id: "facade00",
        matrix: {},
      },
      bundle_origin: "outer-uid",
    });
    const mood = mkMod({
      id: "facade00",
      type: "wildcard",
      _uid: "u-m",
      meta: { name: "mood" },
      payload: { options: [] }, // no internal refs → must NOT trigger a PUT
      bundle_origin: "outer-uid",
    });
    const outer: BundleInstance = {
      ...emptyBundleInstance("bndllib2"),
      _uid: "outer-uid",
      start_idx: 0,
      end_idx: 2,
      name: "Kit",
    };
    const modules = [subject, constraint, mood];

    await cascadeRestoreForBundle({
      outer,
      modules,
      bundles: [outer],
      isModuleMissing: (m) => ["deadbeef", "ca000001", "facade00"].includes(m.id),
      isBundleMissing: () => false,
    });

    // Exactly ONE corrective PUT — only the constraint carried sibling refs.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [calledId, calledBody] = updateSpy.mock.calls[0];
    // Corrective PUT targets the constraint's freshly-minted id.
    expect(calledId).toBe("ca110011");
    const p = (calledBody as { payload?: Record<string, unknown> }).payload;
    expect(p).toBeDefined();
    // BOTH endpoints repointed despite the forward-ref POST order.
    expect(p?.source_wildcard_id).toBe("beef0001"); // subject's new id
    expect(p?.target_wildcard_id).toBe("beef0002"); // mood's new id (forward ref!)

    // The two ref-free wildcards (beef0001, beef0002) were NOT corrected.
    const correctedIds = updateSpy.mock.calls.map((c) => c[0]);
    expect(correctedIds).not.toContain("beef0001");
    expect(correctedIds).not.toContain("beef0002");
  });
});
