import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import PropTable from "../PropTable.vue";

describe("PropTable", () => {
  it("renders a row per entry with name, type, required marker, description", () => {
    const w = mount(PropTable, { props: { rows: [
      { name: "seed", type: "INT", required: true, desc: "drives rolls" },
      { name: "upstream", type: "PIPELINE_CONTEXT", required: false, desc: "chain on" },
    ] } });
    const rows = w.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("seed");
    expect(rows[0].text()).toContain("INT");
    expect(rows[1].text()).toContain("optional");
  });
});
