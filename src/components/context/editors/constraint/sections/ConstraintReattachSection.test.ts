import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ConstraintReattachSection from "./ConstraintReattachSection.vue";
import type { WildcardRefData } from "../../../../../manager/utils/library-suggestions";

function refData(): WildcardRefData {
  return {
    uuidToName: new Map([["beef0001", "colour"]]),
    uuidToSubCategories: new Map([["beef0001", ["warm", "cold"]]]),
    uuidToHasNull: new Map([["beef0001", false]]),
    uuidToOptionsCount: new Map([["beef0001", 2]]),
    uuidToOptionTagSets: new Map([["beef0001", [["warm"], ["cold"]]]]),
    uuidToTagGroups: new Map([["beef0001", {}]]),
  };
}

function mountSection(overrides = {}) {
  return mount(ConstraintReattachSection, {
    props: {
      danglingSource: true,
      danglingTarget: false,
      sourceUuid: "deadbeef",
      sourceCachedName: "old colour",
      targetUuid: "",
      targetCachedName: "",
      refData: refData(),
      referencedElsewhere: false,
      ...overrides,
    },
  });
}

describe("ConstraintReattachSection", () => {
  it("renders a remap banner row for the dangling source only", () => {
    const w = mountSection();
    expect(w.find("[data-test='reattach-row-source']").exists()).toBe(true);
    expect(w.find("[data-test='reattach-row-target']").exists()).toBe(false);
    expect(w.text()).toContain("deadbeef".slice(0, 8));
  });

  it("Reattach opens the dropdown and confirm emits the side + old/new uuids", async () => {
    const w = mountSection();
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    await w.find("[data-test-id='reattach-candidate-beef0001']").trigger("click");
    await w.find("[data-test='reattach-confirm-source']").trigger("click");
    const ev = w.emitted("reattach");
    expect(ev).toBeTruthy();
    expect(ev![0][0]).toEqual({
      side: "source",
      oldUuid: "deadbeef",
      newUuid: "beef0001",
      newName: "colour",
    });
  });

  it("shows the library-mutation blast-radius warning when referenced elsewhere", async () => {
    const w = mountSection({ referencedElsewhere: true });
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    const warn = w.find("[data-test='reattach-blast-radius']");
    expect(warn.exists()).toBe(true);
    expect(warn.text()).toMatch(/everywhere it.s used/i);
  });

  it("hides the blast-radius warning when only the current context uses it", async () => {
    const w = mountSection({ referencedElsewhere: false });
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    expect(w.find("[data-test='reattach-blast-radius']").exists()).toBe(false);
  });

  it("shows a dropped-cells preview note for the picked candidate", async () => {
    const w = mountSection({ droppedCellCount: 3 });
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    await w.find("[data-test-id='reattach-candidate-beef0001']").trigger("click");
    expect(w.find("[data-test='reattach-dropped-source']").text()).toMatch(/3 cells dropped/);
  });

  it("floats the cached-name match to the top of the candidate list", async () => {
    const rd = refData();
    rd.uuidToName = new Map([["aaa00000", "zzz"], ["beef0001", "colour"]]);
    const w = mountSection({ sourceCachedName: "colour", refData: rd });
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    const first = w.findAll("[data-test='reattach-candidate']")[0];
    expect(first.text()).toBe("colour");
  });
});
