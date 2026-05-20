/**
 * Bundle-gate helpers: pure-function bridge that frontend readers
 * (conflict scanner, graph walkers, assembler preview, toolbar counts)
 * use to AND a bundle's enabled flag with its child's enabled flag.
 *
 * Behaviour mirrors the engine boundary's deserialize_node_input
 * gate — pytest covers the wire-side, this covers the frontend side
 * with the same allow / deny matrix so a child can't end up
 * "running" on one side and "skipped" on the other.
 */
import { describe, expect, it } from "vitest";
import {
  buildBundleEnabledMap,
  isModuleEffectivelyEnabled,
  type BundleInstance,
} from "./_shared";

function bundle(uid: string, enabled: boolean): BundleInstance {
  return {
    _uid: uid,
    library_id: "lib",
    start_idx: 0,
    end_idx: 0,
    enabled,
    collapsed: false,
    inserted_at_hash: "",
    name: "b",
  };
}

describe("buildBundleEnabledMap", () => {
  it("returns an empty map when bundles is undefined or empty", () => {
    expect(buildBundleEnabledMap(undefined).size).toBe(0);
    expect(buildBundleEnabledMap([]).size).toBe(0);
  });

  it("maps each bundle's _uid to its enabled flag", () => {
    const m = buildBundleEnabledMap([
      bundle("A", true),
      bundle("B", false),
    ]);
    expect(m.get("A")).toBe(true);
    expect(m.get("B")).toBe(false);
  });

  it("treats undefined enabled as true (defensive default)", () => {
    const malformed = { _uid: "X" } as unknown as BundleInstance;
    const m = buildBundleEnabledMap([malformed]);
    expect(m.get("X")).toBe(true);
  });
});

describe("isModuleEffectivelyEnabled", () => {
  it("returns false when the module itself is disabled regardless of bundles", () => {
    expect(isModuleEffectivelyEnabled({ enabled: false }, [])).toBe(false);
    expect(
      isModuleEffectivelyEnabled(
        { enabled: false, bundle_origin: "A" },
        [bundle("A", true)],
      ),
    ).toBe(false);
  });

  it("returns true when the module has no bundle_origin and is itself enabled", () => {
    expect(isModuleEffectivelyEnabled({ enabled: true }, [])).toBe(true);
    expect(
      isModuleEffectivelyEnabled({ enabled: true }, [bundle("A", false)]),
    ).toBe(true);
  });

  it("ANDs bundle.enabled with child.enabled when both are present", () => {
    const bundles = [bundle("A", false)];
    expect(
      isModuleEffectivelyEnabled({ enabled: true, bundle_origin: "A" }, bundles),
    ).toBe(false);
    bundles[0] = bundle("A", true);
    expect(
      isModuleEffectivelyEnabled({ enabled: true, bundle_origin: "A" }, bundles),
    ).toBe(true);
  });

  it("ignores orphan bundle_origin (uid not in bundles)", () => {
    // Stale / removed bundle ref — module's own enabled wins. Matches
    // the engine-side behaviour: don't gate when there's no live bundle
    // to gate against.
    expect(
      isModuleEffectivelyEnabled(
        { enabled: true, bundle_origin: "STALE" },
        [bundle("A", false)],
      ),
    ).toBe(true);
  });

  it("accepts a pre-built map (hot-path optimisation)", () => {
    const map = buildBundleEnabledMap([bundle("A", false), bundle("B", true)]);
    expect(
      isModuleEffectivelyEnabled({ enabled: true, bundle_origin: "A" }, map),
    ).toBe(false);
    expect(
      isModuleEffectivelyEnabled({ enabled: true, bundle_origin: "B" }, map),
    ).toBe(true);
  });
});
