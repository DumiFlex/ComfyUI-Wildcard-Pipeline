import { describe, it, expect } from "vitest";
import { withFrameInstance, diffInstance, setFrameOverride, clearFrameOverride, toggleFrameLock, toggleFrameEnabled, dropRedundantFrameLockNulls, effectiveEnabled, frameEnableOverride } from "./frame-overrides";
import type { ModuleEntry } from "../../widgets/_shared";

function mod(extra: Partial<ModuleEntry> = {}): ModuleEntry {
  return { id: "m1", type: "wildcard", enabled: true, meta: { name: "x" }, entries: [], instance: {}, ...extra };
}

describe("frame-overrides", () => {
  it("withFrameInstance overlays the frame patch onto the base instance", () => {
    const m = mod({
      instance: { variable_binding: "x" },
      iteration_overrides: { "2": { pinned_option_id: "0", mode: "pinned" } },
    });
    const r = withFrameInstance(m, 2);
    expect(r.instance).toEqual({ variable_binding: "x", pinned_option_id: "0", mode: "pinned" });
    expect(withFrameInstance(m, null)).toBe(m);
    expect(withFrameInstance(m, 1)).toBe(m);
  });
  it("diffInstance captures only changed declared fields", () => {
    const base = { variable_binding: "x", pinned_option_id: null };
    const edited = { variable_binding: "x", pinned_option_id: "0", mode: "pinned" };
    expect(diffInstance(base, edited, ["pinned_option_id", "mode", "variable_binding"]))
      .toEqual({ pinned_option_id: "0", mode: "pinned" });
  });
  it("setFrameOverride writes merged and clearFrameOverride removes", () => {
    const m = mod();
    const a = setFrameOverride(m, 2, { pinned_option_id: "0" });
    expect(a.iteration_overrides).toEqual({ "2": { pinned_option_id: "0" } });
    const b = clearFrameOverride(a, 2);
    expect(b.iteration_overrides).toBeUndefined();
  });
  it("toggleFrameLock: locks an unlocked frame with the fallback", () => {
    const m = mod();
    const r = toggleFrameLock(m, 2, 999);
    expect(r.iteration_overrides?.["2"]).toEqual({ locked_seed: 999 });
  });
  it("toggleFrameLock: unlocking a frame-only lock drops the key", () => {
    const m = mod({ iteration_overrides: { "2": { locked_seed: 999 } } });
    const r = toggleFrameLock(m, 2, 0);
    expect(r.iteration_overrides).toBeUndefined();
  });
  it("toggleFrameLock: unlocking a frame writes null when base is locked", () => {
    const m = mod({ instance: { locked_seed: 5 } });
    const r = toggleFrameLock(m, 2, 0);
    expect(r.iteration_overrides?.["2"]).toEqual({ locked_seed: null });
  });

  // ── per-frame enable override (frame_enabled) ──────────────────────────
  it("effectiveEnabled: frame override wins, else base", () => {
    expect(effectiveEnabled(mod({ enabled: true }), null)).toBe(true);
    expect(effectiveEnabled(mod({ enabled: true }), 2)).toBe(true); // no override → base
    const off = mod({ enabled: true, frame_enabled: { "2": false } });
    expect(effectiveEnabled(off, 2)).toBe(false);
    expect(effectiveEnabled(off, 1)).toBe(true);
    const on = mod({ enabled: false, frame_enabled: { "2": true } });
    expect(effectiveEnabled(on, 2)).toBe(true);    // base off, frame on
    expect(effectiveEnabled(on, 1)).toBe(false);   // base off elsewhere
    expect(effectiveEnabled(on, null)).toBe(false); // base view
  });
  it("effectiveEnabled: folds legacy disabled_frames", () => {
    const m = mod({ enabled: true, disabled_frames: [2] });
    expect(effectiveEnabled(m, 2)).toBe(false);
    expect(effectiveEnabled(m, 0)).toBe(true);
  });
  it("frameEnableOverride: reports on / off / null vs base", () => {
    expect(frameEnableOverride(mod({ enabled: true, frame_enabled: { "2": false } }), 2)).toBe("off");
    expect(frameEnableOverride(mod({ enabled: false, frame_enabled: { "2": true } }), 2)).toBe("on");
    expect(frameEnableOverride(mod({ enabled: true }), 2)).toBeNull();
    expect(frameEnableOverride(mod({ enabled: true, frame_enabled: { "2": true } }), 2)).toBeNull(); // equals base
    expect(frameEnableOverride(mod({ enabled: true, frame_enabled: { "2": false } }), null)).toBeNull();
  });
  it("toggleFrameEnabled: a base-OFF module turns ON for the frame (the bug fix)", () => {
    const r = toggleFrameEnabled(mod({ enabled: false }), 2);
    expect(r.frame_enabled).toEqual({ "2": true });
    expect(r.enabled).toBe(false); // base untouched
  });
  it("toggleFrameEnabled: a base-ON module turns OFF for the frame", () => {
    const r = toggleFrameEnabled(mod({ enabled: true }), 2);
    expect(r.frame_enabled).toEqual({ "2": false });
  });
  it("toggleFrameEnabled: toggling back to base drops the override + the field", () => {
    const r = toggleFrameEnabled(mod({ enabled: true, frame_enabled: { "2": false } }), 2);
    expect(r.frame_enabled).toBeUndefined();
  });
  it("toggleFrameEnabled: migrates legacy disabled_frames into frame_enabled", () => {
    const r = toggleFrameEnabled(mod({ enabled: true, disabled_frames: [1] }), 2);
    expect(r.disabled_frames).toBeUndefined();
    expect(r.frame_enabled).toEqual({ "1": false, "2": false });
  });
  it("toggleFrameEnabled: recovers the user's stuck state (base off, stray disabled_frames)", () => {
    // Repro of the QA bug: base disabled with a leftover blocklist entry;
    // enabling frame #2 should run ONLY #2 and clear the noise.
    const r = toggleFrameEnabled(mod({ enabled: false, disabled_frames: [1] }), 2);
    expect(r.disabled_frames).toBeUndefined();
    expect(r.frame_enabled).toEqual({ "2": true });
  });

  // ── dropRedundantFrameLockNulls ────────────────────────────────────────
  it("dropRedundantFrameLockNulls: clears a frame locked_seed:null once base is unlocked", () => {
    // Repro of the QA bug: lock #4, lock base, unlock #4 (writes null override),
    // unlock base → the null override is now redundant and must be swept.
    const m = mod({ instance: {}, iteration_overrides: { "3": { locked_seed: null } } });
    expect(dropRedundantFrameLockNulls(m).iteration_overrides).toBeUndefined();
  });
  it("dropRedundantFrameLockNulls: KEEPS the null override while base is locked", () => {
    const m = mod({ instance: { locked_seed: 5 }, iteration_overrides: { "3": { locked_seed: null } } });
    expect(dropRedundantFrameLockNulls(m).iteration_overrides).toEqual({ "3": { locked_seed: null } });
  });
  it("dropRedundantFrameLockNulls: keeps a frame's real lock + other override fields", () => {
    const m = mod({
      instance: {},
      iteration_overrides: { "1": { locked_seed: 99 }, "2": { locked_seed: null, pinned_option_id: "0" } },
    });
    expect(dropRedundantFrameLockNulls(m).iteration_overrides)
      .toEqual({ "1": { locked_seed: 99 }, "2": { pinned_option_id: "0" } });
  });
});
