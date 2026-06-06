import { describe, expect, it } from "vitest";
import {
  detectInstallCollisions,
  enforceClashSafety,
  type CollisionDecision,
  type InstallCollision,
  type LibrarySnapshot,
} from "../install";
import type { ResolvedSelection } from "../commit";

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
