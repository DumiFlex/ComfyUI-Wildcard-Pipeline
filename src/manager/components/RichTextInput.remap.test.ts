import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";

function nameMap() {
  return new Map([["beef0001", "colour"]]); // PICKED present; broken (deadbeef) absent.
}
function subsMap() {
  return new Map([["beef0001", ["warm", "cold"]]]);
}

describe("RichTextInput — @remap heals the open field", () => {
  it("opens RemapRefPopup when a broken chip emits remap", async () => {
    const w = mount(RichTextInput, {
      props: {
        modelValue: "look @{deadbeef#oldcolour:warm}",
        surface: "wildcard",
        uuidToName: nameMap(),
        uuidToSubCategories: subsMap(),
        refSuggestions: ["beef0001"],
      },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    const chip = w.find(".wp-refchip--unresolved");
    expect(chip.exists()).toBe(true);
    await chip.trigger("click");
    expect(document.querySelector("[data-test='remap-popup']")).toBeTruthy();
  });

  it("rewrites every occurrence of the dead uuid in the field on confirm", async () => {
    const w = mount(RichTextInput, {
      props: {
        modelValue: "a @{deadbeef:warm} b @{deadbeef:cold}",
        surface: "wildcard",
        uuidToName: nameMap(),
        uuidToSubCategories: subsMap(),
        refSuggestions: ["beef0001"],
      },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    // Drive confirm through the exposed test seam (jsdom selection plumbing
    // is flaky; the seam exercises the same applyRemap path).
    (w.vm as unknown as {
      __confirmRemapForTest: (
        u: string,
        n: { uuid: string; name: string; subcatExpr: string; excludeNull: boolean },
      ) => void;
    }).__confirmRemapForTest(
      "deadbeef",
      { uuid: "beef0001", name: "colour", subcatExpr: "warm", excludeNull: false },
    );
    await w.vm.$nextTick();
    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    const last = emitted![emitted!.length - 1][0] as string;
    expect(last).toBe("a @{beef0001#colour:warm} b @{beef0001#colour:warm}");
  });
});
