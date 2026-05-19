import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import SubcategoryFilterPicker from "./SubcategoryFilterPicker.vue";

describe("SubcategoryFilterPicker", () => {
  function mountIt(props: Partial<{
    subCategories: string[];
    initialSelection: string[];
    mode: "insert" | "edit";
  }> = {}) {
    return mount(SubcategoryFilterPicker, {
      props: {
        subCategories: ["warm", "cool", "earth"],
        initialSelection: [],
        mode: "insert",
        ...props,
      },
    });
  }

  it("renders one chip per sub-category", () => {
    const wrap = mountIt();
    const chips = wrap.findAll('[data-test="subcat-chip"]');
    expect(chips.length).toBe(3);
    expect(chips[0].text()).toBe("warm");
  });

  it("preselects chips from initialSelection", () => {
    const wrap = mountIt({ initialSelection: ["warm"] });
    const warmChip = wrap.find('[data-test="subcat-chip"][data-value="warm"]');
    expect(warmChip.classes()).toContain("wp-subcat-chip--selected");
  });

  it("toggles a chip on click", async () => {
    const wrap = mountIt();
    const warmChip = wrap.find('[data-test="subcat-chip"][data-value="warm"]');
    expect(warmChip.classes()).not.toContain("wp-subcat-chip--selected");
    await warmChip.trigger("click");
    expect(warmChip.classes()).toContain("wp-subcat-chip--selected");
  });

  it("emits apply with selected subcats", async () => {
    const wrap = mountIt({ initialSelection: ["warm", "earth"] });
    await wrap.find('[data-test="picker-apply"]').trigger("click");
    expect(wrap.emitted("apply")?.[0]).toEqual([["warm", "earth"]]);
  });

  it("apply with no selection emits empty list (equivalent to no filter)", async () => {
    const wrap = mountIt();
    await wrap.find('[data-test="picker-apply"]').trigger("click");
    expect(wrap.emitted("apply")?.[0]).toEqual([[]]);
  });

  it("emits skip on skip button click", async () => {
    const wrap = mountIt();
    await wrap.find('[data-test="picker-skip"]').trigger("click");
    expect(wrap.emitted("skip")).toBeTruthy();
  });

  it("delete button only renders in edit mode", () => {
    const insert = mountIt({ mode: "insert" });
    expect(insert.find('[data-test="picker-delete"]').exists()).toBe(false);
    const edit = mountIt({ mode: "edit" });
    expect(edit.find('[data-test="picker-delete"]').exists()).toBe(true);
  });

  it("delete emits delete event in edit mode", async () => {
    const wrap = mountIt({ mode: "edit" });
    await wrap.find('[data-test="picker-delete"]').trigger("click");
    expect(wrap.emitted("delete")).toBeTruthy();
  });

  it("renders hint when wildcard has no sub-categories", () => {
    const wrap = mountIt({ subCategories: [] });
    expect(wrap.text()).toMatch(/no sub-categories/i);
  });
});
