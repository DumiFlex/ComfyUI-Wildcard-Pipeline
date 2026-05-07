import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConstraintInstanceBody from "./ConstraintInstanceBody.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

const sourceWildcard: ModuleEntry = {
  id: "wcsrc001",
  type: "wildcard",
  enabled: true,
  meta: { name: "color" },
  entries: [],
  payload: {
    options: [{ id: "o1", value: "red", weight: 1, sub_category: "warm" }],
    sub_categories: ["warm", "cool"],
    var_binding: "color",
  },
};

const targetWildcard: ModuleEntry = {
  id: "wctgt001",
  type: "wildcard",
  enabled: true,
  meta: { name: "outfit" },
  entries: [],
  payload: {
    options: [{ id: "p1", value: "scarf", weight: 1, sub_category: "winter" }],
    sub_categories: ["winter", "summer"],
    var_binding: "outfit",
  },
};

const baseConstraint: ModuleEntry = {
  id: "cn001234",
  type: "constraint",
  enabled: true,
  meta: { name: "color_outfit_pairing" },
  entries: [],
  payload: {
    source_wildcard_id: "wcsrc001",
    target_wildcard_id: "wctgt001",
    matrix: {
      warm: { winter: { mode: "allow", factor: 1 }, summer: { mode: "allow", factor: 1 } },
      cool: { winter: { mode: "allow", factor: 1 }, summer: { mode: "allow", factor: 1 } },
    },
    exceptions: [
      { source_value: "red", target_value: "scarf", mode: "boost", factor: 2 },
      { source_value: "red", target_value: "tee", mode: "exclude", factor: 0 },
    ],
  },
  instance: {},
};

describe("ConstraintInstanceBody", () => {
  it("renders the DisabledExceptionsSection rows", () => {
    const wrapper = mount(ConstraintInstanceBody, {
      props: { module: baseConstraint, siblingModules: [sourceWildcard, targetWildcard] },
    });
    expect(wrapper.find('[data-test="de-cb-0"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="de-cb-1"]').exists()).toBe(true);
  });

  it("renders the DisabledMatrixCellsSection cells from sibling sub-categories", () => {
    const wrapper = mount(ConstraintInstanceBody, {
      props: { module: baseConstraint, siblingModules: [sourceWildcard, targetWildcard] },
    });
    expect(wrapper.find('[data-test="dm-cell-warm-winter"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dm-cell-cool-summer"]').exists()).toBe(true);
  });

  it("forwards exceptions update events as patchInstance", async () => {
    const wrapper = mount(ConstraintInstanceBody, {
      props: { module: baseConstraint, siblingModules: [sourceWildcard, targetWildcard] },
    });
    const section = wrapper.findComponent({ name: "DisabledExceptionsSection" });
    section.vm.$emit("update:modelValue", ["[\"red\",\"scarf\"]"]);
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    expect(updates).toBeTruthy();
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.disabled_exception_keys).toEqual(["[\"red\",\"scarf\"]"]);
  });

  it("forwards matrix-cell update events as patchInstance", async () => {
    const wrapper = mount(ConstraintInstanceBody, {
      props: { module: baseConstraint, siblingModules: [sourceWildcard, targetWildcard] },
    });
    const section = wrapper.findComponent({ name: "DisabledMatrixCellsSection" });
    section.vm.$emit("update:modelValue", ["[\"warm\",\"winter\"]"]);
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    expect(updates).toBeTruthy();
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.disabled_matrix_cells).toEqual(["[\"warm\",\"winter\"]"]);
  });

  it("forwards exceptions reset event as null patch", async () => {
    const m: ModuleEntry = {
      ...baseConstraint,
      instance: { disabled_exception_keys: ["[\"red\",\"scarf\"]"] },
    };
    const wrapper = mount(ConstraintInstanceBody, {
      props: { module: m, siblingModules: [sourceWildcard, targetWildcard] },
    });
    const section = wrapper.findComponent({ name: "DisabledExceptionsSection" });
    section.vm.$emit("reset");
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.disabled_exception_keys).toBeNull();
  });

  it("forwards matrix-cell reset event as null patch", async () => {
    const m: ModuleEntry = {
      ...baseConstraint,
      instance: { disabled_matrix_cells: ["[\"warm\",\"winter\"]"] },
    };
    const wrapper = mount(ConstraintInstanceBody, {
      props: { module: m, siblingModules: [sourceWildcard, targetWildcard] },
    });
    const section = wrapper.findComponent({ name: "DisabledMatrixCellsSection" });
    section.vm.$emit("reset");
    await wrapper.vm.$nextTick();
    const updates = wrapper.emitted("update");
    const lastPatch = updates![updates!.length - 1][0] as Partial<ModuleEntry>;
    expect(lastPatch.instance?.disabled_matrix_cells).toBeNull();
  });

  it("falls back to empty sub-category arrays when sibling lookup misses", () => {
    const wrapper = mount(ConstraintInstanceBody, {
      props: { module: baseConstraint, siblingModules: [] },
    });
    // Without siblings, no matrix cells render.
    expect(wrapper.find('[data-test^="dm-cell-"]').exists()).toBe(false);
  });
});
