import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import ContextLoopWidget from "./ContextLoopWidget.vue";
import SeedListModal from "../shared/SeedListModal.vue";
import { emptyContextLoopConfig } from "./types";
import { currentFrame } from "./frame-cursor";
import { deriveLoopSeeds } from "../shared/seed-derive";

describe("ContextLoopWidget", () => {
  it("renders defaults — hash chip active, both switches off, internal toggles on", () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig() } });
    expect(w.find('[data-test="loop-strategy-hash_index"]').classes()).toContain("wp-loop__chip--active");
    expect(w.find('[data-test="loop-strategy-sequential"]').classes()).not.toContain("wp-loop__chip--active");
    expect(w.find('[data-test="loop-override-toggle"]').classes()).not.toContain("wp-loop__switch--on");
    expect(w.find('[data-test="loop-bypass-toggle"]').classes()).not.toContain("wp-loop__switch--on");
    // Both internal toggles default to ON.
    expect(w.find('[data-test="loop-iteration-internal"]').classes()).toContain("wp-loop__pi-btn--on");
    expect(w.find('[data-test="loop-total-internal"]').classes()).toContain("wp-loop__pi-btn--on");
  });

  it("emits new strategy on chip click", async () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig() } });
    await w.find('[data-test="loop-strategy-sequential"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { strategy: string };
    expect(emitted.strategy).toBe("sequential");
  });

  it("skip emit when picking the already-active strategy", async () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig() } });
    await w.find('[data-test="loop-strategy-hash_index"]').trigger("click");
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("emits override_seed toggle on switch click", async () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig() } });
    await w.find('[data-test="loop-override-toggle"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { override_seed: boolean };
    expect(emitted.override_seed).toBe(true);
  });

  it("emits bypass toggle on switch click", async () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig() } });
    await w.find('[data-test="loop-bypass-toggle"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { bypass: boolean };
    expect(emitted.bypass).toBe(true);
  });

  it("dims strategy/override/var rows when bypass=on", () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: { ...emptyContextLoopConfig(), bypass: true } } });
    expect(w.classes()).toContain("wp-loop--bypass-on");
  });

  it("emits iteration_var_name update on text input", async () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig() } });
    const input = w.find<HTMLInputElement>('[data-test="loop-iteration-var"]');
    input.element.value = "idx";
    await input.trigger("input");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { iteration_var_name: string };
    expect(emitted.iteration_var_name).toBe("idx");
  });

  it("applies wp-loop--muted class when nodeMode=2", () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig(), nodeMode: 2 } });
    expect(w.classes()).toContain("wp-loop--muted");
  });

  it("applies wp-loop--bypassed class when nodeMode=4", () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig(), nodeMode: 4 } });
    expect(w.classes()).toContain("wp-loop--bypassed");
  });

  it("emits iteration_internal toggle on its button click (true → false)", async () => {
    // Default is true; clicking toggles to false.
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig() } });
    await w.find('[data-test="loop-iteration-internal"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { iteration_internal: boolean };
    expect(emitted.iteration_internal).toBe(false);
  });

  it("emits total_internal toggle on its button click (true → false)", async () => {
    // Default is true; clicking toggles to false.
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig() } });
    await w.find('[data-test="loop-total-internal"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { total_internal: boolean };
    expect(emitted.total_internal).toBe(false);
  });

  it("renders internal-on style when flag set", () => {
    const w = mount(ContextLoopWidget, {
      props: { modelValue: { ...emptyContextLoopConfig(), iteration_internal: true } },
    });
    expect(w.find('[data-test="loop-iteration-internal"]').classes()).toContain("wp-loop__pi-btn--on");
  });
});

function ws(extra: Partial<ReturnType<typeof emptyContextLoopConfig>> = {}) {
  return mount(ContextLoopWidget, {
    props: { modelValue: { ...emptyContextLoopConfig(), ...extra }, baseSeed: 42, count: 4 },
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  });
}

describe("ContextLoopWidget seeds button", () => {
  it("renders the Per-iteration seeds button", () => {
    expect(ws().find('[data-test="loop-seeds-btn"]').exists()).toBe(true);
  });
  it("badge shows the locked count when >0", () => {
    expect(ws({ seed_locks: { "1": 9, "2": 8 } }).find('[data-test="loop-seeds-badge"]').text()).toMatch(/2 locked/i);
  });
  it("hides the badge when nothing is locked", () => {
    expect(ws().find('[data-test="loop-seeds-badge"]').exists()).toBe(false);
  });
  it("clicking opens the modal", async () => {
    const wr = ws();
    await wr.find('[data-test="loop-seeds-btn"]').trigger("click");
    expect(wr.findComponent(SeedListModal).exists()).toBe(true);
  });
  it("capitalizes the bypass row label", () => {
    expect(ws().text()).toContain("Bypass loop");
  });
  it("passes the override hint to the modal only when Override Context seed is off", async () => {
    const off = ws(); // override_seed false by default → nudge to turn it on
    await off.find('[data-test="loop-seeds-btn"]').trigger("click");
    expect(off.findComponent(SeedListModal).props("overrideHint")).toBeTruthy();

    const on = ws({ override_seed: true });
    await on.find('[data-test="loop-seeds-btn"]').trigger("click");
    expect(on.findComponent(SeedListModal).props("overrideHint")).toBeFalsy();
  });
});

describe("ContextLoopWidget frame selector", () => {
  beforeEach(() => { currentFrame.value = null; });
  function fw(count = 3) {
    return mount(ContextLoopWidget, {
      props: { modelValue: emptyContextLoopConfig(), count },
      attachTo: document.body, global: { stubs: { teleport: true } },
    });
  }
  it("renders base + one chip per iteration", () => {
    expect(fw(3).findAll('[data-test^="loop-frame-"]')).toHaveLength(4);
  });
  it("clicking a frame chip sets the shared cursor; base clears it", async () => {
    const wr = fw(3);
    await wr.find('[data-test="loop-frame-2"]').trigger("click");
    expect(currentFrame.value).toBe(1);
    await wr.find('[data-test="loop-frame-base"]').trigger("click");
    expect(currentFrame.value).toBe(null);
  });
});

describe("ContextLoopWidget bypass (#13)", () => {
  it("shows an N-bypassed badge on the seeds button", () => {
    const cfg = { ...emptyContextLoopConfig(), bypass_frames: [1, 3] };
    const w = mount(ContextLoopWidget, { props: { modelValue: cfg, count: 5 } });
    expect(w.find('[data-test="loop-seeds-bypass-badge"]').text()).toMatch(/2 bypassed/i);
  });
  it("marks bypassed edit-frame chips with a dashed-border class", () => {
    const cfg = { ...emptyContextLoopConfig(), bypass_frames: [1, 3] };
    const w = mount(ContextLoopWidget, { props: { modelValue: cfg, count: 5 } });
    // frame index 1 -> chip #2 (data-test loop-frame-2)
    expect(w.find('[data-test="loop-frame-2"]').classes()).toContain("wp-loop__chip--bypassed");
    expect(w.find('[data-test="loop-frame-4"]').classes()).toContain("wp-loop__chip--bypassed");
    expect(w.find('[data-test="loop-frame-1"]').classes()).not.toContain("wp-loop__chip--bypassed");
  });

  it("has no bypass badge when none are bypassed", () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig(), count: 5 } });
    expect(w.find('[data-test="loop-seeds-bypass-badge"]').exists()).toBe(false);
  });
  it("writes bypass changes from the modal back into the config", async () => {
    const cfg = { ...emptyContextLoopConfig(), bypass_frames: [] };
    const w = mount(ContextLoopWidget, { props: { modelValue: cfg, count: 4 } });
    await w.get('[data-test="loop-seeds-btn"]').trigger("click");
    w.findComponent(SeedListModal).vm.$emit("update:bypassFrames", [2]);
    const calls = w.emitted("update:modelValue")!;
    const last = calls[calls.length - 1][0] as typeof cfg;
    expect(last.bypass_frames).toEqual([2]);
  });
});

/**
 * Modifier-click on the frame chips. Both states were already visible here but
 * only changeable inside the modal, two clicks away and covering the node you
 * were reading.
 */
describe("ContextLoopWidget frame chip modifier-clicks", () => {
  beforeEach(() => { currentFrame.value = null; });

  function fw(cfgPatch: Partial<ReturnType<typeof emptyContextLoopConfig>> = {}, count = 4) {
    return mount(ContextLoopWidget, {
      props: { modelValue: { ...emptyContextLoopConfig(), ...cfgPatch }, count, baseSeed: 42 },
    });
  }
  const lastEmit = (w: ReturnType<typeof fw>) => {
    const calls = w.emitted("update:modelValue");
    return calls?.[calls.length - 1]?.[0] as ReturnType<typeof emptyContextLoopConfig>;
  };

  it("shift-click locks the frame to the seed it would have used", async () => {
    const w = fw();
    await w.find('[data-test="loop-frame-3"]').trigger("click", { shiftKey: true });
    const next = lastEmit(w);
    // Frame index 2, and the value must be a real derived seed — not a
    // placeholder, or the lock would silently change the output it froze.
    expect(Object.keys(next.seed_locks!)).toEqual(["2"]);
    expect(Number.isInteger(next.seed_locks!["2"])).toBe(true);
  });

  it("shift-click on a locked frame unlocks it", async () => {
    const w = fw({ seed_locks: { "2": 777 } });
    await w.find('[data-test="loop-frame-3"]').trigger("click", { shiftKey: true });
    expect(lastEmit(w).seed_locks).toEqual({});
  });

  it("the chip-lock value matches what the modal's Lock all would write", async () => {
    const w = fw();
    await w.find('[data-test="loop-frame-2"]').trigger("click", { shiftKey: true });
    const chipValue = lastEmit(w).seed_locks!["1"];
    expect(chipValue).toBe(deriveLoopSeeds(42, 4, "hash_index")[1]);
  });

  it("alt-click bypasses a frame, and again re-enables it", async () => {
    const w = fw();
    await w.find('[data-test="loop-frame-2"]').trigger("click", { altKey: true });
    expect(lastEmit(w).bypass_frames).toEqual([1]);

    const w2 = fw({ bypass_frames: [1] });
    await w2.find('[data-test="loop-frame-2"]').trigger("click", { altKey: true });
    expect(lastEmit(w2).bypass_frames).toEqual([]);
  });

  it("keeps bypassed indices sorted so the config does not churn", async () => {
    const w = fw({ bypass_frames: [3] });
    await w.find('[data-test="loop-frame-2"]').trigger("click", { altKey: true });
    expect(lastEmit(w).bypass_frames).toEqual([1, 3]);
  });

  it("refuses to bypass the last running frame — a loop needs one", async () => {
    const w = fw({ bypass_frames: [0, 1, 2] }, 4);
    await w.find('[data-test="loop-frame-4"]').trigger("click", { altKey: true });
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("still lets the last running frame be re-enabled and locked", async () => {
    const w = fw({ bypass_frames: [0, 1, 2] }, 4);
    await w.find('[data-test="loop-frame-1"]').trigger("click", { altKey: true });
    expect(lastEmit(w).bypass_frames).toEqual([1, 2]);
  });

  // Moving the editor to another frame as a side effect of locking one is the
  // kind of surprise that makes people stop trusting a shortcut.
  it("a modifier click never also moves the edit cursor", async () => {
    const w = fw();
    await w.find('[data-test="loop-frame-3"]').trigger("click", { shiftKey: true });
    expect(currentFrame.value).toBe(null);
    await w.find('[data-test="loop-frame-2"]').trigger("click", { altKey: true });
    expect(currentFrame.value).toBe(null);
  });

  it("a plain click still just selects the frame", async () => {
    const w = fw();
    await w.find('[data-test="loop-frame-3"]').trigger("click");
    expect(currentFrame.value).toBe(2);
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("base takes no modifiers — it has no seed and nothing to bypass", async () => {
    const w = fw();
    await w.find('[data-test="loop-frame-base"]').trigger("click", { shiftKey: true });
    await w.find('[data-test="loop-frame-base"]').trigger("click", { altKey: true });
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("marks locked chips so the state is readable without the modal", () => {
    const w = fw({ seed_locks: { "1": 123 } });
    expect(w.find('[data-test="loop-frame-2"]').classes()).toContain("wp-loop__chip--locked");
    expect(w.find('[data-test="loop-frame-1"]').classes()).not.toContain("wp-loop__chip--locked");
  });

  it("a frame can be both locked and bypassed", () => {
    const w = fw({ seed_locks: { "1": 123 }, bypass_frames: [1] });
    const chip = w.find('[data-test="loop-frame-2"]');
    expect(chip.classes()).toContain("wp-loop__chip--locked");
    expect(chip.classes()).toContain("wp-loop__chip--bypassed");
  });

  it("ignores non-numeric lock keys rather than rendering a NaN state", () => {
    const w = fw({ seed_locks: { junk: 1, "1": 123 } as Record<string, number> });
    expect(w.find('[data-test="loop-frame-2"]').classes()).toContain("wp-loop__chip--locked");
  });

  it("advertises the combos in the widget, not just in tooltips", () => {
    const w = fw();
    expect(w.find('[data-test="loop-chip-modifier-hint"]').text()).toMatch(/shift/i);
    expect(w.find('[data-test="loop-chip-modifier-hint"]').text()).toMatch(/alt|option/i);
  });

  it("the tooltip names the action the next click will take", () => {
    const w = fw({ seed_locks: { "1": 123 }, bypass_frames: [1] });
    const t = w.find('[data-test="loop-frame-2"]').attributes("title")!;
    expect(t).toMatch(/unlock/i);
    expect(t).toMatch(/re-enable/i);
  });
});
