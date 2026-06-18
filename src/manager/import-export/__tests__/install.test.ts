import { describe, expect, it, vi } from "vitest";
import {
  applyCollisionDecisions,
  detectInstallCollisions,
  enforceClashSafety,
  installEnvelope,
  normalizeInvalidIds,
  type CollisionDecision,
  type InstallCollision,
  type InstallOptions,
  type InstallResult,
  type LibrarySnapshot,
} from "../install";
import type { CommitOk, CommitPayload, ResolvedSelection } from "../commit";

function emptySelection(): ResolvedSelection {
  return {
    bundles: [],
    wildcards: [],
    fixed_values: [],
    combines: [],
    derivations: [],
    constraints: [],
    categories: [],
    templates: [],
  } as unknown as ResolvedSelection;
}

describe("normalizeInvalidIds", () => {
  it("mints a valid 8-hex id for a non-hex module id, rewrites it in place", () => {
    const selection = emptySelection();
    selection.wildcards = [
      { entity: { id: "coloruni", name: "color" }, decision: { kind: "add" } },
      { entity: { id: "ed1bccf8", name: "decor" }, decision: { kind: "add" } },
    ] as unknown as ResolvedSelection["wildcards"];
    const map = normalizeInvalidIds(selection);
    expect(Object.keys(map)).toEqual(["coloruni"]); // valid id untouched
    expect(map.coloruni).toMatch(/^[0-9a-f]{8}$/);
    expect((selection.wildcards[0].entity as { id: string }).id).toBe(map.coloruni);
    expect((selection.wildcards[1].entity as { id: string }).id).toBe("ed1bccf8");
  });

  it("returns an empty map when every id is already valid", () => {
    const selection = emptySelection();
    selection.wildcards = [
      { entity: { id: "ed1bccf8", name: "decor" }, decision: { kind: "add" } },
    ] as unknown as ResolvedSelection["wildcards"];
    expect(normalizeInvalidIds(selection)).toEqual({});
  });

  it("normalizes bundle ids too", () => {
    const selection = emptySelection();
    selection.bundles = [
      { entity: { id: "mybundle", name: "b" }, decision: { kind: "add" } },
    ] as unknown as ResolvedSelection["bundles"];
    expect(normalizeInvalidIds(selection).mybundle).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("detectInstallCollisions — type-conflict flag", () => {
  it("flags a same-id DIFFERENT-kind collision as typeConflict", () => {
    const selection = emptySelection();
    selection.fixed_values = [
      { entity: { id: "aabbccdd", name: "fv" }, decision: { kind: "add" } },
    ];
    const library: LibrarySnapshot = {
      modules: new Map([["aabbccdd", { id: "aabbccdd", name: "wc", type: "wildcard" }]]),
      bundles: new Map(),
    };
    const collisions = detectInstallCollisions(selection, library);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({ id: "aabbccdd", kind: "fixed_values", typeConflict: true });
  });

  it("does NOT flag a same-id SAME-kind collision", () => {
    const selection = emptySelection();
    selection.fixed_values = [
      { entity: { id: "aabbccdd", name: "fv" }, decision: { kind: "add" } },
    ];
    const library: LibrarySnapshot = {
      modules: new Map([["aabbccdd", { id: "aabbccdd", name: "old fv", type: "fixed_values" }]]),
      bundles: new Map(),
    };
    const collisions = detectInstallCollisions(selection, library);
    expect(collisions[0]).toMatchObject({ id: "aabbccdd", typeConflict: false });
  });

  it("legacy library row without a type does not raise a clash", () => {
    const selection = emptySelection();
    selection.fixed_values = [
      { entity: { id: "aabbccdd", name: "fv" }, decision: { kind: "add" } },
    ];
    const library: LibrarySnapshot = {
      modules: new Map([["aabbccdd", { id: "aabbccdd", name: "legacy" }]]), // no type
      bundles: new Map(),
    };
    expect(detectInstallCollisions(selection, library)[0].typeConflict).toBe(false);
  });
});

describe("enforceClashSafety — replace can never clobber a different kind", () => {
  const collisions: InstallCollision[] = [
    { kind: "fixed_values", id: "clash", incomingName: "fv", existingName: "wc", typeConflict: true },
    { kind: "wildcard", id: "same", incomingName: "a", existingName: "a-old", typeConflict: false },
  ];

  it("coerces a replace on a clash into install-as-new (rename)", () => {
    const decisions: Record<string, CollisionDecision> = {
      clash: { kind: "replace" },
      same: { kind: "replace" },
    };
    const out = enforceClashSafety(collisions, decisions);
    expect(out.clash).toEqual({ kind: "rename", new_name: "fv" });
    expect(out.same).toEqual({ kind: "replace" }); // non-clash untouched
  });

  it("leaves skip / rename decisions on a clash untouched", () => {
    const decisions: Record<string, CollisionDecision> = {
      clash: { kind: "skip" },
    };
    expect(enforceClashSafety(collisions, decisions).clash).toEqual({ kind: "skip" });
  });
});

describe("installEnvelope — natively-supported future versions install as-is", () => {
  function fakeCommit(): {
    importExport: InstallOptions["importExport"];
    seen: CommitPayload[];
  } {
    const seen: CommitPayload[] = [];
    const commit = vi.fn(async (payload: CommitPayload): Promise<CommitOk> => {
      seen.push(payload);
      return { ok: true, undo_entry_id: "deadbeefdeadbeef" };
    });
    return { importExport: { commit } as unknown as InstallOptions["importExport"], seen };
  }

  it("installs a v4 constraint payload (target_select reach) without rejecting or migrating", async () => {
    const v4Envelope = {
      schema_version: 4,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], categories: [], templates: [],
      constraints: [
        {
          id: "cn001abc",
          type: "constraint",
          name: "narrowed reach",
          payload: {
            source_wildcard_id: "wcaaaaaa",
            target_wildcard_id: "wcbbbbbb",
            matrix: {},
            exceptions: [],
            target_select: { mode: "next", count: 2 },
          },
        },
      ],
    };
    const { importExport, seen } = fakeCommit();
    const result = await installEnvelope({ envelope: v4Envelope }, { importExport });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.installed.constraint).toBe(1);
    // No migration ran for a natively-supported future version.
    expect(result.migratedEntityCount).toBe(0);
    // The constraint reached the commit payload with target_select intact.
    expect(seen).toHaveLength(1);
    const added = seen[0].adds.find((a) => a.kind === "constraint");
    if (!added) throw new Error("constraint add not found in commit payload");
    expect((added.entity.payload as Record<string, unknown>).target_select).toEqual({
      mode: "next",
      count: 2,
    });
  });

  it("rejects a v5 envelope (> MAX_KNOWN) at parse with the future-version error", async () => {
    const v5Envelope = {
      schema_version: 5,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [], templates: [],
    };
    const { importExport, seen } = fakeCommit();
    const result = await installEnvelope({ envelope: v5Envelope }, { importExport });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("parse_failed");
    expect(result.error?.message).toMatch(/future schema version/i);
    // Nothing was committed.
    expect(seen).toHaveLength(0);
  });
});

describe("applyCollisionDecisions rename map", () => {
  it("returns oldId→newId for every rename decision", () => {
    const selection = {
      bundles: [], wildcards: [
        { entity: { id: "aaaa1111", name: "Sub", type: "wildcard" }, decision: { kind: "add" } },
      ],
      fixed_values: [], combines: [], derivations: [], constraints: [],
      categories: [], templates: [],
    } as unknown as Parameters<typeof applyCollisionDecisions>[0];
    const renameMap = applyCollisionDecisions(selection, {
      aaaa1111: { kind: "rename", new_name: "Sub copy" },
    });
    const newId = Object.keys(renameMap).length === 1 ? renameMap.aaaa1111 : "";
    expect(newId).toMatch(/^[0-9a-f]{8,}$/);
    expect((selection.wildcards[0].entity as { id: string }).id).toBe(newId);
  });

  it("returns an empty map when there are no renames", () => {
    const selection = {
      bundles: [], wildcards: [
        { entity: { id: "aaaa1111", name: "Sub", type: "wildcard" }, decision: { kind: "add" } },
      ],
      fixed_values: [], combines: [], derivations: [], constraints: [],
      categories: [], templates: [],
    } as unknown as Parameters<typeof applyCollisionDecisions>[0];
    expect(applyCollisionDecisions(selection, { aaaa1111: { kind: "replace" } })).toEqual({});
  });
});

describe("reattach type surface", () => {
  it("LibrarySnapshot module entries accept community_post_slug", () => {
    const snap: LibrarySnapshot = {
      modules: new Map([["aaaa1111", { id: "aaaa1111", name: "Sub", type: "wildcard", community_post_slug: "author/sub" }]]),
      bundles: new Map(),
    };
    expect(snap.modules.get("aaaa1111")?.community_post_slug).toBe("author/sub");
  });
  it("InstallOptions accepts dependencies, InstallResult carries reattachedRefCount", () => {
    const opts = { importExport: {} as InstallOptions["importExport"], dependencies: [{ module_id: "aaaa1111", slug: "author/sub" }] };
    const res: InstallResult = { ok: true, installed: {} as InstallResult["installed"], warnings: [], migratedEntityCount: 0, reattachedRefCount: 3 };
    expect(opts.dependencies[0].slug).toBe("author/sub");
    expect(res.reattachedRefCount).toBe(3);
  });
});

describe("installEnvelope reattach pass", () => {
  function fakeCommit(): {
    importExport: InstallOptions["importExport"];
    seen: CommitPayload[];
  } {
    const seen: CommitPayload[] = [];
    const commit = vi.fn(async (payload: CommitPayload): Promise<CommitOk> => {
      seen.push(payload);
      return { ok: true, undo_entry_id: "deadbeefdeadbeef" };
    });
    return { importExport: { commit } as unknown as InstallOptions["importExport"], seen };
  }

  // Publisher uuids must be valid 8-hex: both the nested-`@{}` detector
  // (`REF_TOKEN_RE`) and the rewrite (`uuid-remap`'s `REF_RE`) are hex-gated,
  // so a `@{pubsub01}` (non-hex) ref would be invisible to the machinery. The
  // sketch's mnemonic ids are mapped to hex here (pubsub01→aabb0001 etc.); the
  // slug-bridge + local target ids keep the sketch's intent verbatim.
  const PUB_SUBJECT = "aabb0001";
  const PUB_MOOD = "ccdd0002";

  /** Envelope carrying a constraint (source/target ids) + a wildcard whose
   *  first option embeds an `@{}` ref — both pointing at publisher uuids. */
  function reattachEnvelope() {
    return {
      schema_version: 4,
      bundles: [], fixed_values: [], combines: [], derivations: [], categories: [], templates: [],
      wildcards: [
        {
          id: "wc0001aa",
          type: "wildcard",
          name: "Scene",
          payload: { options: [{ value: `a @{${PUB_SUBJECT}} b` }] },
        },
      ],
      constraints: [
        {
          id: "cn0001aa",
          type: "constraint",
          name: "pairing",
          payload: {
            source_wildcard_id: PUB_SUBJECT,
            target_wildcard_id: PUB_MOOD,
            matrix: {},
            exceptions: [],
          },
        },
      ],
    };
  }

  it("remaps a constraint axis + a nested @{} ref to slug-matched local modules", async () => {
    const { importExport, seen } = fakeCommit();
    const library: LibrarySnapshot = {
      modules: new Map([
        ["localsub1", { id: "localsub1", name: "Subject", type: "wildcard", community_post_slug: "author/subject" }],
        ["localmod1", { id: "localmod1", name: "Mood", type: "wildcard", community_post_slug: "author/mood" }],
      ]),
      bundles: new Map(),
    };
    const result = await installEnvelope(
      { envelope: reattachEnvelope() },
      {
        importExport,
        library,
        dependencies: [
          { module_id: PUB_SUBJECT, slug: "author/subject" },
          { module_id: PUB_MOOD, slug: "author/mood" },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.reattachedRefCount).toBe(3);

    expect(seen).toHaveLength(1);
    const constraint = seen[0].adds.find((a) => a.kind === "constraint");
    if (!constraint) throw new Error("constraint add not found in commit payload");
    const cp = constraint.entity.payload as Record<string, unknown>;
    expect(cp.source_wildcard_id).toBe("localsub1");
    expect(cp.target_wildcard_id).toBe("localmod1");

    const wildcard = seen[0].adds.find((a) => a.kind === "wildcard");
    if (!wildcard) throw new Error("wildcard add not found in commit payload");
    const wp = wildcard.entity.payload as { options: Array<{ value: string }> };
    expect(wp.options[0].value).toBe("a @{localsub1} b");
  });

  it("no-ops when no dependencies are provided", async () => {
    const { importExport, seen } = fakeCommit();
    const result = await installEnvelope({ envelope: reattachEnvelope() }, { importExport });

    expect(result.ok).toBe(true);
    expect(result.reattachedRefCount ?? 0).toBe(0);

    const constraint = seen[0].adds.find((a) => a.kind === "constraint");
    if (!constraint) throw new Error("constraint add not found in commit payload");
    expect((constraint.entity.payload as Record<string, unknown>).source_wildcard_id).toBe(PUB_SUBJECT);
  });

  // BR-B1: a bundle's inner-bundle child ref ({id, type:"bundle"}) reattaches
  // to a local bundle matched by community_post_slug, exactly like a
  // constraint's wildcard axis reattaches to a slug-matched local module.
  const PUB_INNER = "eeff0003";

  /** Envelope carrying a BUNDLE whose children include an inner-bundle ref
   *  (pointing at a publisher bundle uuid) + a leaf wildcard child. */
  function bundleReattachEnvelope() {
    return {
      schema_version: 4,
      wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [], templates: [],
      bundles: [
        {
          id: "bn0001aa",
          name: "Outer",
          children: [
            { id: PUB_INNER, type: "bundle", name: "Inner" },
            { id: "wcleaf01", type: "wildcard", name: "Leaf" },
          ],
        },
      ],
    };
  }

  it("remaps an inner-bundle child ref to a slug-matched local bundle", async () => {
    const { importExport, seen } = fakeCommit();
    const library: LibrarySnapshot = {
      modules: new Map(),
      bundles: new Map([
        ["localinner", { id: "localinner", name: "Inner", community_post_slug: "author/inner" }],
      ]),
    };
    const result = await installEnvelope(
      { envelope: bundleReattachEnvelope() },
      {
        importExport,
        library,
        dependencies: [{ module_id: PUB_INNER, slug: "author/inner" }],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.reattachedRefCount).toBe(1);

    expect(seen).toHaveLength(1);
    const bundle = seen[0].adds.find((a) => a.kind === "bundle");
    if (!bundle) throw new Error("bundle add not found in commit payload");
    const children = bundle.entity.children as Array<{ id: string; type: string }>;
    const inner = children.find((c) => c.type === "bundle");
    if (!inner) throw new Error("inner-bundle child not found");
    expect(inner.id).toBe("localinner");
    // The leaf wildcard child is untouched.
    expect(children.find((c) => c.type === "wildcard")?.id).toBe("wcleaf01");
  });
});
