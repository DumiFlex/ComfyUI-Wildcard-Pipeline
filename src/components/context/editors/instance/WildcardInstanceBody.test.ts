import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import WildcardInstanceBody from "./WildcardInstanceBody.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

const baseModule: ModuleEntry = {
  id: "ab12cd34", type: "wildcard", enabled: true,
  meta: { name: "outfit" }, entries: [],
  payload: {
    options: [{ id: "o1", value: "red", weight: 1 }, { id: "o2", value: "blue", weight: 1 }],
    sub_categories: ["color"],
    var_binding: "outfit",
  },
  instance: {},
};

describe("WildcardInstanceBody", () => {
  it("renders all 7 expected sections", () => {
    const wrapper = mount(WildcardInstanceBody, { props: { module: baseModule } });
    expect(wrapper.find('[data-test="vb-input"]').exists()).toBe(true);          // VariableBinding
    expect(wrapper.find('[data-test="rm-random"]').exists()).toBe(true);          // ResolveMode
    expect(wrapper.find('[data-test="eo-cb-o1"]').exists()).toBe(true);            // EnabledOptions
    expect(wrapper.find('[data-test="ow-input-o1"]').exists()).toBe(true);         // OptionWeights
    expect(wrapper.find('[data-test="cf-chip-color"]').exists()).toBe(true);       // CategoryFilter
    expect(wrapper.find('[data-test="lk-toggle"]').exists()).toBe(true);           // Lock
    expect(wrapper.find('[data-test="if-toggle"]').exists()).toBe(true);           // InternalFlag
  });

  it("forwards section update events as patchInstance into emit('update', ...)", async () => {
    const wrapper = mount(WildcardInstanceBody, { props: { module: baseModule } });
    const vb = wrapper.findComponent({ name: "VariableBindingSection" });
    vb.vm.$emit("update:modelValue", "new_var");
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    expect(updates).toBeTruthy();
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.variable_binding).toBe("new_var");
  });

  it("section reset emits patch with null for that field", async () => {
    const m: ModuleEntry = { ...baseModule, instance: { variable_binding: "x" } };
    const wrapper = mount(WildcardInstanceBody, { props: { module: m } });
    const vb = wrapper.findComponent({ name: "VariableBindingSection" });
    vb.vm.$emit("reset");
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.variable_binding).toBeNull();
  });
});
