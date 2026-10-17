import { describe, expect, it } from "vitest";
import { ref } from "vue";
import type { BundleInstance, ContextWidgetValue, ModuleEntry } from "../../../widgets/_shared";
import { createBundleMasterToggles } from "./master-toggles";

function row(uid: string, type: ModuleEntry["type"], origin: string, instance: ModuleEntry["instance"] = {}): ModuleEntry {
  return { id: `id-${uid}`, _uid: uid, type, enabled: true, meta: { name: uid }, entries: [], payload: {}, instance, bundle_origin: origin } as ModuleEntry;
}

function bundle(uid: string, start: number, end: number, extra: Partial<BundleInstance> = {}): BundleInstance {
  return { _uid: uid, library_id: `lib-${uid}`, name: uid, start_idx: start, end_idx: end, ...extra } as BundleInstance;
}

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error("missing");
  return x;
}

/** Outer bundle O (rows 0..3) holding a direct wildcard, a direct
 *  constraint and an inner bundle I (rows 2..3). */
function setup(mods?: ModuleEntry[], bundles?: BundleInstance[], lastUsed?: (id?: string) => number | null) {
  const value = ref<ContextWidgetValue>({
    modules: mods ?? [
      row("a", "wildcard", "O"),
      row("c", "constraint", "O"),
      row("b", "wildcard", "I"),
      row("f", "fixed_values", "I"),
    ],
    bundles: bundles ?? [bundle("O", 0, 3), bundle("I", 2, 3, { parent_uid: "O" })],
  } as ContextWidgetValue);
  const commitModules = (next: ModuleEntry[], b?: BundleInstance[]) => {
    value.value = { ...value.value, modules: next, bundles: b ?? value.value.bundles };
  };
  const t = createBundleMasterToggles(
    { value, commitModules, modulesContainer: ref(null) },
    { lastUsedSeedReader: lastUsed },
  );
  const get = (uid: string) => must(value.value.modules.find((m) => m._uid === uid));
  const b = (uid: string) => must((value.value.bundles ?? []).find((x) => x._uid === uid));
  return { value, t, get, b };
}

describe("bundle master toggles — internal", () => {
  it("aggregates only internalable rows; null when none apply", () => {
    const { t, b } = setup();
    expect(t.bundleInternalState(b("O"))).toBe("none");
    const only = setup([row("c", "constraint", "O")], [bundle("O", 0, 0)]);
    expect(only.t.bundleInternalState(only.b("O"))).toBeNull();
  });

  it("ON claims direct children, chains into inners, OFF undoes exactly that", () => {
    const { t, get, b } = setup();
    t.toggleBundleInternal("O");
    expect(get("a").instance).toEqual({ internal: true, _ui: { master_internal: true, master_internal_by: "O" } });
    expect(get("c").instance).toEqual({});
    expect(get("b").instance).toEqual({ internal: true, _ui: { master_internal: true, master_internal_by: "I" } });
    expect(b("I").master_internal_chained_by).toBe("O");
    expect(t.bundleInternalState(b("O"))).toBe("all");

    t.toggleBundleInternal("O");
    expect(get("a").instance).toEqual({ _ui: {} });
    expect(get("b").instance).toEqual({ _ui: {} });
    expect("master_internal_chained_by" in b("I")).toBe(false);
    expect(t.bundleInternalState(b("O"))).toBe("none");
  });

  it("OFF preserves hand-marked rows while any master claim exists", () => {
    const { t, get, b } = setup([
      row("a", "wildcard", "O"),
      row("h", "wildcard", "O", { internal: true }),
    ], [bundle("O", 0, 1)]);
    t.toggleBundleInternal("O");
    expect(t.bundleInternalState(b("O"))).toBe("all");
    t.toggleBundleInternal("O");
    expect(get("a").instance).toEqual({ _ui: {} });
    expect(get("h").instance).toEqual({ internal: true });
  });

  it("OFF cascades when every row is hand-marked", () => {
    const { t, get } = setup([
      row("a", "wildcard", "O", { internal: true }),
      row("b", "wildcard", "I", { internal: true, _ui: { x: 1 } as never }),
    ], [bundle("O", 0, 1), bundle("I", 1, 1, { parent_uid: "O", master_internal_chained_by: "O" })]);
    t.toggleBundleInternal("O");
    expect(get("a").instance).toEqual({ _ui: {} });
    expect(get("b").instance).toEqual({ _ui: { x: 1 } });
  });

  it("a direct click drops the bundle's own chain tag", () => {
    const { t, b } = setup();
    t.toggleBundleInternal("O");
    t.toggleBundleInternal("I");
    expect("master_internal_chained_by" in b("I")).toBe(false);
  });

  it("ON skips an inner that is already all-internal", () => {
    const { t, get, b } = setup([
      row("a", "wildcard", "O"),
      row("b", "wildcard", "I", { internal: true }),
    ], [bundle("O", 0, 1), bundle("I", 1, 1, { parent_uid: "O" })]);
    t.toggleBundleInternal("O");
    expect(get("b").instance).toEqual({ internal: true });
    expect(b("I").master_internal_chained_by).toBeUndefined();
  });
});

describe("bundle master toggles — seed lock", () => {
  it("aggregates only seed-lockable rows", () => {
    const { t, b } = setup();
    expect(t.bundleLockState(b("O"))).toBe("none");
    const only = setup([row("c", "constraint", "O")], [bundle("O", 0, 0)]);
    expect(only.t.bundleLockState(only.b("O"))).toBeNull();
  });

  it("ON locks with last-used, then remembered, then 0; OFF drops the key", () => {
    const { t, get, b } = setup([
      row("a", "wildcard", "O"),
      row("m", "combine", "O", { _ui: { last_locked_seed: 9 } }),
      row("z", "derivation", "O"),
      row("b", "wildcard", "I"),
    ], [bundle("O", 0, 3), bundle("I", 3, 3, { parent_uid: "O" })], (id) => (id === "a" ? 42 : null));
    t.toggleBundleLock("O");
    expect(get("a").instance).toEqual({ locked_seed: 42, _ui: { last_locked_seed: 42, master_lock: true, master_lock_by: "O" } });
    expect(get("m").instance?.locked_seed).toBe(9);
    expect(get("z").instance?.locked_seed).toBe(0);
    expect(get("b").instance?._ui).toEqual({ last_locked_seed: 0, master_lock: true, master_lock_by: "I" });
    expect(b("I").master_lock_chained_by).toBe("O");
    expect(t.bundleLockState(b("O"))).toBe("all");

    t.toggleBundleLock("O");
    expect(get("a").instance).toEqual({ _ui: { last_locked_seed: 42 } });
    expect(get("b").instance).toEqual({ _ui: { last_locked_seed: 0 } });
    expect("master_lock_chained_by" in b("I")).toBe(false);
  });

  it("OFF keeps a hand-locked row while a master claim exists", () => {
    const { t, get } = setup([
      row("a", "wildcard", "O"),
      row("h", "wildcard", "O", { locked_seed: 5 }),
    ], [bundle("O", 0, 1)]);
    t.toggleBundleLock("O");
    t.toggleBundleLock("O");
    expect(get("a").instance).toEqual({ _ui: { last_locked_seed: 0 } });
    expect(get("h").instance).toEqual({ locked_seed: 5 });
  });

  it("OFF cascades when every lock is by hand", () => {
    const { t, get } = setup([
      row("a", "wildcard", "O", { locked_seed: 1 }),
      row("h", "wildcard", "O", { locked_seed: 5 }),
    ], [bundle("O", 0, 1)]);
    t.toggleBundleLock("O");
    expect(get("a").instance).toEqual({ _ui: {} });
    expect(get("h").instance).toEqual({ _ui: {} });
  });
});
