import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DisabledMatrixCellsSection from "./DisabledMatrixCellsSection.vue";
import { encodeKey } from "../keys";

const sourceSubs = ["s1", "s2"];
const targetSubs = ["t1", "t2", "t3"];
const matrix: Record<string, Record<string, boolean>> = {
  s1: { t1: true, t2: true, t3: false },
  s2: { t1: true, t2: false, t3: true },
};

function mountSection(modelValue: string[] | null) {
  return mount(DisabledMatrixCellsSection, {
    props: { matrix, sourceSubs, targetSubs, modelValue },
  });
}

describe("DisabledMatrixCellsSection", () => {
  it("renders an N x M grid of source x target cells when modelValue is null", () => {
    const wrapper = mountSection(null);
    const cells = wrapper.findAll('[data-test^="dm-cell-"]');
    expect(cells.length).toBe(sourceSubs.length * targetSubs.length);
    expect(wrapper.find('[data-test="dm-reset"]').exists()).toBe(false);
  });

  it("clicking an active cell when null builds fresh array of one disabled key", async () => {
    const wrapper = mountSection(null);
    const cell = wrapper.find('[data-test="dm-cell-s1-t1"]');
    await cell.trigger("click");
    const next = wrapper.emitted("update:modelValue")?.[0]?.[0] as string[] | null;
    expect(next).toEqual([encodeKey(["s1", "t1"])]);
  });

  it("disabled cells render with a strikethrough class", () => {
    const k = encodeKey(["s1", "t2"]);
    const wrapper = mountSection([k]);
    const cell = wrapper.find('[data-test="dm-cell-s1-t2"]');
    expect(cell.classes()).toContain("is-disabled");
    const otherCell = wrapper.find('[data-test="dm-cell-s2-t1"]');
    expect(otherCell.classes()).not.toContain("is-disabled");
  });

  it("clicking a disabled cell removes it from the override list", async () => {
    const k = encodeKey(["s1", "t2"]);
    const wrapper = mountSection([k]);
    const cell = wrapper.find('[data-test="dm-cell-s1-t2"]');
    await cell.trigger("click");
    const next = wrapper.emitted("update:modelValue")?.[0]?.[0] as string[] | null;
    expect(next).toBeNull();
  });

  it("clicking adds an additional cell key when override list non-empty", async () => {
    const k1 = encodeKey(["s1", "t1"]);
    const wrapper = mountSection([k1]);
    const cell = wrapper.find('[data-test="dm-cell-s2-t3"]');
    await cell.trigger("click");
    const next = wrapper.emitted("update:modelValue")?.[0]?.[0] as string[] | null;
    expect(next).toContain(k1);
    expect(next).toContain(encodeKey(["s2", "t3"]));
    expect(next).toHaveLength(2);
  });

  it("renders cells absent from matrix as empty / non-clickable", async () => {
    const wrapper = mountSection(null);
    const inactive = wrapper.find('[data-test="dm-cell-s1-t3"]');
    expect(inactive.classes()).toContain("is-empty");
  });

  it("emits reset event on reset-button click", async () => {
    const wrapper = mountSection([encodeKey(["s1", "t1"])]);
    await wrapper.find('[data-test="dm-reset"]').trigger("click");
    expect(wrapper.emitted("reset")?.length).toBe(1);
  });
});
