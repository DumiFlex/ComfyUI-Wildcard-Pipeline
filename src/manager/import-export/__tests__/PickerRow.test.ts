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

  it("renders dep warnings prefixed with the warning glyph", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: true,
        badges: [],
        depWarnings: ["references @{aabbccdd} not selected"],
      },
    });
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
});
