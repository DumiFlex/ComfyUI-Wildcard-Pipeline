import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ContextLoopWidget from "./ContextLoopWidget.vue";
import SeedListModal from "../shared/SeedListModal.vue";
import { emptyContextLoopConfig } from "./types";

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
});
