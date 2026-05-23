import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PickerRow from "../PickerRow.vue";

describe("PickerRow", () => {
  it("renders entity name", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "$person", checked: false },
    });
    expect(wrap.text()).toContain("$person");
  });

  it("emits update:checked when the inner checkbox is clicked", async () => {
    // The shared Checkbox.vue renders a <button role="checkbox">, not a
    // native <input>. Click the button directly so the test mirrors how
    // the row actually surfaces toggle events to its parent.
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false },
    });
    await wrap.get('button[role="checkbox"]').trigger("click");
    expect(wrap.emitted("update:checked")?.[0]).toEqual([true]);
  });

  it("applies left padding from the indent prop (16px per level)", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false, indent: 2 },
    });
    const row = wrap.get(".wp-picker-row");
    // Vue serializes inline styles as `padding-left: 32px;`
    expect(row.attributes("style")).toContain("padding-left: 32px");
  });

  it("defaults indent to 0 when omitted", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false },
    });
    expect(wrap.get(".wp-picker-row").attributes("style")).toContain("padding-left: 0px");
  });

  it("exposes uuid via a data attribute for downstream test/lookup", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "abcd1234", name: "x", checked: false },
    });
    expect(wrap.get(".wp-picker-row").attributes("data-uuid")).toBe("abcd1234");
  });

  // ---------- Kind icon ----------

  it("renders the kind icon with the canonical PrimeIcons class for the kind", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false, kind: "wildcard" },
    });
    // kindIcon("wildcard") → "pi pi-sparkles". The icon also gets a tint
    // class via wp-row-type-icon--wildcard.
    const icon = wrap.find(".wp-row-type-icon.wp-row-type-icon--wildcard i");
    expect(icon.exists()).toBe(true);
    expect(icon.attributes("class") ?? "").toMatch(/\bpi-sparkles\b/);
  });

  it("renders no icon when kind prop is omitted", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false },
    });
    expect(wrap.find(".wp-row-type-icon").exists()).toBe(false);
  });

  // ---------- Short id ----------

  it("renders the short id when showId is true", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "aabbccdd", name: "x", checked: false, showId: true },
    });
    const id = wrap.find('[data-test="picker-row-id"]');
    expect(id.exists()).toBe(true);
    expect(id.text()).toBe("aabbccdd");
    // Uses the shared `.wp-id` primitive (tokens.css), not a row-local class.
    expect(id.attributes("class") ?? "").toContain("wp-id");
  });

  it("hides the short id by default (showId defaults to false)", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "aabbccdd", name: "myname", checked: false },
    });
    expect(wrap.find('[data-test="picker-row-id"]').exists()).toBe(false);
    // The id itself shouldn't bleed into rendered text anywhere either.
    expect(wrap.text()).not.toContain("aabbccdd");
  });

  // ---------- Category chip ----------

  it("renders the category chip when categoryName + categoryColor are set", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: false,
        categoryName: "characters",
        categoryColor: "#ff7777",
      },
    });
    const chip = wrap.find('[data-test="picker-row-cat-chip"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toBe("characters");
    // Shared primitive — not a row-local class.
    expect(chip.attributes("class") ?? "").toContain("wp-cat-chip");
    // Inline style from catChipStyle helper carries the user color in
    // some form (foreground, background, or borderColor). jsdom
    // serializes hex to rgb(), so check for either spelling.
    const style = chip.attributes("style") ?? "";
    expect(/#ff7777|rgb\(255,\s*119,\s*119\)/i.test(style)).toBe(true);
  });

  it("hides the category chip when categoryName is absent", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false },
    });
    expect(wrap.find('[data-test="picker-row-cat-chip"]').exists()).toBe(false);
  });

  // ---------- Status badges ----------

  it("renders a NEW status badge using the shared wp-mod-badge--new primitive", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: false,
        statusBadges: [{ variant: "new", label: "NEW" }],
      },
    });
    const badge = wrap.find(".wp-mod-badge.wp-mod-badge--new");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("NEW");
  });

  it("renders multiple status badges in the order they were passed", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: false,
        statusBadges: [
          { variant: "migrated", label: "MIGRATED v0→1" },
          { variant: "mod", label: "MOD" },
        ],
      },
    });
    const badges = wrap.findAll(".wp-mod-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]!.text()).toBe("MIGRATED v0→1");
    expect(badges[0]!.attributes("class") ?? "").toContain("wp-mod-badge--migrated");
    expect(badges[1]!.text()).toBe("MOD");
    expect(badges[1]!.attributes("class") ?? "").toContain("wp-mod-badge--mod");
  });

  // ---------- Unselected deps ("Requires N") ----------

  it("hides the unselected-deps chip when the list is empty", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false, unselectedDeps: [] },
    });
    expect(wrap.find('[data-test="dep-warn-chip"]').exists()).toBe(false);
  });

  it("renders an amber 'Requires N' chip that expands inline on click", async () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: true,
        unselectedDeps: [
          { id: "aabbccdd", name: "$camera_angle", type: "wildcard" },
          { id: "eeff0011", name: "$lighting",     type: "wildcard" },
        ],
      },
    });
    const chip = wrap.get('[data-test="dep-warn-chip"]');
    expect(chip.attributes("class") ?? "").toContain("wp-dep-chip");
    // Not the missing variant.
    expect(chip.attributes("class") ?? "").not.toContain("wp-dep-chip--missing");
    expect(chip.text()).toContain("Requires 2");
    // List hidden until clicked.
    expect(wrap.find('[data-test="dep-warn-list"]').exists()).toBe(false);
    await chip.trigger("click");
    const list = wrap.get('[data-test="dep-warn-list"]');
    expect(list.findAll(".wp-row-dep-list__item")).toHaveLength(2);
    expect(list.text()).toContain("$camera_angle");
    expect(list.text()).toContain("$lighting");
  });

  // ---------- Missing deps ----------

  it("hides the missing-deps chip when the list is empty", () => {
    const wrap = mount(PickerRow, {
      props: { uuid: "u", name: "x", checked: false, missingDeps: [] },
    });
    expect(wrap.find('[data-test="dep-missing-chip"]').exists()).toBe(false);
  });

  it("renders a red 'Missing N' chip with an unresolvable verdict on expand", async () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: true,
        missingDeps: [
          { id: "deadbeef", name: "$face_detail", type: "wildcard" },
        ],
      },
    });
    const chip = wrap.get('[data-test="dep-missing-chip"]');
    expect(chip.attributes("class") ?? "").toContain("wp-dep-chip--missing");
    expect(chip.text()).toContain("Missing 1");
    expect(wrap.find('[data-test="dep-missing-list"]').exists()).toBe(false);
    await chip.trigger("click");
    const list = wrap.get('[data-test="dep-missing-list"]');
    expect(list.text()).toContain("$face_detail");
    expect(list.text()).toContain("unresolvable");
  });

  it("flips aria-expanded on the dep chip as it toggles", async () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: true,
        unselectedDeps: [{ id: "aabbccdd", name: "ref" }],
      },
    });
    const chip = wrap.get('[data-test="dep-warn-chip"]');
    expect(chip.attributes("aria-expanded")).toBe("false");
    await chip.trigger("click");
    expect(chip.attributes("aria-expanded")).toBe("true");
    await chip.trigger("click");
    expect(chip.attributes("aria-expanded")).toBe("false");
  });

  it("renders both unselected- and missing-dep chips side by side when both are non-empty", () => {
    const wrap = mount(PickerRow, {
      props: {
        uuid: "u",
        name: "x",
        checked: true,
        unselectedDeps: [{ id: "aabbccdd", name: "a" }],
        missingDeps: [{ id: "deadbeef", name: "b" }],
      },
    });
    expect(wrap.find('[data-test="dep-warn-chip"]').exists()).toBe(true);
    expect(wrap.find('[data-test="dep-missing-chip"]').exists()).toBe(true);
  });
});
