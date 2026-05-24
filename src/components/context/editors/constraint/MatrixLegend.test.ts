import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import MatrixLegend from "../../../../../src/components/context/editors/constraint/MatrixLegend.vue";

describe("MatrixLegend", () => {
  it("body is collapsed by default", () => {
    const wrap = mount(MatrixLegend);
    expect(wrap.find(".legend-body").exists()).toBe(false);
  });

  it("clicking the toggle expands the body with four state rows", async () => {
    const wrap = mount(MatrixLegend);
    await wrap.find(".legend-toggle").trigger("click");
    expect(wrap.find(".legend-body").exists()).toBe(true);
    expect(wrap.findAll(".legend-row")).toHaveLength(4);
  });

  it("each row labels one state in plain language", async () => {
    const wrap = mount(MatrixLegend);
    await wrap.find(".legend-toggle").trigger("click");
    const names = wrap.findAll(".legend-name").map((n) => n.text().toLowerCase());
    expect(names).toEqual(
      expect.arrayContaining(["neutral", "exclude", "boost", "reduce"]),
    );
    const descs = wrap.findAll(".legend-desc").map((d) => d.text());
    expect(descs.some((d) => /excluded entirely/i.test(d))).toBe(true);
    expect(descs.some((d) => /more likely/i.test(d))).toBe(true);
    expect(descs.some((d) => /less likely/i.test(d))).toBe(true);
  });
});
