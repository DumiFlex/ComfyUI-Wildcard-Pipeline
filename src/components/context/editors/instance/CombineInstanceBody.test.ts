import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CombineInstanceBody from "./CombineInstanceBody.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

const baseModule: ModuleEntry = {
  id: "cb007abc",
  type: "combine",
  enabled: true,
  meta: { name: "shirt_combo" },
  entries: [],
  payload: {},
  instance: {},
};

describe("CombineInstanceBody", () => {
  it("renders the InternalFlagSection", () => {
    const wrapper = mount(CombineInstanceBody, { props: { module: baseModule } });
    expect(wrapper.find('[data-test="if-toggle"]').exists()).toBe(true);
  });

  it("forwards section update events as patchInstance into emit('update', ...)", async () => {
    const wrapper = mount(CombineInstanceBody, { props: { module: baseModule } });
    const section = wrapper.findComponent({ name: "InternalFlagSection" });
    section.vm.$emit("update:modelValue", true);
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    expect(updates).toBeTruthy();
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.internal).toBe(true);
  });

  it("forwards section reset event as patch with null", async () => {
    const m: ModuleEntry = { ...baseModule, instance: { internal: true } };
    const wrapper = mount(CombineInstanceBody, { props: { module: m } });
    const section = wrapper.findComponent({ name: "InternalFlagSection" });
    section.vm.$emit("reset");
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.internal).toBeNull();
  });
});
