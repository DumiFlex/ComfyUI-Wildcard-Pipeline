import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PickerSection from "../PickerSection.vue";

describe("PickerSection", () => {
  it("renders title with total count", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 2, defaultOpen: true },
      slots: { default: "<div class='row'>row1</div>" },
    });
    expect(wrap.text()).toContain("Wildcards");
    expect(wrap.text()).toContain("5");
    expect(wrap.text()).toContain("2 / 5 selected");
  });

  it("emits toggle-all=true when section checkbox is clicked from empty state", async () => {
    // Section checkbox is the shared Checkbox.vue → <button role="checkbox">.
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 0, defaultOpen: true },
    });
    await wrap.get('button[role="checkbox"]').trigger("click");
    expect(wrap.emitted("toggle-all")?.[0]).toEqual([true]);
  });

  it("emits toggle-all=false when section checkbox is clicked from fully-selected state", async () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 5, defaultOpen: true },
    });
    await wrap.get('button[role="checkbox"]').trigger("click");
    expect(wrap.emitted("toggle-all")?.[0]).toEqual([false]);
  });

  it("collapses when the toggle button is clicked", async () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 0, defaultOpen: true },
      slots: { default: "<div class='row'>x</div>" },
    });
    expect(wrap.find(".row").exists()).toBe(true);
    await wrap.get(".wp-picker-section__toggle").trigger("click");
    expect(wrap.find(".row").exists()).toBe(false);
  });

  it("starts collapsed when defaultOpen is false", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 0, defaultOpen: false },
      slots: { default: "<div class='row'>x</div>" },
    });
    expect(wrap.find(".row").exists()).toBe(false);
    expect(wrap.get(".wp-picker-section__toggle").text()).toBe("▶");
  });

  it("section checkbox is indeterminate when selectedCount is between 0 and totalCount", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 2, defaultOpen: true },
    });
    const check = wrap.get('button[role="checkbox"]');
    expect(check.attributes("aria-checked")).toBe("mixed");
    expect(check.attributes("data-indeterminate")).toBe("true");
  });

  it("section checkbox is fully checked when selectedCount === totalCount", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 5, defaultOpen: true },
    });
    const check = wrap.get('button[role="checkbox"]');
    expect(check.attributes("aria-checked")).toBe("true");
    expect(check.attributes("data-checked")).toBe("true");
  });

  it("section checkbox is unchecked when selectedCount is zero", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 0, defaultOpen: true },
    });
    const check = wrap.get('button[role="checkbox"]');
    expect(check.attributes("aria-checked")).toBe("false");
    expect(check.attributes("data-indeterminate")).toBe("false");
  });

  it("renders default-slot content inside the section body", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 1, selectedCount: 0 },
      slots: { default: '<div class="custom-child">child content</div>' },
    });
    expect(wrap.find(".wp-picker-section__body .custom-child").exists()).toBe(true);
    expect(wrap.text()).toContain("child content");
  });

  // ---------- Phase 1: optional kind icon in header ----------

  it("renders a wildcard icon in the header when kind=wildcard", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 1, selectedCount: 0, kind: "wildcard" },
    });
    const icon = wrap.find('[data-test="picker-section-icon"]');
    expect(icon.exists()).toBe(true);
    // wp-row-type-icon--wildcard tint + canonical pi-sparkles glyph.
    expect(icon.attributes("class") ?? "").toContain("wp-row-type-icon--wildcard");
    expect(icon.find("i").attributes("class") ?? "").toMatch(/\bpi-sparkles\b/);
  });

  it("renders a folder icon in the header when kind=category (overrides default kindIcon)", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Categories", totalCount: 1, selectedCount: 0, kind: "category" },
    });
    const icon = wrap.find('[data-test="picker-section-icon"]');
    expect(icon.exists()).toBe(true);
    expect(icon.find("i").attributes("class") ?? "").toMatch(/\bpi-folder\b/);
  });

  it("renders no header icon when kind is absent", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 1, selectedCount: 0 },
    });
    expect(wrap.find('[data-test="picker-section-icon"]').exists()).toBe(false);
  });
});
