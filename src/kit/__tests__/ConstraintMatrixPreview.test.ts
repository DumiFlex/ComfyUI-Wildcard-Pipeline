import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConstraintMatrixPreview from "../ConstraintMatrixPreview.vue";

const base = {
  rows: ["happy", "sad"], cols: ["warm", "cool", "misc"],
  matrix: { happy: { warm: { mode: "boost", factor: 2 } } },
  sourceName: "Mood", targetName: "Hue",
  exceptions: [], targetSelect: null, refMap: new Map<string, string>(),
};

describe("ConstraintMatrixPreview", () => {
  it("renders column axis bands when targetGroups are present", () => {
    const w = mount(ConstraintMatrixPreview, { props: {
      ...base, sourceGroups: {}, targetGroups: { hue: ["warm", "cool"] } } });
    expect(w.find(".wp-cn-band").exists()).toBe(true);
    expect(w.html()).toContain("hue");
    expect(w.html()).toContain("uncategorized"); // "misc" has no axis
  });
  it("stays flat when no groups are given (back-compat)", () => {
    const w = mount(ConstraintMatrixPreview, { props: {
      ...base, sourceGroups: {}, targetGroups: {} } });
    expect(w.find(".wp-cn-band").exists()).toBe(false);
    expect(w.find('[data-test="cn-axis-src"]').text()).toContain("Mood");
  });
  it("renders a row group header chip for a multi-tag source axis", () => {
    const w = mount(ConstraintMatrixPreview, { props: {
      ...base, sourceGroups: { mood: ["happy", "sad"] }, targetGroups: {} } });
    expect(w.find(".wp-cn-grp-head").text()).toContain("mood");
  });
  it("shows an only cell and marks the rest of its row as shut out", () => {
    const w = mount(ConstraintMatrixPreview, { props: {
      ...base, sourceGroups: {}, targetGroups: {},
      matrix: { happy: { warm: { mode: "only", factor: 1 } } } } });
    const cells = w.findAll(".wp-cn-cell");
    // Row-major: happy × [warm, cool, misc], then sad × [...].
    expect(cells[0].attributes("data-mode")).toBe("only");
    expect(cells[0].text()).toContain("✓");
    expect(cells[1].classes()).toContain("wp-cn-cell--implied-out");
    expect(cells[1].text()).toContain("×");
    expect(cells[3].classes()).not.toContain("wp-cn-cell--implied-out");
  });
  it("labels an only exception", () => {
    const w = mount(ConstraintMatrixPreview, { props: {
      ...base, sourceGroups: {}, targetGroups: {},
      exceptions: [{ source: "maid", target: "apron", mode: "only", factor: 1 }] } });
    expect(w.find(".wp-cn-exc__mode--only").text()).toContain("Only");
  });
});
