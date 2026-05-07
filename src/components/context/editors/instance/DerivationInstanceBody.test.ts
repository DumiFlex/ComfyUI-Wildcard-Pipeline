import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DerivationInstanceBody from "./DerivationInstanceBody.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

const baseModule: ModuleEntry = {
  id: "drv01234",
  type: "derivation",
  enabled: true,
  meta: { name: "color_to_hue" },
  entries: [],
  payload: {
    rules: [
      { id: "r1", source_value: "red", target_value: "warm" },
      { id: "r2", source_value: "blue", target_value: "cool" },
    ],
  },
  instance: {},
};

describe("DerivationInstanceBody", () => {
  it("renders the DisabledRulesSection with library rules from payload", () => {
    const wrapper = mount(DerivationInstanceBody, { props: { module: baseModule } });
    expect(wrapper.find('[data-test="dr-cb-r1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dr-cb-r2"]').exists()).toBe(true);
  });

  it("forwards section update events as patchInstance into emit('update', ...)", async () => {
    const wrapper = mount(DerivationInstanceBody, { props: { module: baseModule } });
    const section = wrapper.findComponent({ name: "DisabledRulesSection" });
    section.vm.$emit("update:modelValue", ["r1"]);
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    expect(updates).toBeTruthy();
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.disabled_rule_ids).toEqual(["r1"]);
  });

  it("forwards section reset event as patch with null", async () => {
    const m: ModuleEntry = { ...baseModule, instance: { disabled_rule_ids: ["r1"] } };
    const wrapper = mount(DerivationInstanceBody, { props: { module: m } });
    const section = wrapper.findComponent({ name: "DisabledRulesSection" });
    section.vm.$emit("reset");
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.disabled_rule_ids).toBeNull();
  });

  it("handles missing payload.rules by passing empty array", () => {
    const m: ModuleEntry = { ...baseModule, payload: {} };
    const wrapper = mount(DerivationInstanceBody, { props: { module: m } });
    // No rules → no checkbox rows.
    expect(wrapper.find('[data-test^="dr-cb-"]').exists()).toBe(false);
  });
});
