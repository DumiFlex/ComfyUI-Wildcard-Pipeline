import { describe, expect, it } from "vitest";
import { bundleAlerts, bundleDescendants, isHiddenInCollapsedBundle } from "./bundle-alerts";
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

function bundle(uid: string, over: Partial<BundleInstance> = {}): BundleInstance {
  return {
    _uid: uid, library_id: "lib", start_idx: 0, end_idx: 0, enabled: true,
    collapsed: false, inserted_at_hash: "h", name: uid, color: null, ...over,
  };
}
function mod(uid: string, origin: string | null, over: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: `id-${uid}`, _uid: uid, type: "wildcard", enabled: true,
    meta: { name: `Mod ${uid}` }, payload: {}, bundle_origin: origin, ...over,
  } as ModuleEntry;
}

const checks = (sev: Record<string, string>, missing: string[] = [], clash: string[] = []) => ({
  severityFor: (id: string) => sev[id] ?? null,
  conflictLabel: (id: string) => (sev[id] ? "missing var" : null),
  isMissingFromLibrary: (m: ModuleEntry) => missing.includes(m._uid ?? ""),
  isTypeConflict: (m: ModuleEntry) => clash.includes(m._uid ?? ""),
});

describe("isHiddenInCollapsedBundle", () => {
  it("hides rows of a collapsed bundle and of a bundle inside one", () => {
    const bundles = [bundle("outer", { collapsed: true }), bundle("inner", { parent_uid: "outer" })];
    expect(isHiddenInCollapsedBundle(mod("a", "outer"), bundles)).toBe(true);
    expect(isHiddenInCollapsedBundle(mod("b", "inner"), bundles)).toBe(true);
  });
  it("keeps top-level rows and rows of open bundles in sight", () => {
    const bundles = [bundle("open"), bundle("shut", { collapsed: true })];
    expect(isHiddenInCollapsedBundle(mod("a", null), bundles)).toBe(false);
    expect(isHiddenInCollapsedBundle(mod("b", "open"), bundles)).toBe(false);
    expect(isHiddenInCollapsedBundle(mod("c", "gone"), bundles)).toBe(false);
  });
});

describe("bundleDescendants", () => {
  it("takes sub-bundle rows too", () => {
    const bundles = [bundle("outer"), bundle("inner", { parent_uid: "outer" }), bundle("other")];
    const mods = [mod("a", "outer"), mod("b", "inner"), mod("c", "other"), mod("d", null)];
    expect(bundleDescendants(bundles[0], mods, bundles).map((m) => m._uid)).toEqual(["a", "b"]);
    expect(bundleDescendants(bundles[1], mods, bundles).map((m) => m._uid)).toEqual(["b"]);
  });
});

describe("bundleAlerts", () => {
  it("is empty when nothing is wrong", () => {
    expect(bundleAlerts([mod("a", "x")], checks({}))).toEqual({ conflict: null, state: null, title: "" });
  });
  it("keeps the worst conflict and names each row", () => {
    const r = bundleAlerts([mod("a", "x"), mod("b", "x")], checks({ a: "info", b: "warning" }));
    expect(r.conflict).toBe("warning");
    expect(r.title).toContain("Mod a: missing var");
    expect(r.title).toContain("Mod b: missing var");
  });
  it("reports missing rows but not example ones, and clash over missing", () => {
    expect(bundleAlerts([mod("a", "x", { example: true })], checks({}, ["a"])).state).toBeNull();
    expect(bundleAlerts([mod("a", "x")], checks({}, ["a"])).state).toBe("missing");
    expect(bundleAlerts([mod("a", "x"), mod("b", "x")], checks({}, ["a"], ["b"])).state).toBe("clash");
    expect(bundleAlerts([mod("b", "x"), mod("a", "x")], checks({}, ["a"], ["b"])).state).toBe("clash");
  });
});
