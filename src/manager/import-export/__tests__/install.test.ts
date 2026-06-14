import { describe, expect, it, vi } from "vitest";
import {
  applyCollisionDecisions,
  detectInstallCollisions,
  enforceClashSafety,
  installEnvelope,
  type CollisionDecision,
  type InstallCollision,
  type InstallOptions,
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
