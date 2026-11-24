import { describe, expect, it } from "vitest";
import type { ContextWidgetValue, ModuleEntry } from "../widgets/_shared";
import {
  canLock,
  contextChoices,
  unfitTargets,
  emptyRun,
  withLockFrames,
  lockOwner,
  lockPlan,
  lockRows,
  missingByToggle,
  releaseRows,
  withoutMissingTargets,
  type LastRun,
} from "./toggle-lock";
import { parseTogglesConfig, type TogglesConfig, type ToggleRow } from "./toggles";

function mod(uid: string, type: ModuleEntry["type"] = "wildcard", instance: ModuleEntry["instance"] = {}): ModuleEntry {
  return { id: `id${uid}`, _uid: uid, type, enabled: true, meta: { name: `Row ${uid}` }, entries: [], instance };
}
const ctx = (...modules: ModuleEntry[]): ContextWidgetValue => ({ version: 1, modules });
const OWNER = lockOwner(7, "t1");

function run(over: Partial<LastRun> = {}): LastRun {
  return { ...emptyRun(), seeds: { a: 11, b: 22 }, chainSeed: 5, picks: { a: "opt-a" }, ...over };
}

function toggle(over: Partial<ToggleRow> = {}): ToggleRow {
  return { id: "t1", kind: "toggle", name: "Lock", var: "lock", on: true, pin: false, out: 0, style: "switch", ...over };
}
const cfgOf = (...rows: ToggleRow[]): TogglesConfig => ({ version: 1, mode: "any", group_var: "", rows });

describe("lockRows", () => {
  it("locks the value of a wildcard and marks the owner", () => {
    const r = lockRows(ctx(mod("a")), new Set(["a"]), "value", OWNER, run());
    expect(r.locked).toBe(1);
    expect(r.value.modules[0]?.instance).toMatchObject({ locked_option_id: "opt-a", _ui: { locked_by: OWNER } });
    expect(r.value.modules[0]?.instance?.locked_seed).toBeUndefined();
  });

  it("falls back to the seed when the row has no single pick", () => {
    const r = lockRows(ctx(mod("b"), mod("c", "fixed_values")), new Set(["b", "c"]), "value", OWNER, run());
    expect(r.value.modules[0]?.instance?.locked_seed).toBe(22);
    // No seed of its own: the chain seed.
    expect(r.value.modules[1]?.instance?.locked_seed).toBe(5);
  });

  it("locks the seed in seed mode even with a pick", () => {
    const r = lockRows(ctx(mod("a")), new Set(["a"]), "seed", OWNER, run());
    expect(r.value.modules[0]?.instance).toMatchObject({ locked_seed: 11 });
    expect(r.value.modules[0]?.instance?.locked_option_id).toBeUndefined();
  });

  it("leaves a row locked by hand alone", () => {
    const r = lockRows(ctx(mod("a", "wildcard", { locked_seed: 99 })), new Set(["a"]), "value", OWNER, run());
    expect(r.kept).toBe(1);
    expect(r.value.modules[0]?.instance?.locked_seed).toBe(99);
  });

  it("re-locks its own row with the new mode", () => {
    const first = lockRows(ctx(mod("a")), new Set(["a"]), "seed", OWNER, run()).value;
    const again = lockRows(first, new Set(["a"]), "value", OWNER, run());
    expect(again.value.modules[0]?.instance).toMatchObject({ locked_option_id: "opt-a" });
    expect(again.value.modules[0]?.instance?.locked_seed).toBeUndefined();
  });

  it("counts rows with nothing to lock to", () => {
    const r = lockRows(ctx(mod("z")), new Set(["z"]), "seed", OWNER, emptyRun());
    expect(r).toMatchObject({ locked: 0, noRun: 1 });
  });

  it("keeps each frame's pick as a frame override", () => {
    const framePicks = new Map([[0, { a: "opt-a" }], [1, { a: "opt-b" }]]);
    const r = lockRows(ctx(mod("a")), new Set(["a"]), "value", OWNER, run({ framePicks }));
    const m = r.value.modules[0];
    expect(m?.instance?.locked_option_id).toBe("opt-a");
    expect(m?.iteration_overrides).toEqual({ "1": { locked_option_id: "opt-b" } });
  });

  it("locks every pick of a multi-pick row, frame by frame", () => {
    const framePicks = new Map([[0, { a: ["x", "y"] }], [1, { a: ["y"] }]]);
    const r = lockRows(ctx(mod("a")), new Set(["a"]), "value", OWNER, run({ picks: { a: ["x", "y"] }, framePicks }));
    const m = r.value.modules[0];
    expect(m?.instance?.locked_option_ids).toEqual(["x", "y"]);
    expect(m?.iteration_overrides).toEqual({ "1": { locked_option_ids: ["y"] } });
    const back = releaseRows(r.value, OWNER).value.modules[0];
    expect(back?.instance?.locked_option_ids).toBeUndefined();
    expect(back?.iteration_overrides).toBeUndefined();
  });

  it("keeps each frame's seed in seed mode", () => {
    const frameSeeds = new Map([[0, 11], [1, 40]]);
    const r = lockRows(ctx(mod("a")), new Set(["a"]), "seed", OWNER, run({ frameSeeds }));
    expect(r.value.modules[0]?.iteration_overrides).toEqual({ "1": { locked_seed: 40 } });
  });
});

describe("lockRows on one frame", () => {
  const framePicks = new Map([[0, { a: "opt-a" }], [2, { a: "opt-c" }]]);
  const frameSeeds = new Map([[0, 11], [2, 70]]);

  it("locks that frame only and marks it", () => {
    const r = lockRows(ctx(mod("a")), new Set(["a"]), "value", OWNER, run({ framePicks, frameSeeds }), 2);
    const m = r.value.modules[0];
    expect(r.locked).toBe(1);
    expect(m?.instance?.locked_option_id).toBeUndefined();
    expect(m?.iteration_overrides).toEqual({ "2": { locked_option_id: "opt-c" } });
    expect(m?.instance?._ui).toEqual({ locked_by: OWNER, locked_frame: 2 });
  });

  it("locks the frame's seed in seed mode", () => {
    const r = lockRows(ctx(mod("a")), new Set(["a"]), "seed", OWNER, run({ frameSeeds }), 2);
    expect(r.value.modules[0]?.iteration_overrides).toEqual({ "2": { locked_seed: 70 } });
  });

  it("skips a frame with no run yet", () => {
    const r = lockRows(ctx(mod("a")), new Set(["a"]), "seed", OWNER, run({ frameSeeds }), 5);
    expect(r.locked).toBe(0);
    expect(r.noRun).toBe(1);
  });

  it("keeps a frame locked by hand", () => {
    const hand: ModuleEntry = { ...mod("a"), iteration_overrides: { "2": { locked_seed: 3 } } };
    const r = lockRows(ctx(hand), new Set(["a"]), "seed", OWNER, run({ frameSeeds }), 2);
    expect(r.kept).toBe(1);
    expect(r.value.modules[0]?.iteration_overrides).toEqual({ "2": { locked_seed: 3 } });
  });

  it("keeps a frame the row's base lock already holds", () => {
    const r = lockRows(ctx(mod("a", "wildcard", { locked_seed: 9 })), new Set(["a"]), "seed", OWNER, run({ frameSeeds }), 2);
    expect(r.kept).toBe(1);
  });

  it("releasing lets go of that frame alone and keeps a base lock set since", () => {
    const locked = lockRows(ctx(mod("a")), new Set(["a"]), "seed", OWNER, run({ frameSeeds }), 2).value;
    const row = locked.modules[0] as ModuleEntry;
    const handSet = ctx({ ...row, instance: { ...row.instance, locked_seed: 9 } });
    const back = releaseRows(handSet, OWNER).value.modules[0];
    expect(back?.instance?.locked_seed).toBe(9);
    expect(back?.iteration_overrides).toBeUndefined();
    expect(back?.instance?._ui?.locked_by).toBeUndefined();
    expect(back?.instance?._ui?.locked_frame).toBeUndefined();
  });
});

describe("withLockFrames", () => {
  it("sets the frame on a lock that holds and drops it when off", () => {
    const targets = [{ node: "n", uid: "a" }];
    const cfg = cfgOf(toggle({ lock: "seed", lock_targets: targets }), toggle({ id: "t2", on: false, lock: "seed", lock_targets: targets, lock_frame: 1 }));
    const next = withLockFrames(cfg, new Map([["t1", 3]]));
    const [t1, t2] = next.rows as ToggleRow[];
    expect(t1?.lock_frame).toBe(3);
    expect(t2?.lock_frame).toBeUndefined();
    expect(withLockFrames(next, new Map([["t1", null]])).rows[0]).not.toHaveProperty("lock_frame");
  });

  it("returns the same config when nothing changes", () => {
    const cfg = cfgOf(toggle());
    expect(withLockFrames(cfg, new Map())).toBe(cfg);
  });
});

describe("releaseRows", () => {
  it("unlocks only its own rows, frames included", () => {
    const framePicks = new Map([[0, { a: "opt-a" }], [1, { a: "opt-b" }]]);
    const locked = lockRows(ctx(mod("a"), mod("b", "wildcard", { locked_seed: 3 })), new Set(["a", "b"]), "value", OWNER, run({ framePicks })).value;
    const r = releaseRows(locked, OWNER);
    expect(r.released).toBe(1);
    const a = r.value.modules[0];
    expect(a?.instance?.locked_option_id).toBeUndefined();
    expect(a?.instance?._ui?.locked_by).toBeUndefined();
    expect(a?.iteration_overrides).toBeUndefined();
    expect(r.value.modules[1]?.instance?.locked_seed).toBe(3);
  });

  it("leaves a row another toggle owns", () => {
    const other = lockRows(ctx(mod("a")), new Set(["a"]), "seed", lockOwner(7, "t2"), run()).value;
    expect(releaseRows(other, OWNER).released).toBe(0);
  });
});

describe("lockPlan", () => {
  const targets = [{ node: "slate-marten", uid: "a" }];

  it("locks when a toggle goes on and lets go when it goes off", () => {
    const off = cfgOf(toggle({ on: false, lock: "value", lock_targets: targets }));
    const on = cfgOf(toggle({ lock: "value", lock_targets: targets }));
    expect(lockPlan(off, on)).toEqual([{ toggleId: "t1", release: [], lock: targets, mode: "value" }]);
    expect(lockPlan(on, off)).toEqual([{ toggleId: "t1", release: targets, lock: [], mode: "value" }]);
  });

  it("follows needs", () => {
    const parentOff = cfgOf(toggle({ needs: "p", lock: "seed", lock_targets: targets }), toggle({ id: "p", on: false, var: "p" }));
    const parentOn = cfgOf(toggle({ needs: "p", lock: "seed", lock_targets: targets }), toggle({ id: "p", var: "p" }));
    expect(lockPlan(parentOff, parentOn)[0]?.lock).toEqual(targets);
  });

  it("locks added and lets go of removed targets while on", () => {
    const more = [...targets, { node: "slate-marten", uid: "b" }];
    const a = cfgOf(toggle({ lock: "seed", lock_targets: targets }));
    const b = cfgOf(toggle({ lock: "seed", lock_targets: [{ node: "slate-marten", uid: "b" }] }));
    expect(lockPlan(a, cfgOf(toggle({ lock: "seed", lock_targets: more })))[0]).toMatchObject({ lock: [{ uid: "b" }], release: [] });
    expect(lockPlan(a, b)[0]).toMatchObject({ lock: [{ uid: "b" }], release: [{ uid: "a" }] });
  });

  it("relocks every target when the mode changes, and nothing on load", () => {
    const a = cfgOf(toggle({ lock: "seed", lock_targets: targets }));
    const b = cfgOf(toggle({ lock: "value", lock_targets: targets }));
    expect(lockPlan(a, b)[0]).toMatchObject({ lock: targets, release: targets, mode: "value" });
    expect(lockPlan(a, a)).toEqual([]);
  });
});

describe("missing targets", () => {
  const choices = contextChoices("slate-marten", "WP Context", ctx(mod("a"), mod("b", "fixed_values")));

  it("labels choices", () => {
    expect(choices[0]).toEqual({ node: "slate-marten", uid: "a", label: "slate-marten · WP Context · Row a", wildcard: true, kind: "wildcard" });
    expect(choices[1]?.wildcard).toBe(false);
    expect(choices[1]?.kind).toBe("fixed_values");
  });

  it("offers no constraint rows: they have no seed to lock", () => {
    const list = contextChoices("slate-marten", "WP Context", ctx(mod("a"), mod("k", "constraint"), mod("d", "derivation")));
    expect(list.map((c) => c.uid)).toEqual(["a", "d"]);
  });

  it("only a wildcard can lock its value", () => {
    const list = contextChoices("slate-marten", "WP Context", ctx(mod("a"), mod("d", "derivation")));
    expect(list.map((c) => canLock(c, "value"))).toEqual([true, false]);
    expect(list.map((c) => canLock(c, "seed"))).toEqual([true, true]);
    const targets = [{ node: "slate-marten", uid: "a" }, { node: "slate-marten", uid: "d" }, { node: "gone-one", uid: "x" }];
    expect(unfitTargets(targets, list, "value")).toEqual([{ node: "slate-marten", uid: "d" }]);
    expect(unfitTargets(targets, list, "seed")).toEqual([]);
  });

  it("finds and removes targets that are gone", () => {
    const gone = { node: "amber-otter", uid: "x" };
    const cfg = cfgOf(toggle({ lock: "seed", lock_targets: [{ node: "slate-marten", uid: "a" }, gone] }));
    expect(missingByToggle(cfg, choices).get("t1")).toEqual([gone]);
    const fixed = withoutMissingTargets(cfg, choices);
    expect((fixed.rows[0] as ToggleRow).lock_targets).toEqual([{ node: "slate-marten", uid: "a" }]);
  });
});

describe("parse", () => {
  it("keeps lock and well-formed targets once", () => {
    const cfg = parseTogglesConfig({
      version: 1, mode: "any", group_var: "",
      rows: [{ id: "t1", kind: "toggle", name: "L", var: "l", lock: "value", lock_targets: [
        { node: "a-b", uid: "x" }, { node: "a-b", uid: "x" }, { node: "", uid: "y" }, "junk",
      ] }, { id: "t2", kind: "toggle", name: "M", var: "m", lock: "bogus" }],
    });
    const [t1, t2] = cfg.rows as ToggleRow[];
    expect(t1?.lock).toBe("value");
    expect(t1?.lock_targets).toEqual([{ node: "a-b", uid: "x" }]);
    expect(t2?.lock).toBeUndefined();
  });

  it("keeps a lock's frame only while it locks", () => {
    const cfg = parseTogglesConfig({
      version: 1, mode: "any", group_var: "",
      rows: [
        { id: "t1", kind: "toggle", name: "L", var: "l", lock: "seed", lock_frame: 2 },
        { id: "t2", kind: "toggle", name: "M", var: "m", lock_frame: 2 },
        { id: "t3", kind: "toggle", name: "N", var: "n", lock: "seed", lock_frame: -1 },
      ],
    });
    expect((cfg.rows as ToggleRow[]).map((r) => r.lock_frame)).toEqual([2, undefined, undefined]);
  });
});
