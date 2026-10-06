import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ModelInfoWidget from "./ModelInfoWidget.vue";
import { defaultModelInfoConfig, type ModelInfoConfig } from "../../extension/model-info";

const PONY = "SDXL/ponyDiffusionV6XL.safetensors";

function mk(props: Record<string, unknown> = {}) {
  return mount(ModelInfoWidget, {
    props: { modelValue: defaultModelInfoConfig(), modelWired: true, ...props },
  });
}
function lastEmit(w: ReturnType<typeof mk>): ModelInfoConfig {
  const all = w.emitted("update:modelValue") ?? [];
  return all[all.length - 1]?.[0] as ModelInfoConfig;
}

describe("ModelInfoWidget", () => {
  it("shows the detected name and variant, and lights the matching rule", () => {
    const w = mk({ loaderName: PONY });
    expect(w.find('[data-test="mi-value-name"]').text()).toBe("ponyDiffusionV6XL");
    expect(w.find('[data-test="mi-value-variant"]').text()).toBe("pony");
    expect(w.find('[data-test="mi-var-variant"]').text()).toContain("rule 2");
    expect(w.find('[data-test="mi-rule-1"]').classes()).toContain("is-match");
    expect(w.find('[data-test="mi-rule-0"]').classes()).not.toContain("is-match");
  });

  it("family waits for a run, then shows the last run's value", async () => {
    const w = mk({ loaderName: PONY });
    expect(w.find('[data-test="mi-value-family"]').text()).toBe("after a run");
    await w.setProps({ lastRun: { family: "sdxl", variant: "pony", name: "x", sources: {} } });
    expect(w.find('[data-test="mi-value-family"]').text()).toBe("sdxl");
    expect(w.find('[data-test="mi-var-family"]').text()).toContain("from model");
  });

  it("asks for a model when nothing is wired", () => {
    const w = mk({ modelWired: false });
    expect(w.find('[data-test="mi-value-family"]').text()).toBe("wire a model");
    expect(w.find('[data-test="mi-value-name"]').text()).toBe("wire a model");
  });

  it("pinning keeps the shown value; unpinning clears it", async () => {
    const w = mk({ loaderName: PONY });
    await w.find('[data-test="mi-pin-variant"]').trigger("click");
    expect(lastEmit(w).variant).toBe("pony");
    await w.setProps({ modelValue: { ...defaultModelInfoConfig(), variant: "pony" } });
    expect(w.find('[data-test="mi-pin-input-variant"]').exists()).toBe(true);
    await w.find('[data-test="mi-pin-variant"]').trigger("click");
    expect(lastEmit(w).variant).toBe("");
  });

  it("a pinned name drives the rules", () => {
    const w = mk({ modelValue: { ...defaultModelInfoConfig(), name: "waiIllustrious.safetensors" } });
    expect(w.find('[data-test="mi-value-variant"]').text()).toBe("illustrious");
    expect(w.find('[data-test="mi-rule-2"]').classes()).toContain("is-match");
  });

  it("edits, adds, removes and resets rules", async () => {
    const w = mk({ loaderName: PONY });
    const pattern = w.find('[data-test="mi-rule-1"] .wp-mi__rule-pattern');
    await pattern.setValue("pdxl");
    expect(lastEmit(w).rules[1]).toEqual({ variant: "pony", pattern: "pdxl" });

    await w.find('[data-test="mi-add-rule"]').trigger("click");
    expect(lastEmit(w).rules).toHaveLength(5);

    await w.find('[data-test="mi-rule-remove-0"]').trigger("click");
    expect(lastEmit(w).rules.map((r) => r.variant)).toEqual(["pony", "illustrious", "animagine"]);

    expect(w.find('[data-test="mi-reset-rules"]').exists()).toBe(false);
    await w.setProps({ modelValue: { ...defaultModelInfoConfig(), rules: [] } });
    await w.find('[data-test="mi-reset-rules"]').trigger("click");
    expect(lastEmit(w).rules).toEqual(defaultModelInfoConfig().rules);
  });

  it("outlines a broken rule", () => {
    const w = mk({
      modelValue: { ...defaultModelInfoConfig(), rules: [{ variant: "bad", pattern: "(" }] },
    });
    expect(w.find('[data-test="mi-rule-0"]').classes()).toContain("is-problem");
  });
});
