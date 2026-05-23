import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PickerSection from "../PickerSection.vue";

describe("PickerSection", () => {
  it("renders title and count as separate nodes (no parens)", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 2, defaultOpen: true },
      slots: { default: "<div class='row'>row1</div>" },
    });
    const title = wrap.get(".wp-picker-section__title");
    expect(title.text()).toBe("Wildcards");
    // No "(5)" trailing text — the count is its own muted sibling.
    expect(title.text()).not.toContain("(");
    const count = wrap.get(".wp-picker-section__count");
    expect(count.text()).toBe("5 items");
  });

  it("renders the selection pill with N / M format", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 2, defaultOpen: true },
    });
    const pill = wrap.get(".wp-picker-section__sel-pill");
    expect(pill.text()).toBe("2 / 5");
    // Non-zero selection → not the empty state.
    expect(pill.attributes("data-empty")).toBe("false");
  });

  it("sets data-empty=true on the selection pill when selectedCount is zero", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 0, defaultOpen: true },
    });
    const pill = wrap.get(".wp-picker-section__sel-pill");
    expect(pill.text()).toBe("0 / 5");
    expect(pill.attributes("data-empty")).toBe("true");
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

  it("clicking the section checkbox does NOT collapse the section", async () => {
    // Phase-4: header is a click target, but clicks INSIDE the checkbox
    // must be filtered out so toggling selection doesn't also flip open.
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 0, defaultOpen: true },
      slots: { default: "<div class='row'>x</div>" },
    });
    expect(wrap.find(".row").exists()).toBe(true);
    await wrap.get('button[role="checkbox"]').trigger("click");
    expect(wrap.find(".row").exists()).toBe(true);
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

  it("collapses when the header is clicked anywhere outside the checkbox", async () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 0, defaultOpen: true },
      slots: { default: "<div class='row'>x</div>" },
    });
    expect(wrap.find(".row").exists()).toBe(true);
    // Click the title — should collapse via the header click handler.
    await wrap.get(".wp-picker-section__title").trigger("click");
    expect(wrap.find(".row").exists()).toBe(false);
  });

  it("starts collapsed when defaultOpen is false", () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 0, defaultOpen: false },
      slots: { default: "<div class='row'>x</div>" },
    });
    expect(wrap.find(".row").exists()).toBe(false);
    // Chevron is the pi-angle-right icon — CSS rotates it 90deg when
    // the section root carries data-open="true". Collapsed → data-open
    // is "false" so rotation is absent.
    const section = wrap.get(".wp-picker-section");
    expect(section.attributes("data-open")).toBe("false");
    const chevron = wrap.get(".wp-picker-section__chevron-icon");
    expect(chevron.attributes("class") ?? "").toMatch(/\bpi-angle-right\b/);
  });

  it("section root carries data-open attribute driving chevron rotation", async () => {
    const wrap = mount(PickerSection, {
      props: { title: "Wildcards", totalCount: 5, selectedCount: 0, defaultOpen: true },
      slots: { default: "<div class='row'>x</div>" },
    });
    const section = wrap.get(".wp-picker-section");
    expect(section.attributes("data-open")).toBe("true");
    // Toggle button uses the chevron icon, NOT a literal ▼ / ▶ glyph.
    const toggle = wrap.get(".wp-picker-section__toggle");
    expect(toggle.text()).toBe("");
    expect(toggle.find("i.pi.pi-angle-right").exists()).toBe(true);
    // Collapse and re-check the data-open flips to "false".
    await toggle.trigger("click");
    expect(wrap.get(".wp-picker-section").attributes("data-open")).toBe("false");
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
