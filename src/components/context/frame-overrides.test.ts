import { describe, it, expect } from "vitest";
import { withFrameInstance, diffInstance, setFrameOverride, clearFrameOverride } from "./frame-overrides";
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
});
