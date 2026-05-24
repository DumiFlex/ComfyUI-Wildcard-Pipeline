import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import SubcategoryFilterPicker from "./SubcategoryFilterPicker.vue";

describe("SubcategoryFilterPicker", () => {
  function mountIt(props: Partial<{
    subCategories: string[];
    initialSelection: string[];
    mode: "insert" | "edit";
    hasNullOption: boolean;
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

  describe("null option support (inverted semantic 2026-05-25)", () => {
    // Reserved `"null"` keyword in the filter list EXCLUDES the
    // wildcard's null option. Default (no keyword) keeps null in the
    // pool alongside the listed sub-cats. Checkbox is "Exclude null".

    it("renders 'Exclude null' checkbox when hasNullOption is true", () => {
      const wrap = mountIt({ subCategories: ["warm"], hasNullOption: true });
      expect(wrap.find('[data-test="subcat-exclude-null"]').exists()).toBe(true);
      expect(wrap.text()).toMatch(/Exclude null/);
    });

    it("omits 'Exclude null' checkbox when hasNullOption is false", () => {
      const wrap = mountIt({ subCategories: ["warm"], hasNullOption: false });
      expect(wrap.find('[data-test="subcat-exclude-null"]').exists()).toBe(false);
    });

    it("emits 'null' in the applied list when checkbox is ticked (exclude null)", async () => {
      const wrap = mountIt({ subCategories: ["warm"], hasNullOption: true });
      const cb = wrap.find<HTMLInputElement>('[data-test="subcat-exclude-null"] input');
      cb.element.checked = true;
      await cb.trigger("change");
      await wrap.find('[data-test="picker-apply"]').trigger("click");
      const ev = wrap.emitted("apply") ?? [];
      expect(ev[ev.length - 1][0]).toEqual(["null"]);
    });

    it("omits the keyword when the checkbox stays unchecked (default: include null)", async () => {
      const wrap = mountIt({
        subCategories: ["warm", "cool"],
        hasNullOption: true,
        initialSelection: ["warm"],
      });
      await wrap.find('[data-test="picker-apply"]').trigger("click");
      const ev = wrap.emitted("apply") ?? [];
      expect(ev[ev.length - 1][0]).toEqual(["warm"]);
    });

    it("checkbox starts ticked when initialSelection contains 'null'", () => {
      const wrap = mountIt({
        subCategories: ["warm"],
        hasNullOption: true,
        initialSelection: ["warm", "null"],
      });
      const cb = wrap.find<HTMLInputElement>('[data-test="subcat-exclude-null"] input');
      expect(cb.element.checked).toBe(true);
    });

    it("applied list combines selected sub-cats with the null exclude keyword", async () => {
      const wrap = mountIt({
        subCategories: ["warm", "cool"],
        hasNullOption: true,
        initialSelection: ["warm"],
      });
      const cb = wrap.find<HTMLInputElement>('[data-test="subcat-exclude-null"] input');
      cb.element.checked = true;
      await cb.trigger("change");
      await wrap.find('[data-test="picker-apply"]').trigger("click");
      const ev = wrap.emitted("apply") ?? [];
      expect(ev[ev.length - 1][0]).toEqual(["warm", "null"]);
    });
  });
});
