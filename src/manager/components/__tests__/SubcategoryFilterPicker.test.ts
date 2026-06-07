import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import SubcategoryFilterPicker from "../SubcategoryFilterPicker.vue";

const props = {
  subCategories: ["warm", "cold"], tagGroups: { temp: ["warm", "cold"] },
  optionTagSets: [["warm"], ["cold"]], initialExpr: "warm or cold",
  initialExcludeNull: false, mode: "edit" as const, hasNullOption: true,
};

describe("SubcategoryFilterPicker", () => {
  it("emits apply with the typed expression + exclude_null", async () => {
    const w = mount(SubcategoryFilterPicker, { props });
    await w.get('[data-test="expr-input"]').setValue("warm");
    await w.get('[data-test="picker-apply"]').trigger("click");
    expect(w.emitted("apply")![0]).toEqual([{ expr: "warm", excludeNull: false }]);
  });
  it("blocks Apply on an invalid expression", async () => {
    const w = mount(SubcategoryFilterPicker, { props });
    await w.get('[data-test="expr-input"]').setValue("warm or");
    expect(w.get('[data-test="picker-apply"]').attributes("disabled")).toBeDefined();
    expect(w.text()).toMatch(/incomplete|operator|term/i);
  });
  it("shows reads-as + match count", async () => {
    const w = mount(SubcategoryFilterPicker, { props });
    await w.get('[data-test="expr-input"]').setValue("warm or cold");
    expect(w.get('[data-test="reads-as"]').text()).toContain("warm or cold");
    expect(w.get('[data-test="match-count"]').text()).toMatch(/2 of 2/);
  });
});

describe("SubcategoryFilterPicker — interaction details", () => {
  type PickerProps = Omit<typeof props, "mode"> & { mode: "insert" | "edit" };
  function mountIt(over: Partial<PickerProps> = {}) {
    const merged: PickerProps = { ...props, ...over };
    return mount(SubcategoryFilterPicker, { props: merged });
  }

  it("seeds the expression input from initialExpr", () => {
    const w = mountIt({ initialExpr: "cold" });
    expect(w.get<HTMLInputElement>('[data-test="expr-input"]').element.value).toBe("cold");
  });

  it("an empty expression is valid (no filter) and Apply is enabled", async () => {
    const w = mountIt({ initialExpr: "" });
    await w.get('[data-test="expr-input"]').setValue("");
    expect(w.get('[data-test="picker-apply"]').attributes("disabled")).toBeUndefined();
    await w.get('[data-test="picker-apply"]').trigger("click");
    expect(w.emitted("apply")![0]).toEqual([{ expr: "", excludeNull: false }]);
  });

  it("flags an unknown sub-category term", async () => {
    const w = mountIt();
    await w.get('[data-test="expr-input"]').setValue("warm or pink");
    expect(w.text()).toMatch(/unknown sub-category/i);
    expect(w.get('[data-test="picker-apply"]').attributes("disabled")).toBeDefined();
  });

  it("inserting a sub-category chip appends it to the expression", async () => {
    const w = mountIt({ initialExpr: "warm" });
    const coldChip = w.get('[data-test="subcat-chip"][data-value="cold"]');
    await coldChip.trigger("click");
    expect(w.get<HTMLInputElement>('[data-test="expr-input"]').element.value).toContain("cold");
  });

  it("inserting an operator appends it to the expression", async () => {
    const w = mountIt({ initialExpr: "warm" });
    const orOp = w.get('[data-test="subcat-op"][data-value="or"]');
    await orOp.trigger("click");
    expect(w.get<HTMLInputElement>('[data-test="expr-input"]').element.value).toMatch(/warm\s+or/);
  });

  it("round-trips the exclude-null flag in the applied filter", async () => {
    const w = mountIt({ initialExpr: "warm", hasNullOption: true });
    const cb = w.get<HTMLInputElement>('[data-test="subcat-exclude-null"] input');
    cb.element.checked = true;
    await cb.trigger("change");
    await w.get('[data-test="picker-apply"]').trigger("click");
    const ev = w.emitted("apply")!;
    expect(ev[ev.length - 1]).toEqual([{ expr: "warm", excludeNull: true }]);
  });

  it("seeds the exclude-null checkbox from initialExcludeNull", () => {
    const w = mountIt({ hasNullOption: true, initialExcludeNull: true });
    const cb = w.get<HTMLInputElement>('[data-test="subcat-exclude-null"] input');
    expect(cb.element.checked).toBe(true);
  });

  it("omits the exclude-null row when hasNullOption is false", () => {
    const w = mountIt({ hasNullOption: false });
    expect(w.find('[data-test="subcat-exclude-null"]').exists()).toBe(false);
  });

  it("delete button only renders in edit mode", () => {
    expect(mountIt({ mode: "insert" }).find('[data-test="picker-delete"]').exists()).toBe(false);
    expect(mountIt({ mode: "edit" }).find('[data-test="picker-delete"]').exists()).toBe(true);
  });

  it("emits skip / delete on their buttons", async () => {
    const w = mountIt({ mode: "edit" });
    await w.get('[data-test="picker-skip"]').trigger("click");
    expect(w.emitted("skip")).toBeTruthy();
    await w.get('[data-test="picker-delete"]').trigger("click");
    expect(w.emitted("delete")).toBeTruthy();
  });

  it("match count reflects the typed expression (1 of 2)", async () => {
    const w = mountIt();
    await w.get('[data-test="expr-input"]').setValue("warm");
    expect(w.get('[data-test="match-count"]').text()).toMatch(/1 of 2/);
  });
});
