import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ContextLoopWidget from "./ContextLoopWidget.vue";
import { emptyContextLoopConfig } from "./types";

describe("ContextLoopWidget", () => {
  it("renders defaults — hash chip active, both switches off", () => {
    const w = mount(ContextLoopWidget, { props: { modelValue: emptyContextLoopConfig() } });
    expect(w.find('[data-test="loop-strategy-hash_index"]').classes()).toContain("wp-loop__chip--active");
    expect(w.find('[data-test="loop-strategy-sequential"]').classes()).not.toContain("wp-loop__chip--active");
    expect(w.find('[data-test="loop-override-toggle"]').classes()).not.toContain("wp-loop__switch--on");
    expect(w.find('[data-test="loop-bypass-toggle"]').classes()).not.toContain("wp-loop__switch--on");
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
});
