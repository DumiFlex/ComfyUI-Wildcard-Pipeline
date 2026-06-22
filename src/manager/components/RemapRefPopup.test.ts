import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RemapRefPopup from "./RemapRefPopup.vue";
import type { WildcardRefData } from "../utils/library-suggestions";

function refData(): WildcardRefData {
  return {
    uuidToName: new Map([["beef0001", "colour"], ["facade00", "texture"]]),
    uuidToSubCategories: new Map([["beef0001", ["warm", "cold"]], ["facade00", ["rough"]]]),
    uuidToHasNull: new Map([["beef0001", true], ["facade00", false]]),
    uuidToOptionsCount: new Map([["beef0001", 3], ["facade00", 2]]),
    uuidToOptionTagSets: new Map([["beef0001", [["warm"], ["cold"]]], ["facade00", [["rough"]]]]),
    uuidToTagGroups: new Map([["beef0001", {}], ["facade00", {}]]),
  };
}

function mountPopup(overrides = {}) {
  return mount(RemapRefPopup, {
    props: {
      oldUuid: "deadbeef",
      cachedName: "colour",
      refData: refData(),
      oldExpr: "warm or neon",
      oldExcludeNull: false,
      anchor: { top: 10, left: 10 },
      ...overrides,
    },
    attachTo: document.body,
    // The popup body renders inside `<Teleport to="body">`; stubbing teleport
    // renders the children in place so the wrapper's `find()` reaches them
    // (repo convention — see ConfirmDialog / ModuleEditModal tests).
    global: { stubs: { teleport: true } },
  });
}

describe("RemapRefPopup", () => {
  it("seeds the search box with the cached #name", () => {
    const w = mountPopup();
    const input = w.find<HTMLInputElement>("[data-test='remap-search']");
    expect(input.element.value).toBe("colour");
  });

  it("filters candidates by the search query", async () => {
    const w = mountPopup({ cachedName: "" });
    await w.find("[data-test='remap-search']").setValue("text");
    const rows = w.findAll("[data-test='remap-candidate']");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("texture");
  });

  it("shows each candidate's uuid so same-named wildcards are distinguishable", () => {
    const rd = refData();
    rd.uuidToName = new Map([["beef0001", "colour"], ["beef0002", "colour"]]);
    const w = mountPopup({ cachedName: "", refData: rd });
    expect(w.find("[data-test-id='remap-candidate-beef0001']").text()).toContain("beef0001");
    expect(w.find("[data-test-id='remap-candidate-beef0002']").text()).toContain("beef0002");
  });

  it("after picking a wildcard, shows the dropped-token preview struck through", async () => {
    const w = mountPopup();
    await w.find("[data-test-id='remap-candidate-beef0001']").trigger("click");
    // "neon" is not in beef0001's sub_categories ["warm","cold"] → dropped.
    const dropped = w.find("[data-test='remap-dropped']");
    expect(dropped.exists()).toBe(true);
    expect(dropped.text()).toContain("neon");
    expect(dropped.text()).toMatch(/1 dropped/);
  });

  it("confirm emits the chosen uuid/name and the reconciled subcatExpr", async () => {
    const w = mountPopup();
    await w.find("[data-test-id='remap-candidate-beef0001']").trigger("click");
    await w.find("[data-test='remap-confirm']").trigger("click");
    const ev = w.emitted("confirm");
    expect(ev).toBeTruthy();
    expect(ev![0][0]).toMatchObject({
      uuid: "beef0001",
      name: "colour",
      subcatExpr: "warm", // "neon" dropped
      excludeNull: false,
    });
  });

  it("cancel emits cancel and never confirm", async () => {
    const w = mountPopup();
    await w.find("[data-test='remap-cancel']").trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
    expect(w.emitted("confirm")).toBeFalsy();
  });
});
