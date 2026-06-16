import { describe, it, expect, vi, afterEach } from "vitest";
import { cascadeRestoreForBundle, rewriteChildId } from "./cascade-restore";
import {
  bundleSnapshotModified,
  computeBundleFingerprint,
} from "./bundle-fingerprint";
import { api } from "../../../manager/api/client";
import type { BundleRow, ModuleRow } from "../../../manager/api/types";
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

/**
 * QA bug (2026-06-12): after a cascade restore the canvas flashed DRIFT on a
 * restored constraint. Root cause — Phase 4 rebound the workflow row's id +
 * payload (refs repointed) but kept the STALE frozen-snapshot payload_hash,
 * which no longer matched the corrected library entry's hash (a ref-free
 * wildcard didn't drift because its payload, hence hash, was unchanged).
 * Phase 1 now captures the library hash (POST + corrective update) and Phase 4
 * stamps it, mirroring the bundle inserted_at_hash sync.
 */
describe("cascadeRestoreForBundle — Phase 4 syncs payload_hash to the library entry", () => {
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
      payload_hash: "stale-frozen-hash",
      _uid: "u",
      ...over,
    } as ModuleEntry & { bundle_origin?: string };
  }

  it("stamps the corrected library hash on a restored constraint (no DRIFT), and the POST hash on a ref-free wildcard", async () => {
    // POST mints {id, payload_hash} per restored module, in range order:
    //   subject (deadbeef) → beef0001 / "wh-post"   (ref-free)
    //   constraint (ca000001, src deadbeef) → ca110011 / "cn-post"
    const minted = [
      { id: "beef0001", payload_hash: "wh-post" },
      { id: "ca110011", payload_hash: "cn-post" },
    ];
    let n = 0;
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => minted[n++],
          text: async () => "",
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    // The corrective PUT returns the CORRECTED hash (the constraint's payload moved).
    vi.spyOn(api.modules, "update").mockImplementation(
      async (id: string) => ({ id, payload_hash: "cn-corrected" }) as unknown as ModuleRow,
    );

    const subject = mkMod({
      id: "deadbeef",
      type: "wildcard",
      _uid: "u-s",
      meta: { name: "subject" },
      payload: { options: [] }, // ref-free → no corrective PUT → POST hash
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
      ...emptyBundleInstance("bndllib3"),
      _uid: "outer-uid",
      start_idx: 0,
      end_idx: 1,
      name: "Kit",
    };

    const result = await cascadeRestoreForBundle({
      outer,
      modules: [subject, constraint],
      bundles: [outer],
      isModuleMissing: (m) => ["deadbeef", "ca000001"].includes(m.id),
      isBundleMissing: () => false,
    });

    const s = result.newModules.find((m) => m._uid === "u-s");
    const c = result.newModules.find((m) => m._uid === "u-c");
    // Ref-free wildcard → its POST hash.
    expect(s?.payload_hash).toBe("wh-post");
    // Corrected constraint → the corrective-update hash, NOT the stale frozen
    // hash (which is what produced the DRIFT badge).
    expect(c?.payload_hash).toBe("cn-corrected");
    expect(c?.payload_hash).not.toBe("stale-frozen-hash");

    // Gap #1 (holistic audit 2026-06-13): the PUSHED bundle children (Phase 3)
    // must carry the SAME live hashes. `toChildSnapshot` froze the stale
    // pre-cascade hash, so without the rewriteChildId hash-stamp the pushed
    // bundle ships a child whose payload was corrected but whose payload_hash
    // is stale → RE-INSERTING the bundle shows spurious DRIFT against the live
    // library entry.
    const childWild = result.rewrittenChildren.find((c2) => c2.type === "wildcard");
    const childCon = result.rewrittenChildren.find((c2) => c2.type === "constraint");
    expect(childWild?.payload_hash).toBe("wh-post");
    expect(childCon?.payload_hash).toBe("cn-corrected");
    expect(childCon?.payload_hash).not.toBe("stale-frozen-hash");
  });
});

/**
 * QA bug (2026-06-15): pushing an outer bundle with the cascade "Restore N
 * missing references first" option re-creates a missing INNER bundle, but the
 * inner then flashes a false MODIFIED drift badge — even though it was just
 * freshly created and matches the library. Root cause — Phase 4's `newBundles`
 * rebinds each restored inner's `library_id` + `inserted_at_hash` but kept the
 * STALE `snapshot_fingerprint` captured before the restore. The drift detector
 * `bundleSnapshotModified` compares the LIVE fingerprint against that stale
 * stored value → they differ → false MODIFIED. (`onBundlePushSaved` only
 * recomputes the OUTER's fingerprint, never the inner ones.)
 *
 * The fix is the symmetric sibling of the inserted_at_hash sync: Phase 4 also
 * reconciles each RESTORED inner's `snapshot_fingerprint` to
 * `computeBundleFingerprint(rebound, newModules)` so the freshly-restored
 * content matches its stored baseline (no drift). Only restored inners are
 * touched — a genuinely-modified, non-restored bundle keeps its own
 * fingerprint so real drift still surfaces.
 */
describe("cascadeRestoreForBundle — Phase 4 reconciles restored inner-bundle fingerprint", () => {
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

  it("clears false drift on a restored inner bundle carrying a stale snapshot_fingerprint", async () => {
    // No modules are missing → fetch (module POST) is never called; only the
    // inner bundle's library row was deleted upstream.
    const fetchMock = vi.fn(
      async () =>
        ({ ok: true, json: async () => ({}), text: async () => "" }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    // The restored inner bundle's fresh library entry.
    const createSpy = vi
      .spyOn(api.bundles, "create")
      .mockResolvedValue({ id: "innernew", payload_hash: "inner-fresh-hash" } as BundleRow);

    // Outer (range 0-2): a top-level wildcard at idx 0, then an inner bundle
    // covering idx 1-2 (two wildcards owned by the inner).
    const topWild = mkMod({
      id: "top00001",
      type: "wildcard",
      _uid: "u-top",
      meta: { name: "top" },
      bundle_origin: "outer-uid",
    });
    const innerA = mkMod({
      id: "inna0001",
      type: "wildcard",
      _uid: "u-ia",
      meta: { name: "innerA" },
      payload_hash: "ha",
      bundle_origin: "inner-uid",
    });
    const innerB = mkMod({
      id: "innb0001",
      type: "wildcard",
      _uid: "u-ib",
      meta: { name: "innerB" },
      payload_hash: "hb",
      bundle_origin: "inner-uid",
    });
    const outer: BundleInstance = {
      ...emptyBundleInstance("outerlib"),
      _uid: "outer-uid",
      start_idx: 0,
      end_idx: 2,
      name: "Kit",
    };
    // Missing inner bundle carrying a STALE fingerprint that won't match the
    // live content — this is what produces the false MODIFIED badge today.
    const inner: BundleInstance = {
      ...emptyBundleInstance("innerlibOLD"),
      _uid: "inner-uid",
      parent_uid: "outer-uid",
      start_idx: 1,
      end_idx: 2,
      name: "Inner",
      snapshot_fingerprint: "v2:stale",
    };
    const modules = [topWild, innerA, innerB];
    const bundles = [outer, inner];

    const result = await cascadeRestoreForBundle({
      outer,
      modules,
      bundles,
      isModuleMissing: () => false,
      isBundleMissing: (b) => b._uid === "inner-uid",
    });

    // The inner bundle was restored (Phase 2 POST) and rebound (Phase 4).
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(result.restoredBundleCount).toBe(1);

    const reboundInner = result.newBundles.find((b) => b._uid === "inner-uid")!;
    // Sanity: rebind swapped the dead library_id + synced inserted_at_hash.
    expect(reboundInner.library_id).toBe("innernew");
    expect(reboundInner.inserted_at_hash).toBe("inner-fresh-hash");

    // The headline fix: the rebound inner's snapshot_fingerprint matches the
    // freshly-restored content → NO false drift. (Stale "v2:stale" would fail.)
    expect(reboundInner.snapshot_fingerprint).toBe(
      computeBundleFingerprint(reboundInner, result.newModules),
    );
    expect(bundleSnapshotModified(reboundInner, result.newModules)).toBe(false);
  });

  it("does NOT touch a non-restored, genuinely-modified bundle's fingerprint", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({ ok: true, json: async () => ({}), text: async () => "" }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const createSpy = vi
      .spyOn(api.bundles, "create")
      .mockResolvedValue({ id: "innernew", payload_hash: "inner-fresh-hash" } as BundleRow);

    // Outer (range 0-3): top-level wildcard, a MISSING inner (idx 1), and a
    // SIBLING inner (idx 2-3) that is NOT missing but genuinely drifted.
    const topWild = mkMod({
      id: "top00001",
      type: "wildcard",
      _uid: "u-top",
      meta: { name: "top" },
      bundle_origin: "outer-uid",
    });
    const missingChild = mkMod({
      id: "miss0001",
      type: "wildcard",
      _uid: "u-miss",
      meta: { name: "missingChild" },
      payload_hash: "hm",
      bundle_origin: "missing-uid",
    });
    const siblingA = mkMod({
      id: "sibl0001",
      type: "wildcard",
      _uid: "u-sa",
      meta: { name: "siblingA" },
      payload_hash: "hs",
      bundle_origin: "sibling-uid",
    });
    const siblingB = mkMod({
      id: "sibl0002",
      type: "wildcard",
      _uid: "u-sb",
      meta: { name: "siblingB" },
      payload_hash: "hs2",
      bundle_origin: "sibling-uid",
    });
    const outer: BundleInstance = {
      ...emptyBundleInstance("outerlib"),
      _uid: "outer-uid",
      start_idx: 0,
      end_idx: 3,
      name: "Kit",
    };
    const missingInner: BundleInstance = {
      ...emptyBundleInstance("missinglibOLD"),
      _uid: "missing-uid",
      parent_uid: "outer-uid",
      start_idx: 1,
      end_idx: 1,
      name: "Missing",
      snapshot_fingerprint: "v2:stale",
    };
    // A genuine pre-existing drift baseline: the sibling's stored fingerprint
    // intentionally does NOT match its live content. Cascade must NOT erase it.
    const driftedSibling: BundleInstance = {
      ...emptyBundleInstance("siblinglib"),
      _uid: "sibling-uid",
      parent_uid: "outer-uid",
      start_idx: 2,
      end_idx: 3,
      name: "Sibling",
      snapshot_fingerprint: "v2:genuinedrift",
    };
    const modules = [topWild, missingChild, siblingA, siblingB];
    const bundles = [outer, missingInner, driftedSibling];

    const result = await cascadeRestoreForBundle({
      outer,
      modules,
      bundles,
      isModuleMissing: () => false,
      isBundleMissing: (b) => b._uid === "missing-uid",
    });

    expect(createSpy).toHaveBeenCalledTimes(1);

    // The non-restored sibling keeps its stored fingerprint untouched → its
    // genuine drift still surfaces. Blanket-recompute would have erased it.
    const reboundSibling = result.newBundles.find((b) => b._uid === "sibling-uid")!;
    expect(reboundSibling.snapshot_fingerprint).toBe("v2:genuinedrift");
    expect(bundleSnapshotModified(reboundSibling, result.newModules)).toBe(true);

    // The restored inner is still clean (fix applies only to it).
    const reboundMissing = result.newBundles.find((b) => b._uid === "missing-uid")!;
    expect(bundleSnapshotModified(reboundMissing, result.newModules)).toBe(false);
  });
});
