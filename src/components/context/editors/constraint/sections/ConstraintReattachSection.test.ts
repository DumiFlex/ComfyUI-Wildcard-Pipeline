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
    expect(first.find("[data-test='reattach-cand-name']").text()).toBe("colour");
  });

  it("shows each candidate's uuid + option/sub-category meta so duplicates are distinguishable", async () => {
    const rd = refData();
    // Two library wildcards share the name "colour" — only the uuid + content
    // tell them apart. Without these the picker is a coin-flip.
    rd.uuidToName = new Map([["beef0001", "colour"], ["beef0002", "colour"]]);
    rd.uuidToSubCategories = new Map([["beef0001", ["warm", "cold"]], ["beef0002", ["hue"]]]);
    rd.uuidToOptionsCount = new Map([["beef0001", 2], ["beef0002", 9]]);
    const w = mountSection({ refData: rd });
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    const c1 = w.find("[data-test-id='reattach-candidate-beef0001']");
    const c2 = w.find("[data-test-id='reattach-candidate-beef0002']");
    // The 8-hex uuid is the definitive disambiguator.
    expect(c1.text()).toContain("beef0001");
    expect(c2.text()).toContain("beef0002");
    // Option count + sub-categories give a human-readable tiebreaker.
    expect(c1.text()).toContain("2 opts");
    expect(c1.text()).toContain("warm");
    expect(c2.text()).toContain("9 opts");
    expect(c2.text()).toContain("hue");
  });

  it("renders the community-download button only on a downloadable side", () => {
    const w = mountSection({ downloadableSides: { source: true, target: false } });
    expect(w.find("[data-test='reattach-download-source']").exists()).toBe(true);
    // Target isn't dangling here, but even its (absent) row shouldn't carry
    // the download button when not flagged downloadable.
    expect(w.find("[data-test='reattach-download-target']").exists()).toBe(false);
  });

  it("hides the community-download button when the side isn't downloadable", () => {
    const w = mountSection({ downloadableSides: { source: false, target: false } });
    expect(w.find("[data-test='reattach-download-source']").exists()).toBe(false);
  });

  it("omits the community-download button by default (no downloadableSides prop)", () => {
    const w = mountSection();
    expect(w.find("[data-test='reattach-download-source']").exists()).toBe(false);
  });

  it("emits downloadreattach with the side when the download button is clicked", async () => {
    const w = mountSection({ downloadableSides: { source: true, target: false } });
    await w.find("[data-test='reattach-download-source']").trigger("click");
    const ev = w.emitted("downloadreattach");
    expect(ev).toBeTruthy();
    expect(ev![0][0]).toEqual({ side: "source" });
  });
});
