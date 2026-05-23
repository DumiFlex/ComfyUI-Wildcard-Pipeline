import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PickerRow from "../PickerRow.vue";

describe("PickerRow", () => {
  it("renders entity name", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "$person", checked: false, badges: [], depWarnings: [] },
    });
    expect(wrap.text()).toContain("$person");
  });

  it("emits update:checked when the inner checkbox is clicked", async () => {
    // The shared Checkbox.vue renders a <button role="checkbox">, not a
    // native <input>. Click the button directly so the test mirrors how
    // the row actually surfaces toggle events to its parent.
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false, badges: [], depWarnings: [] },
    });
    await wrap.get('button[role="checkbox"]').trigger("click");
    expect(wrap.emitted("update:checked")?.[0]).toEqual([true]);
  });

  it("renders info, warn, and error badges with kind-specific classes", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: false,
        badges: [
          { label: "migrated from v0", kind: "info" },
          { label: "fingerprint differs", kind: "warn" },
          { label: "uuid collision", kind: "error" },
        ],
        depWarnings: [],
      },
    });
    expect(wrap.text()).toContain("migrated from v0");
    expect(wrap.text()).toContain("fingerprint differs");
    expect(wrap.text()).toContain("uuid collision");
    expect(wrap.find(".wp-picker-row__badge--info").exists()).toBe(true);
    expect(wrap.find(".wp-picker-row__badge--warn").exists()).toBe(true);
    expect(wrap.find(".wp-picker-row__badge--error").exists()).toBe(true);
  });

  it("renders dep warnings prefixed with the warning glyph when expanded", async () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: true,
        badges: [],
        depWarnings: ["references @{aabbccdd} not selected"],
      },
    });
    // Collapsed by default — the chip is the only warning surface.
    expect(wrap.find('[data-test="dep-warn-list"]').exists()).toBe(false);
    await wrap.get('[data-test="dep-warn-chip"]').trigger("click");
    const warn = wrap.get(".wp-picker-row__warn");
    expect(warn.text()).toContain("references @{aabbccdd} not selected");
    expect(warn.text()).toMatch(/^⚠/);
  });

  it("applies left padding from the indent prop (16px per level)", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: false,
        badges: [],
        depWarnings: [],
        indent: 2,
      },
    });
    const row = wrap.get(".wp-picker-row");
    // Vue serializes inline styles as `padding-left: 32px;`
    expect(row.attributes("style")).toContain("padding-left: 32px");
  });

  it("defaults indent to 0 when omitted", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false, badges: [], depWarnings: [] },
    });
    expect(wrap.get(".wp-picker-row").attributes("style")).toContain("padding-left: 0px");
  });

  it("exposes uuid via a data attribute for downstream test/lookup", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "abcd1234", name: "x", checked: false, badges: [], depWarnings: [] },
    });
    expect(wrap.get(".wp-picker-row").attributes("data-uuid")).toBe("abcd1234");
  });

  // ---------- Polish A: kind icon + short id + category chip + warn chip ----------

  it("renders the kind icon with the canonical PrimeIcons class for the kind", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: false,
        badges: [],
        depWarnings: [],
        kind: "wildcard",
      },
    });
    // kindIcon("wildcard") → "pi pi-sparkles". Use an attribute selector
    // so the test doesn't break if PrimeIcons swaps glyph names later —
    // we only care that *some* `pi-*` glyph class made it through.
    const icon = wrap.find('.wp-picker-row__kindicon i');
    expect(icon.exists()).toBe(true);
    expect(icon.attributes("class") ?? "").toMatch(/\bpi-\w+/);
  });

  it("renders no icon when kind prop is omitted", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false, badges: [], depWarnings: [] },
    });
    expect(wrap.find(".wp-picker-row__kindicon").exists()).toBe(false);
  });

  it("renders the short id when showId is true", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "aabbccdd",
        name: "x",
        checked: false,
        badges: [],
        depWarnings: [],
        showId: true,
      },
    });
    const id = wrap.find('[data-test="picker-row-id"]');
    expect(id.exists()).toBe(true);
    expect(id.text()).toBe("aabbccdd");
  });

  it("hides the short id by default (showId defaults to false)", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "aabbccdd", name: "myname", checked: false, badges: [], depWarnings: [] },
    });
    expect(wrap.find('[data-test="picker-row-id"]').exists()).toBe(false);
    // The id itself shouldn't bleed into rendered text anywhere either.
    expect(wrap.text()).not.toContain("aabbccdd");
  });

  it("renders the category chip when categoryName + categoryColor are set", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: false,
        badges: [],
        depWarnings: [],
        categoryName: "characters",
        categoryColor: "#ff7777",
      },
    });
    const chip = wrap.find('[data-test="picker-row-cat-chip"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toBe("characters");
  });

  it("hides the category chip when categoryName is absent", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false, badges: [], depWarnings: [] },
    });
    expect(wrap.find('[data-test="picker-row-cat-chip"]').exists()).toBe(false);
  });

  it("hides the dep-warn chip when depWarnings is empty", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false, badges: [], depWarnings: [] },
    });
    expect(wrap.find('[data-test="dep-warn-chip"]').exists()).toBe(false);
  });

  it("collapses N dep warnings behind one expandable chip", async () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: true,
        badges: [],
        depWarnings: [
          "references @{aabbccdd} not selected",
          "references @{eeff0011} not selected",
        ],
      },
    });
    const chip = wrap.get('[data-test="dep-warn-chip"]');
    expect(chip.text()).toContain("2");
    // Hidden until clicked.
    expect(wrap.find('[data-test="dep-warn-list"]').exists()).toBe(false);
    await chip.trigger("click");
    const list = wrap.find('[data-test="dep-warn-list"]');
    expect(list.exists()).toBe(true);
    expect(list.findAll(".wp-picker-row__warn")).toHaveLength(2);
  });

  it("flips aria-expanded on the dep-warn chip as it toggles", async () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: true,
        badges: [],
        depWarnings: ["references @{aabbccdd} not selected"],
      },
    });
    const chip = wrap.get('[data-test="dep-warn-chip"]');
    expect(chip.attributes("aria-expanded")).toBe("false");
    await chip.trigger("click");
    expect(chip.attributes("aria-expanded")).toBe("true");
    await chip.trigger("click");
    expect(chip.attributes("aria-expanded")).toBe("false");
  });
});
