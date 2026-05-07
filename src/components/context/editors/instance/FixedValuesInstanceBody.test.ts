import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FixedValuesInstanceBody from "./FixedValuesInstanceBody.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

const baseModule: ModuleEntry = {
  id: "fv001234",
  type: "fixed_values",
  enabled: true,
  meta: { name: "color_palette" },
  entries: [],
  payload: {
    values: [
      { id: "v1", name: "primary", value: "red" },
      { id: "v2", name: "secondary", value: "blue" },
    ],
  },
  instance: {},
};

describe("FixedValuesInstanceBody", () => {
  it("renders the ValuesOverrideSection", () => {
    const wrapper = mount(FixedValuesInstanceBody, { props: { module: baseModule } });
    expect(wrapper.find('[data-test="vo-override-btn"]').exists()).toBe(true);
  });

  it("forwards section update events as patchInstance into emit('update', ...)", async () => {
    const wrapper = mount(FixedValuesInstanceBody, { props: { module: baseModule } });
    const section = wrapper.findComponent({ name: "ValuesOverrideSection" });
    const next = [{ id: "v1", name: "primary", value: "crimson" }];
    section.vm.$emit("update:modelValue", next);
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    expect(updates).toBeTruthy();
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.values_overrides).toEqual(next);
  });

  it("forwards null update (override cleared) as patch with values_overrides = null", async () => {
    const m: ModuleEntry = {
      ...baseModule,
      instance: { values_overrides: [{ id: "v1", name: "primary", value: "x" }] },
    };
    const wrapper = mount(FixedValuesInstanceBody, { props: { module: m } });
    const section = wrapper.findComponent({ name: "ValuesOverrideSection" });
    section.vm.$emit("update:modelValue", null);
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.values_overrides).toBeNull();
  });

  it("forwards section reset event as patch with null", async () => {
    const m: ModuleEntry = {
      ...baseModule,
      instance: { values_overrides: [{ id: "v1", name: "primary", value: "x" }] },
    };
    const wrapper = mount(FixedValuesInstanceBody, { props: { module: m } });
    const section = wrapper.findComponent({ name: "ValuesOverrideSection" });
    section.vm.$emit("reset");
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.values_overrides).toBeNull();
  });
});
