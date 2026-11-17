import { describe, expect, it } from "vitest";
import type { ModuleEntry } from "../../widgets/_shared";
import { lockFields, lockStateAt, lockStateOf, nextLockState, withBaseLock, withFrameLock } from "./lock-cycle";
import { dropRedundantFrameLockNulls } from "./frame-overrides";

function wc(instance: ModuleEntry["instance"] = {}, iteration_overrides?: ModuleEntry["iteration_overrides"]): ModuleEntry {
  return {
    id: "w1", _uid: "u1", type: "wildcard", enabled: true, meta: { name: "w", description: "", tags: [] },
    entries: [], instance, ...(iteration_overrides ? { iteration_overrides } : {}),
  } as ModuleEntry;
}

describe("lock cycle", () => {
  it("reads the state from the instance", () => {
    expect(lockStateOf({})).toBe("off");
    expect(lockStateOf({ locked_seed: 3 })).toBe("seed");
    expect(lockStateOf({ locked_option_id: "o1" })).toBe("value");
    expect(lockStateOf({ locked_seed: 3, locked_option_id: "o1" })).toBe("value");
  });

  it("steps off → seed → value → off, skipping value with no pick", () => {
    expect(nextLockState("off", "o1")).toBe("seed");
    expect(nextLockState("seed", "o1")).toBe("value");
    expect(nextLockState("seed", null)).toBe("off");
    expect(nextLockState("value", "o1")).toBe("off");
  });

  it("writes one lock field per state", () => {
    expect(lockFields("seed", 7, "o1")).toEqual({ locked_seed: 7 });
    expect(lockFields("value", 7, "o1")).toEqual({ locked_option_id: "o1" });
    expect(lockFields("off", 7, "o1")).toEqual({});
  });

  it("base: a value lock drops the seed but remembers it", () => {
    const seeded = withBaseLock({}, { locked_seed: 7 });
    expect(seeded).toEqual({ locked_seed: 7, _ui: { last_locked_seed: 7 } });
    const valued = withBaseLock(seeded, { locked_option_id: "o1" });
    expect(valued).toEqual({ locked_option_id: "o1", _ui: { last_locked_seed: 7 } });
    expect(withBaseLock(valued, {})).toEqual({ _ui: { last_locked_seed: 7 } });
  });

  it("frame: locks a value over an unlocked base, then unlocks to no override", () => {
    const m = withFrameLock(wc(), 2, { locked_option_id: "o1" });
    expect(m.iteration_overrides).toEqual({ "2": { locked_option_id: "o1" } });
    expect(lockStateAt(m, 2)).toBe("value");
    expect(lockStateAt(m, null)).toBe("off");
    expect(withFrameLock(m, 2, {}).iteration_overrides).toBeUndefined();
  });

  it("frame: a value lock over a seed-locked base nulls the seed on that frame", () => {
    const m = withFrameLock(wc({ locked_seed: 5 }), 1, { locked_option_id: "o2" });
    expect(m.iteration_overrides).toEqual({ "1": { locked_seed: null, locked_option_id: "o2" } });
    // Unlocking the frame against a locked base writes null, keeping it off.
    const off = withFrameLock(m, 1, {});
    expect(off.iteration_overrides).toEqual({ "1": { locked_seed: null } });
    // Same seed as the base: no override at all.
    expect(withFrameLock(m, 1, { locked_seed: 5 }).iteration_overrides).toBeUndefined();
  });

  it("frame: keeps the frame's other overrides", () => {
    const m = withFrameLock(wc({}, { "0": { option_weights: { a: 2 } } }), 0, { locked_seed: 9 });
    expect(m.iteration_overrides).toEqual({ "0": { option_weights: { a: 2 }, locked_seed: 9 } });
  });

  it("sweeps stale value-lock nulls once the base is unlocked", () => {
    const m = wc({}, { "3": { locked_option_id: null }, "4": { locked_option_id: null, option_weights: { a: 1 } } });
    expect(dropRedundantFrameLockNulls(m).iteration_overrides).toEqual({ "4": { option_weights: { a: 1 } } });
  });
});
